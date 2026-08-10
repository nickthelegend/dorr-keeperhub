/**
 * Duel history and the savings leaderboard.
 *
 * Backed by SQLite (see db.ts). The public surface is unchanged from the JSON
 * implementation this replaced, so callers didn't have to move.
 *
 * The one rule worth stating twice: a saving is only claimed when BOTH lanes
 * actually executed. An errored lane has no shortfall to compare against, and
 * treating its absence as "$0 lost" silently credits the private lane with the
 * public lane's entire loss. That rule lives in `savingFor` and is applied both
 * when writing a row and when aggregating, so a stored value can never drift
 * away from the definition.
 */
import type { Database } from "bun:sqlite";
import { database, insertDuelRow } from "./db.js";

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
  /** publicShortfallUsd - privateShortfallUsd, when both lanes completed. */
  savedUsd: number;
  notes?: string[];
}

/** A saving is only claimed when both lanes actually completed. */
export function savingFor(d: Duel): number {
  if (!d.public || d.public.error || !d.private || d.private.error) return 0;
  return Math.max(0, (d.public.shortfallUsd ?? 0) - (d.private.shortfallUsd ?? 0));
}

interface Row {
  id: string;
  at: string;
  amount_in: string;
  base_for_quote: number;
  slippage_bps: number;
  pool: string;
  chain_id: number;
  notes: string;
  public_lane: string | null;
  private_lane: string | null;
}

function toDuel(r: Row): Duel {
  const pub = r.public_lane ? (JSON.parse(r.public_lane) as LaneResult) : undefined;
  const priv = r.private_lane ? (JSON.parse(r.private_lane) as LaneResult) : undefined;
  const duel: Duel = {
    id: r.id,
    at: r.at,
    amountIn: r.amount_in,
    baseForQuote: Boolean(r.base_for_quote),
    slippageBps: r.slippage_bps,
    pool: r.pool,
    chainId: r.chain_id,
    public: pub,
    private: priv,
    savedUsd: 0,
    notes: JSON.parse(r.notes) as string[],
  };
  duel.savedUsd = savingFor(duel);
  return duel;
}

const SELECT = `SELECT id, at, amount_in, base_for_quote, slippage_bps, pool, chain_id,
                       notes, public_lane, private_lane FROM duels`;

/** Opens the database (and imports any legacy JSON) — call once at startup. */
export function loadDuels(): { duels: Duel[] } {
  return { duels: listDuels(1_000_000) };
}

export function recordDuel(d: Duel): Duel {
  d.savedUsd = savingFor(d);
  insertDuelRow(database(), d);
  return d;
}

export function listDuels(limit = 50): Duel[] {
  const rows = database()
    .query(`${SELECT} ORDER BY at DESC LIMIT ?`)
    .all(limit) as unknown as Row[];
  return rows.map(toDuel);
}

export function getDuel(id: string): Duel | undefined {
  const row = database().query(`${SELECT} WHERE id = ?`).get(id) as unknown as Row | null;
  return row ? toDuel(row) : undefined;
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
 * The number the pitch rests on. Aggregated in SQL over the stored rows —
 * nothing here is estimated, extrapolated, or annualised, and there is no
 * cached total that could disagree with the underlying data.
 */
export function leaderboard(): Leaderboard {
  const db: Database = database();

  const agg = db
    .query(
      `SELECT
         COUNT(*)                                          AS duels,
         COALESCE(SUM(sandwich_landed), 0)                 AS landed,
         COALESCE(SUM(public_seen), 0)                     AS public_seen,
         COALESCE(SUM(private_seen), 0)                    AS private_seen,
         COALESCE(SUM(public_loss_usd), 0)                 AS lost,
         COALESCE(MAX(public_loss_usd), 0)                 AS worst,
         COALESCE(SUM(
           CASE WHEN public_lane IS NOT NULL AND public_error = 0
                 AND private_lane IS NOT NULL AND private_error = 0
                THEN MAX(public_loss_usd - private_loss_usd, 0)
                ELSE 0 END), 0)                            AS saved,
         COALESCE(SUM(CASE WHEN public_lane IS NOT NULL AND public_error = 0
                           THEN 1 ELSE 0 END), 0)          AS public_trades
       FROM duels`,
    )
    .get() as {
    duels: number;
    landed: number;
    public_seen: number;
    private_seen: number;
    lost: number;
    worst: number;
    saved: number;
    public_trades: number;
  };

  const entries = listDuels(25).map((d) => ({
    id: d.id,
    at: d.at,
    amountIn: d.amountIn,
    lostUsd: d.public?.shortfallUsd ?? 0,
    savedUsd: d.savedUsd,
    sandwichLanded: Boolean(d.public?.sandwich?.landed),
    publicTx: d.public?.transactionLink,
    privateTx: d.private?.transactionLink,
  }));

  return {
    duels: agg.duels,
    sandwichesLanded: agg.landed,
    publicSeenInMempool: agg.public_seen,
    privateSeenInMempool: agg.private_seen,
    totalLostUsd: agg.lost,
    totalSavedUsd: agg.saved,
    worstSingleLossUsd: agg.worst,
    avgLossPerPublicTradeUsd: agg.public_trades ? agg.lost / agg.public_trades : 0,
    entries,
  };
}

/** Pure aggregation over a supplied set — used by tests, no I/O. */
export function computeLeaderboard(duels: Duel[]): Leaderboard {
  const lost = duels.reduce((s, d) => s + (d.public?.shortfallUsd ?? 0), 0);
  const publicTrades = duels.filter((d) => d.public && !d.public.error);
  return {
    duels: duels.length,
    sandwichesLanded: duels.filter((d) => d.public?.sandwich?.landed).length,
    publicSeenInMempool: duels.filter((d) => d.public?.seenInMempool).length,
    privateSeenInMempool: duels.filter((d) => d.private?.seenInMempool).length,
    totalLostUsd: lost,
    totalSavedUsd: duels.reduce((s, d) => s + savingFor(d), 0),
    worstSingleLossUsd: duels.reduce((m, d) => Math.max(m, d.public?.shortfallUsd ?? 0), 0),
    avgLossPerPublicTradeUsd: publicTrades.length ? lost / publicTrades.length : 0,
    entries: duels.slice(0, 25).map((d) => ({
      id: d.id,
      at: d.at,
      amountIn: d.amountIn,
      lostUsd: d.public?.shortfallUsd ?? 0,
      savedUsd: savingFor(d),
      sandwichLanded: Boolean(d.public?.sandwich?.landed),
      publicTx: d.public?.transactionLink,
      privateTx: d.private?.transactionLink,
    })),
  };
}
