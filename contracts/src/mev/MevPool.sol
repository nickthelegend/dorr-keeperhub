// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * A constant-product AMM that is honestly sandwichable.
 *
 * This is the victim's venue in the MEV Shield lab. It is a faithful
 * Uniswap-V2-style pair — x*y=k, 30bp fee, reserves, LP shares — with no
 * ordering protection of any kind. That is the point: the pool is the control
 * variable. It behaves identically no matter which lane a swap arrives
 * through, so any difference in what a trader receives is attributable to
 * *transaction routing alone*, not to the venue.
 *
 * Price impact here is real. A swap that moves the reserves moves the price for
 * whoever lands next, which is precisely the primitive a sandwich monetises.
 *
 *   attacker buys  -> price up   (victim's own buy now fills worse)
 *   victim  buys   -> price up further, victim eats the attacker's impact
 *   attacker sells -> unwinds into the victim's impact, banking the spread
 *
 * The only thing standing between a victim and an unbounded sandwich is the
 * `minAmountOut` they set. A rational searcher front-runs by exactly the amount
 * that leaves the victim one wei above their own limit — so a slippage
 * tolerance is not protection, it is a *disclosed budget for the attacker*.
 * `maxExtractableFrontRun` computes that budget explicitly; the lab uses it to
 * size the attack the way a real searcher would.
 */
contract MevPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// Fee in basis points taken on the input amount (30bp, Uniswap V2 parity).
    uint256 public constant FEE_BPS = 30;
    uint256 public constant BPS = 10_000;
    uint256 private constant MINIMUM_LIQUIDITY = 1000;

    IERC20 public immutable base; // e.g. mETH — the asset being priced
    IERC20 public immutable quote; // e.g. mUSD — the numeraire

    uint256 public reserveBase;
    uint256 public reserveQuote;

    uint256 public totalShares;
    mapping(address => uint256) public shares;

    event LiquidityAdded(address indexed provider, uint256 baseIn, uint256 quoteIn, uint256 sharesMinted);
    event LiquidityRemoved(address indexed provider, uint256 baseOut, uint256 quoteOut, uint256 sharesBurned);
    event Swap(
        address indexed sender,
        address indexed to,
        bool baseForQuote,
        uint256 amountIn,
        uint256 amountOut,
        uint256 reserveBaseAfter,
        uint256 reserveQuoteAfter
    );

    error InsufficientLiquidity();
    error InsufficientInput();
    error SlippageExceeded(uint256 amountOut, uint256 minAmountOut);
    error InsufficientShares();

    constructor(IERC20 base_, IERC20 quote_) {
        base = base_;
        quote = quote_;
    }

    // ─── quoting ────────────────────────────────────────────────────────────

    /**
     * Output for `amountIn`, given the *current* reserves.
     *
     * This is the number a trader sees before they sign. Everything MEV Shield
     * measures is the gap between this quote and what actually landed.
     */
    function getAmountOut(bool baseForQuote, uint256 amountIn) public view returns (uint256) {
        (uint256 reserveIn, uint256 reserveOut) =
            baseForQuote ? (reserveBase, reserveQuote) : (reserveQuote, reserveBase);
        return _getAmountOut(amountIn, reserveIn, reserveOut);
    }

    function _getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        private
        pure
        returns (uint256)
    {
        if (amountIn == 0) revert InsufficientInput();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        uint256 amountInAfterFee = amountIn * (BPS - FEE_BPS);
        return (amountInAfterFee * reserveOut) / (reserveIn * BPS + amountInAfterFee);
    }

    /// Mid price of base in quote units, scaled 1e18. Zero when unseeded.
    function midPrice() external view returns (uint256) {
        if (reserveBase == 0) return 0;
        return (reserveQuote * 1e18) / reserveBase;
    }

    /**
     * The largest same-direction front-run that still lets a victim swapping
     * `victimAmountIn` clear their own `victimMinOut`.
     *
     * This is the attacker's budget, handed to them by the victim's slippage
     * tolerance. Solved by binary search rather than in closed form: the
     * closed-form optimum is a quadratic whose integer rounding is fiddly, and
     * this is a view function on a test-net lab — clarity beats gas here.
     *
     * Returns 0 when the victim's tolerance leaves no room to extract.
     */
    function maxExtractableFrontRun(bool baseForQuote, uint256 victimAmountIn, uint256 victimMinOut)
        external
        view
        returns (uint256)
    {
        (uint256 reserveIn, uint256 reserveOut) =
            baseForQuote ? (reserveBase, reserveQuote) : (reserveQuote, reserveBase);
        if (reserveIn == 0 || reserveOut == 0) return 0;
        // Even a zero front-run must leave the victim whole; if it doesn't,
        // their limit is already unreachable and there is nothing to size.
        if (_getAmountOut(victimAmountIn, reserveIn, reserveOut) < victimMinOut) return 0;

        uint256 lo = 0;
        uint256 hi = reserveIn * 4; // generous upper bound; binary search collapses it
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            uint256 attackerOut = _getAmountOut(mid, reserveIn, reserveOut);
            uint256 victimOut =
                _getAmountOut(victimAmountIn, reserveIn + mid, reserveOut - attackerOut);
            if (victimOut >= victimMinOut) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    }

    // ─── swapping ───────────────────────────────────────────────────────────

    /**
     * Swap `amountIn` for at least `minAmountOut`, sending the proceeds to `to`.
     *
     * Caller must have approved this pool for `amountIn` of the input token.
     */
    function swap(bool baseForQuote, uint256 amountIn, uint256 minAmountOut, address to)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        (IERC20 tokenIn, IERC20 tokenOut, uint256 reserveIn, uint256 reserveOut) = baseForQuote
            ? (base, quote, reserveBase, reserveQuote)
            : (quote, base, reserveQuote, reserveBase);

        amountOut = _getAmountOut(amountIn, reserveIn, reserveOut);
        if (amountOut < minAmountOut) revert SlippageExceeded(amountOut, minAmountOut);

        tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);
        tokenOut.safeTransfer(to, amountOut);
        _sync();

        emit Swap(msg.sender, to, baseForQuote, amountIn, amountOut, reserveBase, reserveQuote);
    }

    // ─── liquidity ──────────────────────────────────────────────────────────

    /**
     * Deposit both sides and mint shares. The caller must have approved both
     * tokens. Ratio is not enforced on the first deposit (it *sets* the price);
     * later deposits mint on the lesser of the two contributed ratios, so
     * off-ratio deposits simply donate the excess to the pool.
     */
    function addLiquidity(uint256 baseIn, uint256 quoteIn) external nonReentrant returns (uint256 minted) {
        if (baseIn == 0 || quoteIn == 0) revert InsufficientInput();
        base.safeTransferFrom(msg.sender, address(this), baseIn);
        quote.safeTransferFrom(msg.sender, address(this), quoteIn);

        if (totalShares == 0) {
            minted = _sqrt(baseIn * quoteIn);
            if (minted <= MINIMUM_LIQUIDITY) revert InsufficientLiquidity();
            // Burn a dust amount permanently so totalShares can never return to
            // zero and re-open first-depositor price setting.
            minted -= MINIMUM_LIQUIDITY;
            totalShares = MINIMUM_LIQUIDITY;
        } else {
            uint256 fromBase = (baseIn * totalShares) / reserveBase;
            uint256 fromQuote = (quoteIn * totalShares) / reserveQuote;
            minted = fromBase < fromQuote ? fromBase : fromQuote;
            if (minted == 0) revert InsufficientInput();
        }

        shares[msg.sender] += minted;
        totalShares += minted;
        _sync();

        emit LiquidityAdded(msg.sender, baseIn, quoteIn, minted);
    }

    function removeLiquidity(uint256 shareAmount) external nonReentrant returns (uint256 baseOut, uint256 quoteOut) {
        if (shareAmount == 0 || shares[msg.sender] < shareAmount) revert InsufficientShares();

        baseOut = (reserveBase * shareAmount) / totalShares;
        quoteOut = (reserveQuote * shareAmount) / totalShares;
        if (baseOut == 0 || quoteOut == 0) revert InsufficientLiquidity();

        shares[msg.sender] -= shareAmount;
        totalShares -= shareAmount;

        base.safeTransfer(msg.sender, baseOut);
        quote.safeTransfer(msg.sender, quoteOut);
        _sync();

        emit LiquidityRemoved(msg.sender, baseOut, quoteOut, shareAmount);
    }

    // ─── internals ──────────────────────────────────────────────────────────

    /// Reserves track actual balances, so a donated token simply deepens the pool.
    function _sync() private {
        reserveBase = base.balanceOf(address(this));
        reserveQuote = quote.balanceOf(address(this));
    }

    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
