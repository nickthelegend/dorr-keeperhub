/**
 * The duel: run the same trade twice, change one thing, price the difference.
 *
 * Experimental design, stated plainly because the whole product is a claim
 * about causation:
 *
 *   CONTROLLED  — same pool, same trade size, same slippage tolerance, same
 *                 signing wallet, same relayer, same gas sponsorship, same
 *                 chain, back to back.
 *   VARIED      — one boolean: `usePrivateMempool`.
 *   MEASURED    — (a) did an independent mempool observer see the transaction
 *                 before it was mined, and (b) how far below its own pre-trade
 *                 quote did the trade actually fill.
 *
 * (a) is the mechanism and (b) is the damage. Reporting (b) without (a) would
 * be a just-so story: a trade can underfill for reasons that have nothing to do
 * with MEV. Reporting them together is what makes the dollar figure an
 * attribution rather than a coincidence.
 *
 * Each lane is quoted against the reserves standing immediately before its own
 * execution, so the two lanes are compared on shortfall-versus-own-quote rather
 * than on raw output. Otherwise the second lane would be penalised purely for
 * running second.
 */
import { randomUUID } from "node:crypto";
import {
  createPublicClient,
  decodeEventLog,
  formatUnits,
  http,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { sepolia } from "viem/chains";
import { env } from "../env.js";
import { POOL_ABI, TOKEN_ABI } from "./artifacts.js";
import * as kh from "./keeperhub.js";
import { executePrivately } from "./private-lane.js";
import { Searcher, type SandwichAttempt } from "./searcher.js";
import { recordDuel, type Duel, type LaneResult } from "./store.js";

export interface DuelParams {
  /** Human units of the input token, e.g. "10" for 10 mETH. */
  amountIn?: string;
  /** true: sell base for quote (loss lands directly in USD). */
  baseForQuote?: boolean;
  /** Victim's slippage tolerance — and therefore the attacker's budget. */
  slippageBps?: number;
  /** Skip the attack and only measure mempool exposure. */
  observeOnly?: boolean;
}

const DECIMALS = 18;

function client(): PublicClient {
  return createPublicClient({ chain: sepolia, transport: http(env.eth.rpcUrl) }) as PublicClient;
}

function requireConfig(): void {
  if (!env.mev.pool) throw new Error("MEV_POOL not set — deploy the lab first (mev-deploy.ts)");
  if (!kh.isConfigured()) throw new Error("KEEPERHUB_API_KEY not set");
}

/** Pull the realised output straight out of the pool's own Swap event. */
async function actualOutFromReceipt(pc: PublicClient, hash: Hex, pool: Address): Promise<bigint | undefined> {
  const receipt = await pc.getTransactionReceipt({ hash });
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== pool.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: POOL_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName === "Swap") {
        return (decoded.args as unknown as { amountOut: bigint }).amountOut;
      }
    } catch {
      // Not the event we want; keep scanning.
    }
  }
  return undefined;
}

/**
 * Ensure the KeeperHub wallet holds enough input token and has approved the
 * pool. Both go through KeeperHub with sponsored gas — the trading wallet never
 * needs a wei of ETH, which is itself part of the story.
 */
export async function ensureTradingWalletReady(
  wallet: Address,
  tokenIn: Address,
  needed: bigint,
): Promise<{ minted: boolean; approved: boolean }> {
  const pc = client();
  const pool = env.mev.pool as Address;

  const balance = (await pc.readContract({
    address: tokenIn,
    abi: TOKEN_ABI,
    functionName: "balanceOf",
    args: [wallet],
  })) as bigint;

  let minted = false;
  if (balance < needed) {
    const topUp = needed * 10n; // amortise the round-trip over many duels
    const r = await kh.contractCall({
      contractAddress: tokenIn,
      functionName: "mint",
      abi: TOKEN_ABI as unknown[],
      args: [wallet, topUp],
    });
    if (r.error) throw new Error(`faucet mint failed: ${r.error}`);
    if (r.executionId) await kh.waitForExecution(r.executionId);
    minted = true;
  }

  const allowance = (await pc.readContract({
    address: tokenIn,
    abi: TOKEN_ABI,
    functionName: "allowance",
    args: [wallet, pool],
  })) as bigint;

  let approved = false;
  if (allowance < needed) {
    const r = await kh.contractCall({
      contractAddress: tokenIn,
      functionName: "approve",
      abi: TOKEN_ABI as unknown[],
      args: [pool, (1n << 255n) - 1n],
    });
    if (r.error) throw new Error(`approve failed: ${r.error}`);
    if (r.executionId) await kh.waitForExecution(r.executionId);
    approved = true;
  }

  return { minted, approved };
}

interface LaneOpts {
  lane: "public" | "private";
  amountIn: bigint;
  baseForQuote: boolean;
  slippageBps: number;
  searcher: Searcher;
  attack: boolean;
}

async function runLane(o: LaneOpts): Promise<LaneResult> {
  const pc = client();
  const pool = env.mev.pool as Address;

  // Quote against the reserves standing right now — this is the number the
  // trader would have seen, and the counterfactual we measure against.
  const quotedOut = (await pc.readContract({
    address: pool,
    abi: POOL_ABI,
    functionName: "getAmountOut",
    args: [o.baseForQuote, o.amountIn],
  })) as bigint;
  const minOut = (quotedOut * BigInt(10_000 - o.slippageBps)) / 10_000n;

  const result: LaneResult = {
    lane: o.lane,
    quotedOut: quotedOut.toString(),
    actualOut: "0",
    shortfall: "0",
    shortfallUsd: 0,
    seenInMempool: false,
  };

  // Arm the adversary before the trade can possibly reach the mempool.
  let waitForAttempt: () => Promise<SandwichAttempt | undefined> = async () => undefined;
  if (o.attack) {
    let resolveAttempt: (v: SandwichAttempt | undefined) => void = () => {};
    const attempted = new Promise<SandwichAttempt | undefined>((r) => (resolveAttempt = r));
    o.searcher.arm((a) => resolveAttempt(a));
    // The searcher may never fire (nothing to extract, or it lost the race).
    // Cap the wait so a quiet run still produces a result instead of hanging.
    waitForAttempt = () =>
      Promise.race([
        attempted,
        new Promise<undefined>((r) => setTimeout(() => r(undefined), 210_000)),
      ]);
  }

  try {
    const trader = await kh.orgWallet();
    let txHash: Hex | undefined;

    if (o.lane === "private") {
      // Workflow path — the only one where private routing is real.
      const exec = await executePrivately({
        pool,
        baseForQuote: o.baseForQuote,
        amountIn: o.amountIn,
        minAmountOut: minOut,
        recipient: trader,
      });
      result.executionId = exec.executionId;
      txHash = exec.transactions[0]?.hash;
      if (!txHash) {
        result.error = exec.error || `private workflow ended in "${exec.status}" with no transaction`;
        return result;
      }
      result.transactionLink = `${env.eth.explorer}/tx/${txHash}`;
    } else {
      // Public path — the sponsored REST executor, which broadcasts openly.
      const exec = await kh.contractCall({
        contractAddress: pool,
        functionName: "swap",
        abi: POOL_ABI as unknown[],
        args: [o.baseForQuote, o.amountIn, minOut, trader],
        idempotencyKey: randomUUID(),
      });
      if (exec.error) {
        result.error = exec.error;
        return result;
      }
      result.executionId = exec.executionId;
      const final = exec.transactionHash ? exec : await kh.waitForExecution(exec.executionId);
      txHash = final.transactionHash;
      result.transactionLink = final.transactionLink;
      if (!txHash) {
        result.error = final.error || `no transaction hash (status ${final.status})`;
        return result;
      }
    }

    result.transactionHash = txHash;

    // THE measurement. Did our own independent observer catch it in flight?
    const sighting = o.searcher.sawInMempool(txHash);
    result.seenInMempool = Boolean(sighting);

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash, timeout: 180_000 });
    result.blockNumber = Number(receipt.blockNumber);
    if (sighting) {
      const block = await pc.getBlock({ blockNumber: receipt.blockNumber });
      result.mempoolExposureMs = Number(block.timestamp) * 1000 - sighting.firstSeenAt;
    }

    const actualOut = (await actualOutFromReceipt(pc, txHash, pool)) ?? 0n;
    result.actualOut = actualOut.toString();
    const shortfall = quotedOut > actualOut ? quotedOut - actualOut : 0n;
    result.shortfall = shortfall.toString();
    // Quote token is an 18dp USD stand-in, so a base->quote shortfall is
    // already denominated in dollars. A quote->base shortfall is in base units
    // and is converted at the pool's mid price.
    if (o.baseForQuote) {
      result.shortfallUsd = Number(formatUnits(shortfall, DECIMALS));
    } else {
      const mid = (await pc.readContract({
        address: pool,
        abi: POOL_ABI,
        functionName: "midPrice",
      })) as bigint;
      result.shortfallUsd = Number(formatUnits((shortfall * mid) / 10n ** 18n, DECIMALS));
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  } finally {
    if (o.attack) {
      const attempt = await waitForAttempt();
      o.searcher.disarm();
      if (attempt) {
        result.sandwich = {
          landed: Boolean(attempt.landed),
          frontRunHash: attempt.frontRun?.hash,
          backRunHash: attempt.backRun?.hash,
          reactionMs: attempt.reactionMs,
          searcherProfit: attempt.profit,
          error: attempt.error,
        };
      }
    }
  }

  return result;
}

export interface RunDuelResult extends Duel {
  searcherAddress?: string;
  observerSightings: number;
}

/**
 * Run both lanes back to back and persist the result.
 *
 * Public lane first: it is the one that needs a live adversary, and running it
 * while the searcher is freshly connected gives the attack its best shot. A
 * demo that stacked the deck the other way would flatter the private lane.
 */
export async function runDuel(p: DuelParams = {}): Promise<RunDuelResult> {
  requireConfig();

  const amountIn = parseUnits(p.amountIn ?? "10", DECIMALS);
  const baseForQuote = p.baseForQuote ?? true;
  const slippageBps = p.slippageBps ?? 100;
  const pool = env.mev.pool as Address;
  const pc = client();
  const notes: string[] = [];

  const wallet = await kh.orgWallet();
  const tokenIn = (await pc.readContract({
    address: pool,
    abi: POOL_ABI,
    functionName: baseForQuote ? "base" : "quote",
  })) as Address;

  // Two lanes plus headroom, so the second lane can't fail for want of funds.
  const prep = await ensureTradingWalletReady(wallet, tokenIn, amountIn * 3n);
  if (prep.minted) notes.push("trading wallet topped up from the token faucet (gas sponsored)");
  if (prep.approved) notes.push("pool approved by the trading wallet (gas sponsored)");

  const searcher = new Searcher(pool);
  searcher.start();
  try {
    await searcher.waitUntilConnected();
  } catch (e) {
    // Without the observer there is no measurement, only an assertion.
    searcher.stop();
    throw new Error(
      `cannot run a duel without a live mempool feed (${e instanceof Error ? e.message : e})`,
    );
  }

  let publicLane: LaneResult | undefined;
  let privateLane: LaneResult | undefined;
  try {
    publicLane = await runLane({
      lane: "public",
      amountIn,
      baseForQuote,
      slippageBps,
      searcher,
      attack: !p.observeOnly && Boolean(env.mev.searcherKey),
    });
    if (!env.mev.searcherKey) {
      notes.push("no searcher key configured — measured mempool exposure only, no live sandwich");
    }

    privateLane = await runLane({
      lane: "private",
      amountIn,
      baseForQuote,
      slippageBps,
      searcher,
      attack: false,
    });
  } finally {
    searcher.stop();
  }

  // A lane that errored has no shortfall to compare — treating its missing
  // result as "$0 lost" would credit the private lane with a saving it never
  // demonstrated. Savings are only claimed when both lanes actually executed.
  const bothLanded = Boolean(publicLane && !publicLane.error && privateLane && !privateLane.error);
  const savedUsd = bothLanded
    ? Math.max(0, (publicLane!.shortfallUsd ?? 0) - (privateLane!.shortfallUsd ?? 0))
    : 0;
  if (!bothLanded) {
    notes.push("one lane did not complete — no saving is claimed for this duel");
  }

  if (publicLane?.seenInMempool && privateLane?.seenInMempool) {
    notes.push(
      "BOTH lanes were visible in the public mempool — private routing did not take effect for this run",
    );
  }
  if (publicLane && !publicLane.seenInMempool) {
    notes.push(
      "the public lane was not caught in the mempool either — the observer may have missed it, so no attribution is claimed for this run",
    );
  }

  const duel: Duel = {
    id: randomUUID(),
    at: new Date().toISOString(),
    amountIn: amountIn.toString(),
    baseForQuote,
    slippageBps,
    pool,
    chainId: env.eth.chainId,
    public: publicLane,
    private: privateLane,
    savedUsd,
    notes,
  };
  recordDuel(duel);

  return {
    ...duel,
    searcherAddress: searcher.address,
    observerSightings: searcher.allSightings().length,
  };
}
