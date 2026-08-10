/**
 * Index prices, from Chainlink on Ethereum Sepolia.
 *
 * This replaces the FTSO v2 reader the perps used on Flare. The rest of the
 * engine is oracle-agnostic — it wants a USD price per market and a way to know
 * when a feed is untrustworthy — so the export surface here is deliberately
 * identical to the one it replaced.
 *
 * Feeds are read on chain through `latestRoundData()`. Nothing is synthesised:
 * if a feed cannot be read, its market is disabled rather than quoted from a
 * stale or invented number, because a perp priced off a guess is worse than a
 * perp that refuses to quote.
 */
import { createPublicClient, http, type Address } from "viem";
import { sepolia } from "viem/chains";
import { env } from "./env.js";

/** Chainlink AggregatorV3, the two calls we need. */
const AGGREGATOR_ABI = [
  {
    name: "latestRoundData",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

export interface FeedPrice {
  feedId: string;
  price: number;
  /** Chainlink publishes no per-round confidence; kept for surface parity. */
  conf: number;
  /** Unix seconds of the on-chain update. */
  publishTime: number;
  fetchedAt: number;
}

const latest = new Map<string, FeedPrice>();
const disabled = new Set<string>();
const decimalsCache = new Map<string, number>();

/**
 * A feed whose last on-chain update is older than this is treated as stale.
 * Sepolia's Chainlink feeds update far less often than mainnet's, so this is
 * generous — but it is bounded, so a dead feed eventually disables its market
 * instead of quoting yesterday's price forever.
 */
const MAX_AGE_SEC = 24 * 60 * 60;

const client = () => createPublicClient({ chain: sepolia, transport: http(env.eth.rpcUrl) });

const norm = (feedId: string) => feedId.toLowerCase();

/** Read one aggregator. Throws if the feed is unreadable or non-positive. */
export async function readFeed(feedId: string): Promise<FeedPrice> {
  const pc = client();
  const address = feedId as Address;

  let dp = decimalsCache.get(norm(feedId));
  if (dp === undefined) {
    dp = Number(await pc.readContract({ address, abi: AGGREGATOR_ABI, functionName: "decimals" }));
    decimalsCache.set(norm(feedId), dp);
  }

  const [, answer, , updatedAt] = (await pc.readContract({
    address,
    abi: AGGREGATOR_ABI,
    functionName: "latestRoundData",
  })) as readonly [bigint, bigint, bigint, bigint, bigint];

  if (answer <= 0n) throw new Error("feed returned a non-positive answer");

  return {
    feedId: norm(feedId),
    price: Number(answer) / 10 ** dp,
    conf: 0,
    publishTime: Number(updatedAt),
    fetchedAt: Date.now(),
  };
}

/** Refresh every enabled feed once. Failures disable that market, loudly. */
export async function pollOnce(): Promise<void> {
  const { MARKETS } = await import("./markets.js");
  await Promise.all(
    MARKETS.map(async (m) => {
      try {
        const p = await readFeed(m.feedId);
        const age = Math.floor(Date.now() / 1000) - p.publishTime;
        if (age > MAX_AGE_SEC) {
          if (!disabled.has(norm(m.feedId))) {
            console.warn(`[oracle] ${m.symbol} stale by ${Math.round(age / 3600)}h — market disabled`);
          }
          disabled.add(norm(m.feedId));
          return;
        }
        disabled.delete(norm(m.feedId));
        latest.set(norm(m.feedId), p);
      } catch (e) {
        if (!disabled.has(norm(m.feedId))) {
          console.warn(`[oracle] ${m.symbol} unreadable — market disabled: ${String(e).slice(0, 120)}`);
        }
        disabled.add(norm(m.feedId));
      }
    }),
  );
}

/** Startup check: prove every market has a live feed before serving. */
export async function validateFeeds(): Promise<void> {
  const { MARKETS } = await import("./markets.js");
  console.log(`[oracle] Chainlink on ${env.eth.network} (chain ${env.eth.chainId})`);
  await pollOnce();
  for (const m of MARKETS) {
    const p = latest.get(norm(m.feedId));
    if (p) console.log(`[oracle] ${m.symbol} feed ok — $${p.price.toFixed(6)}`);
    else console.warn(`[oracle] ${m.symbol} has no price — market disabled`);
  }
}

export function getPrice(feedId: string): FeedPrice | undefined {
  return latest.get(norm(feedId));
}

/** TEST-ONLY: inject a deterministic price without touching the network. */
export function _setPriceForTest(feedId: string, price: number): void {
  latest.set(norm(feedId), {
    feedId: norm(feedId),
    price,
    conf: 0,
    publishTime: Math.floor(Date.now() / 1000),
    fetchedAt: Date.now(),
  });
  disabled.delete(norm(feedId));
}

export function isFeedDisabled(feedId: string): boolean {
  return disabled.has(norm(feedId));
}

let polling: ReturnType<typeof setInterval> | undefined;

export function startPricePolling(): void {
  if (polling) return;
  polling = setInterval(() => {
    void pollOnce();
  }, env.oracle.pollMs);
}
