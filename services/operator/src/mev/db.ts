/**
 * The duel database.
 *
 * SQLite, via Bun's built-in driver. This replaced a JSON file that was
 * rewritten in full on every write, which had two real problems: a second
 * operator process could clobber the first's results wholesale (observed), and
 * every read deserialised the entire history to answer a query about one row.
 *
 * The leaderboard is the number this project asks people to believe, so its
 * storage should not be the weakest link in the argument. WAL mode gives
 * concurrent readers a consistent view while a duel is being written, and the
 * aggregates are computed by SQL over the stored rows rather than by folding
 * an in-memory array — there is no cached total that can drift from the data.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { DORR_ROOT } from "../env.js";

const DATA_DIR = resolve(DORR_ROOT, "services/operator/data");
const DB_PATH = resolve(DATA_DIR, "mev.sqlite");
/** Pre-SQLite history, imported once on first open. */
const LEGACY_JSON = resolve(DATA_DIR, "mev-duels.json");

let db: Database | undefined;

export function database(): Database {
  if (db) return db;
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  db = new Database(DB_PATH, { create: true });
  // WAL so a long-running duel's write never blocks the leaderboard being read.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS duels (
      id              TEXT PRIMARY KEY,
      at              TEXT NOT NULL,
      amount_in       TEXT NOT NULL,
      base_for_quote  INTEGER NOT NULL,
      slippage_bps    INTEGER NOT NULL,
      pool            TEXT NOT NULL,
      chain_id        INTEGER NOT NULL,
      notes           TEXT NOT NULL DEFAULT '[]',
      -- Lanes are stored as JSON: they are read as whole objects, never queried
      -- field-by-field, and their shape tracks what the chain and relayer
      -- return. The columns that the leaderboard aggregates are lifted out
      -- below so SQL can sum them directly.
      public_lane     TEXT,
      private_lane    TEXT,
      public_error    INTEGER NOT NULL DEFAULT 0,
      private_error   INTEGER NOT NULL DEFAULT 0,
      public_loss_usd REAL NOT NULL DEFAULT 0,
      private_loss_usd REAL NOT NULL DEFAULT 0,
      public_seen     INTEGER NOT NULL DEFAULT 0,
      private_seen    INTEGER NOT NULL DEFAULT 0,
      sandwich_landed INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS duels_at ON duels (at DESC);
  `);

  importLegacyJson(db);
  return db;
}

/**
 * One-time import of the pre-SQLite JSON history.
 *
 * The duels recorded before this migration are real measured results with real
 * transaction hashes; dropping them would quietly reset the leaderboard. The
 * file is renamed rather than deleted so the original stays recoverable.
 */
function importLegacyJson(handle: Database): void {
  if (!existsSync(LEGACY_JSON)) return;
  try {
    const parsed = JSON.parse(readFileSync(LEGACY_JSON, "utf8")) as { duels?: unknown[] };
    const rows = Array.isArray(parsed.duels) ? parsed.duels : [];
    const insert = handle.transaction((items: any[]) => {
      for (const d of items) insertDuelRow(handle, d);
    });
    insert(rows);
    renameSync(LEGACY_JSON, `${LEGACY_JSON}.imported`);
    if (rows.length) console.log(`[mev] imported ${rows.length} duel(s) from JSON into SQLite`);
  } catch (e) {
    console.warn(`[mev] legacy duel import skipped: ${String(e).slice(0, 140)}`);
  }
}

/** Shared row writer, used by both the importer and `recordDuel`. */
export function insertDuelRow(handle: Database, d: any): void {
  const pub = d.public ?? null;
  const priv = d.private ?? null;
  handle
    .query(
      `INSERT OR REPLACE INTO duels (
        id, at, amount_in, base_for_quote, slippage_bps, pool, chain_id, notes,
        public_lane, private_lane, public_error, private_error,
        public_loss_usd, private_loss_usd, public_seen, private_seen, sandwich_landed
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      d.id,
      d.at,
      String(d.amountIn),
      d.baseForQuote ? 1 : 0,
      Number(d.slippageBps ?? 0),
      String(d.pool ?? ""),
      Number(d.chainId ?? 0),
      JSON.stringify(d.notes ?? []),
      pub ? JSON.stringify(pub) : null,
      priv ? JSON.stringify(priv) : null,
      pub?.error ? 1 : 0,
      priv?.error ? 1 : 0,
      Number(pub?.shortfallUsd ?? 0),
      Number(priv?.shortfallUsd ?? 0),
      pub?.seenInMempool ? 1 : 0,
      priv?.seenInMempool ? 1 : 0,
      pub?.sandwich?.landed ? 1 : 0,
    );
}

/** Close the handle — used by tests that open a database per case. */
export function closeDatabase(): void {
  db?.close();
  db = undefined;
}
