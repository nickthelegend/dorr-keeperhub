/**
 * Duel history and the savings leaderboard.
 *
 * Separate file from the trading state on purpose: a duel is an experimental
 * record, not ledger state, and it must survive independently of any operator
 * bookkeeping. Same atomic write-then-rename discipline as `state.ts` so a
 * crash mid-write cannot leave a truncated results file behind — a corrupted
 * results file would silently reset the leaderboard, which is the one number
 * this project asks people to trust.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DORR_ROOT } from "../env.js";

// Same directory the operator's trading state uses, so all persisted state
// lives in one place and one backup captures everything.
const DATA_DIR = resolve(DORR_ROOT, "services/operator/data");
const DUELS_PATH = resolve(DATA_DIR, "mev-duels.json");

export interface LaneResult {
  lane: "public" | "private";
  /** What the pool quoted at the reserves the trader saw before signing. */
  quotedOut: string;
  /** What actually arrived, read from the Swap event. */
  actualOut: string;
  /** quotedOut - actualOut, in quote-token units (never negative). */
  shortfall: string;
  /** Shortfall in USD. The quote token is an 18dp USD stand-in. */
  shortfallUsd: number;
  transactionHash?: string;
  transactionLink?: string;
  blockNumber?: number;
  executionId?: string;
  /**
   * The whole claim, in one field: did our independent mempool observer see
   * this transaction before it was mined?
   */
  seenInMempool: boolean;
  /** ms between the observer's first sighting and inclusion, when seen. */
  mempoolExposureMs?: number;
  /** Populated on the public lane when the searcher actually got a sandwich in. */
  sandwich?: {
    landed: boolean;
    frontRunHash?: string;
    backRunHash?: string;
    reactionMs?: number;
    searcherProfit?: string;
    error?: string;
  };
  error?: string;
}

export interface Duel {
  id: string;
  at: string;
  /** Trade under test, identical across both lanes. */
  amountIn: string;
  baseForQuote: boolean;
  slippageBps: number;
  pool: string;
  chainId: number;
  public?: LaneResult;
  private?: LaneResult;
  /** publicShortfallUsd - privateShortfallUsd. What the private lane saved. */
  savedUsd: number;
  notes?: string[];
}

interface DuelFile {
  version: 1;
  duels: Duel[];
}

const empty = (): DuelFile => ({ version: 1, duels: [] });

let file: DuelFile = empty();
let loaded = false;

export function loadDuels(): DuelFile {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(DUELS_PATH)) {
    try {
      file = { ...empty(), ...JSON.parse(readFileSync(DUELS_PATH, "utf8")) };
    } catch {
      // A damaged history must not take the operator down with it, but it also
      // must not masquerade as "no duels yet" — keep the bad file for forensics.
      try {
        renameSync(DUELS_PATH, `${DUELS_PATH}.corrupt.${Date.now()}`);
      } catch {
        /* best effort */
      }
      file = empty();
    }
  }
  // `savedUsd` is derived, so it is recomputed on load rather than trusted.
  // Early runs recorded a saving for duels whose private lane errored, which
  // credited the private lane with a result it never produced. Recomputing here
  // keeps historical rows consistent with the current definition instead of
  // leaving a number in the leaderboard that today's code would never emit.
  let migrated = false;
  for (const d of file.duels) {
    for (const lane of [d.public, d.private]) {
      if (lane && normaliseStoredHash(lane)) migrated = true;
    }
    const corrected = savingFor(d);
    if (d.savedUsd !== corrected) {
      d.savedUsd = corrected;
      migrated = true;
    }
  }
  loaded = true;
  // Write the corrections back so the file on disk and the served leaderboard
  // never disagree — anyone reading data/mev-duels.json directly should see the
  // same numbers the API reports.
  if (migrated) persist();
  return file;
}

/**
 * Repair a lane whose hash was stored as the workflow's `{hash, blockNumber…}`
 * object rather than a plain string.
 *
 * Workflow executions report transactions as objects while the REST executor
 * reports a bare string; an early run recorded the object verbatim, which
 * rendered as an explorer link to `/tx/[object Object]`. The real hash is
 * present inside that object, so this recovers it rather than discarding a
 * genuine, verifiable transaction. Returns true when it changed something.
 */
function normaliseStoredHash(lane: LaneResult): boolean {
  const raw = lane.transactionHash as unknown;
  if (!raw || typeof raw === "string") return false;
  const hash = (raw as { hash?: unknown }).hash;
  if (typeof hash !== "string") return false;
  lane.transactionHash = hash;
  if (!lane.transactionLink || lane.transactionLink.includes("[object")) {
    lane.transactionLink = `https://sepolia.etherscan.io/tx/${hash}`;
  }
  const block = (raw as { blockNumber?: unknown }).blockNumber;
  if (lane.blockNumber == null && typeof block === "number") lane.blockNumber = block;
  return true;
}

/** A saving is only claimed when both lanes actually completed. */
export function savingFor(d: Duel): number {
  if (!d.public || d.public.error || !d.private || d.private.error) return 0;
  return Math.max(0, (d.public.shortfallUsd ?? 0) - (d.private.shortfallUsd ?? 0));
}

function ensure(): DuelFile {
  if (!loaded) loadDuels();
  return file;
}

function persist(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DUELS_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2));
  renameSync(tmp, DUELS_PATH);
}

export function recordDuel(d: Duel): Duel {
  const f = ensure();
  d.savedUsd = savingFor(d);
  f.duels.push(d);
  persist();
  return d;
}

export function listDuels(limit = 50): Duel[] {
  return ensure().duels.slice(-limit).reverse();
}

export function getDuel(id: string): Duel | undefined {
  return ensure().duels.find((d) => d.id === id);
}

export interface Leaderboard {
  duels: number;
  /** Duels where the searcher actually landed a sandwich on the public lane. */
  sandwichesLanded: number;
  /** Public-lane transactions our observer caught in the mempool. */
  publicSeenInMempool: number;
  /** Private-lane transactions our observer caught. Should be zero. */
  privateSeenInMempool: number;
  totalLostUsd: number;
  totalSavedUsd: number;
  worstSingleLossUsd: number;
  avgLossPerPublicTradeUsd: number;
  entries: Array<{
    id: string;
    at: string;
    amountIn: string;
    lostUsd: number;
    savedUsd: number;
    sandwichLanded: boolean;
    publicTx?: string;
    privateTx?: string;
  }>;
}

/**
 * The number the pitch rests on. Computed from persisted duels only — nothing
 * here is estimated, extrapolated, or annualised.
 */
export function leaderboard(): Leaderboard {
  return computeLeaderboard(ensure().duels);
}

/** Pure form, so the aggregation can be tested without touching the real file. */
export function computeLeaderboard(duels: Duel[]): Leaderboard {
  const lost = duels.reduce((s, d) => s + (d.public?.shortfallUsd ?? 0), 0);
  const saved = duels.reduce((s, d) => s + savingFor(d), 0);
  const publicTrades = duels.filter((d) => d.public && !d.public.error);
  return {
    duels: duels.length,
    sandwichesLanded: duels.filter((d) => d.public?.sandwich?.landed).length,
    publicSeenInMempool: duels.filter((d) => d.public?.seenInMempool).length,
    privateSeenInMempool: duels.filter((d) => d.private?.seenInMempool).length,
    totalLostUsd: lost,
    totalSavedUsd: saved,
    worstSingleLossUsd: duels.reduce((m, d) => Math.max(m, d.public?.shortfallUsd ?? 0), 0),
    avgLossPerPublicTradeUsd: publicTrades.length ? lost / publicTrades.length : 0,
    entries: duels
      .slice(-25)
      .reverse()
      .map((d) => ({
        id: d.id,
        at: d.at,
        amountIn: d.amountIn,
        lostUsd: d.public?.shortfallUsd ?? 0,
        savedUsd: d.savedUsd,
        sandwichLanded: Boolean(d.public?.sandwich?.landed),
        publicTx: d.public?.transactionLink,
        privateTx: d.private?.transactionLink,
      })),
  };
}
