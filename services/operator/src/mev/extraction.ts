/**
 * What your slippage tolerance is actually worth — to the attacker.
 *
 * A duel proves the loss is real, but it takes minutes and costs gas, and it
 * only ever shows one point. This shows the whole curve at once, instantly, and
 * it is the argument the project is really making:
 *
 *   A slippage tolerance is not protection. It is the amount you have agreed to
 *   lose, published in advance, and a searcher will take exactly that much.
 *
 * The load-bearing number comes off the chain. `maxExtractableFrontRun` is a
 * view function on the deployed pool that solves for the largest front-run
 * leaving the victim one wei above their own limit — the trade a rational
 * searcher makes. It is called here per tolerance against live reserves, so
 * every row is a real answer from the real contract about the real pool state.
 *
 * The attacker's round trip (what they net after buying back) is then computed
 * from those same live reserves with the pool's own constant-product formula.
 * That is arithmetic, not a simulation of something we couldn't measure: the
 * inputs are on-chain and the formula is the contract's.
 */
import { createPublicClient, formatUnits, http, parseUnits, type Address } from "viem";
import { sepolia } from "viem/chains";
import { env } from "../env.js";
import { POOL_ABI } from "./artifacts.js";

/** Tolerances a real UI would offer, from tight to careless. */
export const TOLERANCES_BPS = [10, 25, 50, 100, 200, 300, 500, 1000];

const FEE_BPS = 30n;
const BPS = 10_000n;

/** The pool's own `getAmountOut`, applied to a hypothetical reserve state. */
function amountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const afterFee = amountIn * (BPS - FEE_BPS);
  return (afterFee * reserveOut) / (reserveIn * BPS + afterFee);
}

export interface ExtractionPoint {
  slippageBps: number;
  /** What the trader is quoted right now. */
  quotedOut: string;
  /** The floor they have signed up to accept. */
  minOut: string;
  /** quoted - minOut, in dollars: the most this tolerance can cost them. */
  maxLossUsd: number;
  /** Capital the searcher must front with to take all of it. */
  attackerCapitalBase: string;
  /** What the searcher nets on the round trip, in dollars. */
  attackerProfitUsd: number;
  /** Left on the table for LPs as fees — value moved, not created. */
  toLiquidityProvidersUsd: number;
}

export interface ExtractionCurve {
  pool: Address;
  amountIn: string;
  midPriceUsd: number;
  reserveBase: string;
  reserveQuote: string;
  points: ExtractionPoint[];
  note: string;
}

/**
 * Price every tolerance against the pool as it stands right now.
 */
export async function extractionCurve(amountInHuman = "10"): Promise<ExtractionCurve> {
  if (!env.mev.pool) throw new Error("MEV_POOL not set — deploy the lab first");
  const pool = env.mev.pool as Address;
  const pc = createPublicClient({ chain: sepolia, transport: http(env.eth.rpcUrl) });
  const amountIn = parseUnits(amountInHuman, 18);

  const [reserveBase, reserveQuote, quotedOut, midPrice] = (await Promise.all([
    pc.readContract({ address: pool, abi: POOL_ABI, functionName: "reserveBase" }),
    pc.readContract({ address: pool, abi: POOL_ABI, functionName: "reserveQuote" }),
    pc.readContract({ address: pool, abi: POOL_ABI, functionName: "getAmountOut", args: [true, amountIn] }),
    pc.readContract({ address: pool, abi: POOL_ABI, functionName: "midPrice" }),
  ])) as [bigint, bigint, bigint, bigint];

  // One on-chain call per tolerance, in parallel — the contract answers what an
  // attacker is allowed to take, rather than us guessing.
  const budgets = (await Promise.all(
    TOLERANCES_BPS.map((bps) => {
      const minOut = (quotedOut * BigInt(10_000 - bps)) / 10_000n;
      return pc.readContract({
        address: pool,
        abi: POOL_ABI,
        functionName: "maxExtractableFrontRun",
        args: [true, amountIn, minOut],
      }) as Promise<bigint>;
    }),
  )) as bigint[];

  const usd = (v: bigint) => Number(formatUnits(v, 18));

  const points: ExtractionPoint[] = TOLERANCES_BPS.map((bps, i) => {
    const minOut = (quotedOut * BigInt(10_000 - bps)) / 10_000n;
    const capital = budgets[i];

    // Walk the attacker's round trip over the live reserves.
    const attackerQuoteOut = amountOut(capital, reserveBase, reserveQuote);
    const afterFrontBase = reserveBase + capital;
    const afterFrontQuote = reserveQuote - attackerQuoteOut;

    const victimOut = amountOut(amountIn, afterFrontBase, afterFrontQuote);
    const afterVictimBase = afterFrontBase + amountIn;
    const afterVictimQuote = afterFrontQuote - victimOut;

    const backBase = amountOut(attackerQuoteOut, afterVictimQuote, afterVictimBase);
    const profitBase = backBase > capital ? backBase - capital : 0n;
    const profitUsd = usd((profitBase * midPrice) / 10n ** 18n);
    const lossUsd = usd(quotedOut - victimOut);

    return {
      slippageBps: bps,
      quotedOut: quotedOut.toString(),
      minOut: minOut.toString(),
      maxLossUsd: lossUsd,
      attackerCapitalBase: capital.toString(),
      attackerProfitUsd: profitUsd,
      toLiquidityProvidersUsd: Math.max(0, lossUsd - profitUsd),
    };
  });

  return {
    pool,
    amountIn: amountIn.toString(),
    midPriceUsd: usd(midPrice),
    reserveBase: reserveBase.toString(),
    reserveQuote: reserveQuote.toString(),
    points,
    note:
      "maxExtractableFrontRun is read from the deployed pool per tolerance; the attacker's round trip is then walked over those same live reserves with the pool's own constant-product formula",
  };
}
