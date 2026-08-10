// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {MevPool} from "../src/mev/MevPool.sol";
import {MevToken} from "../src/mev/MevToken.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * The economics MEV Shield claims, pinned as tests.
 *
 * The headline number the product reports — "the public mempool cost you $X on
 * this trade" — is only meaningful if the sandwich it measures is real. These
 * tests establish that at the venue level, independent of any network, lane, or
 * relayer: given the same pool and the same victim order, inserting an attacker
 * around it strictly reduces what the victim receives, and the attacker keeps
 * the difference.
 *
 * Dollar terms: `quote` is an 18-decimal USD stand-in, so for a base->quote
 * victim swap the shortfall in quote units *is* the loss in dollars.
 */
contract MevPoolTest is Test {
    MevToken internal baseTok;
    MevToken internal quoteTok;
    MevPool internal pool;

    address internal lp = address(0xA11CE);
    address internal victim = address(0xB0B);
    address internal attacker = address(0xBEEF);

    // A pool deep enough that a single trade doesn't nuke it, shallow enough
    // that a realistic trade has visible impact: 1,000 base @ $2,000.
    uint256 internal constant POOL_BASE = 1_000e18;
    uint256 internal constant POOL_QUOTE = 2_000_000e18;

    function setUp() public {
        baseTok = new MevToken("MEV Shield ETH", "mETH", 18);
        quoteTok = new MevToken("MEV Shield USD", "mUSD", 18);
        pool = new MevPool(IERC20(address(baseTok)), IERC20(address(quoteTok)));

        baseTok.mint(lp, POOL_BASE);
        quoteTok.mint(lp, POOL_QUOTE);
        vm.startPrank(lp);
        baseTok.approve(address(pool), type(uint256).max);
        quoteTok.approve(address(pool), type(uint256).max);
        pool.addLiquidity(POOL_BASE, POOL_QUOTE);
        vm.stopPrank();

        for (uint256 i = 0; i < 2; i++) {
            address who = i == 0 ? victim : attacker;
            vm.startPrank(who);
            baseTok.approve(address(pool), type(uint256).max);
            quoteTok.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
    }

    // ─── helpers ────────────────────────────────────────────────────────────

    function _swap(address who, bool baseForQuote, uint256 amountIn, uint256 minOut)
        internal
        returns (uint256 out)
    {
        vm.prank(who);
        out = pool.swap(baseForQuote, amountIn, minOut, who);
    }

    /// bps of slippage tolerance applied to a quote.
    function _withTolerance(uint256 quoted, uint256 bps) internal pure returns (uint256) {
        return (quoted * (10_000 - bps)) / 10_000;
    }

    // ─── the control: an unmolested swap gets exactly what it was quoted ─────

    function test_CleanSwapReceivesExactlyTheQuote() public {
        uint256 amountIn = 10e18;
        uint256 quoted = pool.getAmountOut(true, amountIn);

        baseTok.mint(victim, amountIn);
        uint256 got = _swap(victim, true, amountIn, quoted);

        assertEq(got, quoted, "an unsandwiched swap must fill at its quote");
    }

    // ─── the attack: sandwiching strictly degrades the victim ───────────────

    function test_SandwichExtractsValueFromTheVictim() public {
        uint256 victimIn = 10e18; // victim sells 10 mETH
        uint256 cleanQuote = pool.getAmountOut(true, victimIn);
        uint256 victimMinOut = _withTolerance(cleanQuote, 100); // 1% tolerance

        // The attacker sizes their front-run to the exact budget the victim's
        // own slippage tolerance hands them.
        uint256 frontRunIn = pool.maxExtractableFrontRun(true, victimIn, victimMinOut);
        assertGt(frontRunIn, 0, "a 1% tolerance must leave room to extract");

        baseTok.mint(attacker, frontRunIn);
        baseTok.mint(victim, victimIn);

        // 1. front-run: attacker sells base, pushing the price down
        uint256 attackerQuoteOut = _swap(attacker, true, frontRunIn, 0);
        // 2. victim executes into the degraded price
        uint256 victimOut = _swap(victim, true, victimIn, victimMinOut);
        // 3. back-run: attacker buys the base back cheaper
        uint256 attackerBaseBack = _swap(attacker, false, attackerQuoteOut, 0);

        uint256 victimLoss = cleanQuote - victimOut;
        assertGt(victimLoss, 0, "the sandwich must cost the victim something");
        assertGe(victimOut, victimMinOut, "the attack must still respect the victim's limit");

        // The attacker's profit is denominated in base: they started with
        // frontRunIn and ended with attackerBaseBack.
        assertGt(attackerBaseBack, frontRunIn, "the sandwich must be profitable for the attacker");

        console2.log("victim quoted (mUSD)   ", cleanQuote / 1e18);
        console2.log("victim received (mUSD) ", victimOut / 1e18);
        console2.log("victim loss (USD)      ", victimLoss / 1e18);
        console2.log("attacker gain (mETH,wei)", attackerBaseBack - frontRunIn);
    }

    /// The victim's slippage tolerance is the attacker's budget, not a shield.
    function test_WiderToleranceMeansStrictlyMoreExtraction() public view {
        uint256 victimIn = 10e18;
        uint256 cleanQuote = pool.getAmountOut(true, victimIn);

        uint256 tightBudget = pool.maxExtractableFrontRun(true, victimIn, _withTolerance(cleanQuote, 50));
        uint256 looseBudget = pool.maxExtractableFrontRun(true, victimIn, _withTolerance(cleanQuote, 300));

        assertGt(looseBudget, tightBudget, "a looser limit must hand the attacker a bigger budget");
    }

    /// `maxExtractableFrontRun` must be exactly at the boundary: one wei more
    /// of front-run and the victim's own limit rejects the fill.
    function test_ExtractionBudgetIsTightAgainstTheVictimLimit() public {
        uint256 victimIn = 10e18;
        uint256 cleanQuote = pool.getAmountOut(true, victimIn);
        uint256 victimMinOut = _withTolerance(cleanQuote, 100);
        uint256 budget = pool.maxExtractableFrontRun(true, victimIn, victimMinOut);

        uint256 snap = vm.snapshotState();

        // At the budget: the victim still clears.
        baseTok.mint(attacker, budget + 1);
        baseTok.mint(victim, victimIn);
        _swap(attacker, true, budget, 0);
        uint256 out = _swap(victim, true, victimIn, victimMinOut);
        assertGe(out, victimMinOut, "at the computed budget the victim must still fill");

        vm.revertToState(snap);

        // One wei over: the victim's slippage guard fires. The attack is
        // bounded by the victim's limit — which is exactly why the limit is a
        // disclosed budget rather than protection.
        baseTok.mint(attacker, budget + 1);
        baseTok.mint(victim, victimIn);
        _swap(attacker, true, budget + 1, 0);
        vm.prank(victim);
        vm.expectRevert();
        pool.swap(true, victimIn, victimMinOut, victim);
    }

    // ─── conservation: the victim's loss is not destroyed, it is moved ──────

    function test_VictimLossIsCapturedByAttackerAndLps() public {
        uint256 victimIn = 25e18;
        uint256 cleanQuote = pool.getAmountOut(true, victimIn);
        uint256 victimMinOut = _withTolerance(cleanQuote, 200);
        uint256 frontRunIn = pool.maxExtractableFrontRun(true, victimIn, victimMinOut);

        baseTok.mint(attacker, frontRunIn);
        baseTok.mint(victim, victimIn);

        // The attacker's stake is what they hold before the first leg; profit is
        // strictly what they hold after the last leg, above that stake.
        uint256 attackerBaseBefore = baseTok.balanceOf(attacker);
        uint256 qOut = _swap(attacker, true, frontRunIn, 0);
        uint256 victimOut = _swap(victim, true, victimIn, victimMinOut);
        _swap(attacker, false, qOut, 0);

        uint256 attackerProfitBase = baseTok.balanceOf(attacker) - attackerBaseBefore;
        uint256 victimLossQuote = cleanQuote - victimOut;

        // Value the attacker's base profit at the post-trade mid price to
        // compare like with like.
        uint256 attackerProfitQuote = (attackerProfitBase * pool.midPrice()) / 1e18;

        assertGt(attackerProfitQuote, 0, "attacker profit must be positive");
        // The attacker cannot capture more than the victim lost: the 30bp fee
        // on each of the attacker's two legs is skimmed by the LPs first.
        assertLt(attackerProfitQuote, victimLossQuote, "LPs take the fee out of the extracted value");

        console2.log("victim loss (USD)       ", victimLossQuote / 1e18);
        console2.log("attacker profit (USD)   ", attackerProfitQuote / 1e18);
        console2.log("to LPs as fees (USD)    ", (victimLossQuote - attackerProfitQuote) / 1e18);
    }

    // ─── the property that makes the product's headline number sound ────────

    /**
     * For any realistic victim size and any front-run the attacker can afford,
     * being sandwiched is never *better* than not being sandwiched.
     *
     * This is what licenses MEV Shield to attribute the public-vs-private
     * output gap to routing: at the venue, exposure can only ever cost you.
     */
    function testFuzz_SandwichNeverBenefitsTheVictim(uint256 victimIn, uint256 frontRunIn) public {
        victimIn = bound(victimIn, 0.01e18, 50e18);
        frontRunIn = bound(frontRunIn, 0.01e18, 200e18);

        uint256 cleanQuote = pool.getAmountOut(true, victimIn);

        baseTok.mint(attacker, frontRunIn);
        baseTok.mint(victim, victimIn);

        _swap(attacker, true, frontRunIn, 0);
        uint256 sandwichedOut = _swap(victim, true, victimIn, 0);

        assertLe(sandwichedOut, cleanQuote, "front-running must never improve the victim's fill");
    }

    /// Same direction, other way round: a victim buying base is degraded too.
    function test_SandwichWorksOnBuysAsWell() public {
        uint256 victimIn = 20_000e18; // victim buys with 20k mUSD
        uint256 cleanQuote = pool.getAmountOut(false, victimIn);
        uint256 victimMinOut = _withTolerance(cleanQuote, 100);
        uint256 frontRunIn = pool.maxExtractableFrontRun(false, victimIn, victimMinOut);
        assertGt(frontRunIn, 0);

        quoteTok.mint(attacker, frontRunIn);
        quoteTok.mint(victim, victimIn);

        uint256 attackerBaseOut = _swap(attacker, false, frontRunIn, 0);
        uint256 victimOut = _swap(victim, false, victimIn, victimMinOut);
        uint256 attackerQuoteBack = _swap(attacker, true, attackerBaseOut, 0);

        assertLt(victimOut, cleanQuote, "buyer must receive less base than quoted");
        assertGt(attackerQuoteBack, frontRunIn, "attacker profits on the buy-side sandwich");
    }

    // ─── pool sanity ────────────────────────────────────────────────────────

    function test_ConstantProductNeverDecreases() public {
        uint256 kBefore = pool.reserveBase() * pool.reserveQuote();
        baseTok.mint(victim, 5e18);
        _swap(victim, true, 5e18, 0);
        assertGe(pool.reserveBase() * pool.reserveQuote(), kBefore, "fees must only grow k");
    }

    function test_LiquidityRoundTripDoesNotMintValue() public {
        uint256 lpShares = pool.shares(lp);
        vm.prank(lp);
        (uint256 b, uint256 q) = pool.removeLiquidity(lpShares);
        assertLe(b, POOL_BASE, "cannot withdraw more base than deposited without trades");
        assertLe(q, POOL_QUOTE, "cannot withdraw more quote than deposited without trades");
    }

    function test_UnseededPoolCannotBeQuoted() public {
        MevPool empty = new MevPool(IERC20(address(baseTok)), IERC20(address(quoteTok)));
        vm.expectRevert(MevPool.InsufficientLiquidity.selector);
        empty.getAmountOut(true, 1e18);
    }
}
