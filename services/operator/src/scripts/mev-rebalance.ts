/**
 * Arbitrage the lab pool back to its target price.
 *
 * Every duel leaves the pool slightly off where it started — the victim's trade
 * moves it, and the searcher's two legs do not perfectly cancel because the
 * pool charges them 30bp a side. Left alone across many runs the price drifts,
 * and a drifted pool makes the demo's dollar figures harder to read even though
 * the underlying measurement stays valid.
 *
 * This does what an arbitrageur would do: swap the pool back to the target mid.
 * For a constant product pool, the trade that lands the price at P is the one
 * that leaves base' = sqrt(k / P), so the size is solved directly rather than
 * groped for.
 *
 *   bun run src/scripts/mev-rebalance.ts [targetPrice]
 */
import { createPublicClient, createWalletClient, formatUnits, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { env } from "../env.js";
import { POOL_ABI, TOKEN_ABI } from "../mev/artifacts.js";

const TARGET_DEFAULT = 2000;

/** Integer square root, Newton's method — bigint math, no float rounding. */
function sqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (n / x + x) / 2n;
  }
  return x;
}

async function main() {
  const target = Number(process.argv[2] || TARGET_DEFAULT);
  if (!env.mev.pool) throw new Error("MEV_POOL not set");
  if (!env.eth.deployerKey) throw new Error("ETH_DEPLOYER_KEY missing");

  const account = privateKeyToAccount(env.eth.deployerKey as Hex);
  const pc = createPublicClient({ chain: sepolia, transport: http(env.eth.rpcUrl) });
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(env.eth.rpcUrl) });
  const pool = env.mev.pool as Address;

  const [reserveBase, reserveQuote, baseToken, quoteToken] = (await Promise.all([
    pc.readContract({ address: pool, abi: POOL_ABI, functionName: "reserveBase" }),
    pc.readContract({ address: pool, abi: POOL_ABI, functionName: "reserveQuote" }),
    pc.readContract({ address: pool, abi: POOL_ABI, functionName: "base" }),
    pc.readContract({ address: pool, abi: POOL_ABI, functionName: "quote" }),
  ])) as [bigint, bigint, Address, Address];

  const midNow = (reserveQuote * 10n ** 18n) / reserveBase;
  console.log(`current mid  $${Number(formatUnits(midNow, 18)).toFixed(2)}`);
  console.log(`target mid   $${target.toFixed(2)}`);
  console.log(`reserves     ${formatUnits(reserveBase, 18)} base / ${formatUnits(reserveQuote, 18)} quote`);

  // base' = sqrt(k / P), where k and P are both scaled by 1e18.
  const k = reserveBase * reserveQuote;
  const targetScaled = BigInt(Math.round(target * 1e18));
  const targetBase = sqrt((k * 10n ** 18n) / targetScaled);

  const sellBase = targetBase > reserveBase;
  const amountIn = sellBase ? targetBase - reserveBase : 0n;

  if (sellBase) {
    console.log(`\nprice is too HIGH — selling ${formatUnits(amountIn, 18)} base into the pool`);
  } else {
    // Solve the mirror case on the quote side.
    const targetQuote = (targetBase * targetScaled) / 10n ** 18n;
    const quoteIn = targetQuote > reserveQuote ? targetQuote - reserveQuote : 0n;
    if (quoteIn === 0n) {
      console.log("\nalready at target — nothing to do");
      return;
    }
    console.log(`\nprice is too LOW — buying with ${formatUnits(quoteIn, 18)} quote`);
    await execute(quoteToken, false, quoteIn);
    return;
  }

  if (amountIn === 0n) {
    console.log("\nalready at target — nothing to do");
    return;
  }
  await execute(baseToken, true, amountIn);

  async function execute(token: Address, baseForQuote: boolean, amount: bigint) {
    // Mint what we need from the open faucet, approve, swap.
    const held = (await pc.readContract({
      address: token,
      abi: TOKEN_ABI,
      functionName: "balanceOf",
      args: [account.address],
    })) as bigint;
    if (held < amount) {
      const h = await wallet.writeContract({
        address: token, abi: TOKEN_ABI, functionName: "mint",
        args: [account.address, amount - held], account, chain: sepolia,
      });
      await pc.waitForTransactionReceipt({ hash: h });
    }
    const allowance = (await pc.readContract({
      address: token, abi: TOKEN_ABI, functionName: "allowance", args: [account.address, pool],
    })) as bigint;
    if (allowance < amount) {
      const h = await wallet.writeContract({
        address: token, abi: TOKEN_ABI, functionName: "approve",
        args: [pool, (1n << 255n) - 1n], account, chain: sepolia,
      });
      await pc.waitForTransactionReceipt({ hash: h });
    }

    const h = await wallet.writeContract({
      address: pool, abi: POOL_ABI, functionName: "swap",
      args: [baseForQuote, amount, 0n, account.address], account, chain: sepolia,
    });
    const r = await pc.waitForTransactionReceipt({ hash: h });
    console.log(`swapped: ${env.eth.explorer}/tx/${r.transactionHash}`);

    const mid = (await pc.readContract({ address: pool, abi: POOL_ABI, functionName: "midPrice" })) as bigint;
    console.log(`new mid      $${Number(formatUnits(mid, 18)).toFixed(2)}`);
  }
}

main().catch((e) => {
  console.error("\n✗ rebalance failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
