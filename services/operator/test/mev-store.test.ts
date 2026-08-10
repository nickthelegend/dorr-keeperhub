import { test, expect } from "bun:test";
import { computeLeaderboard, savingFor } from "../src/mev/store.js";
import type { Duel, LaneResult } from "../src/mev/store.js";

/**
 * The savings rule, pinned.
 *
 * "$X saved" is the number this project asks people to believe, so the ways it
 * can be inflated matter more than the ways it can be computed. The rule is
 * deliberately conservative: a saving is claimed only when BOTH lanes actually
 * executed. An errored private lane has no shortfall to compare against, and
 * treating its absence as "$0 lost" silently credits the private lane with the
 * public lane's entire loss — exactly the bug that shipped in the first live
 * run and inflated the board by $189.81.
 *
 * These exercise the pure forms deliberately: a store test that wrote through
 * `recordDuel` would inject fabricated duels into the real, published
 * leaderboard, which is the last file that should ever contain test data.
 */

const lane = (over: Partial<LaneResult> = {}): LaneResult => ({
  lane: "public",
  quotedOut: "0",
  actualOut: "0",
  shortfall: "0",
  shortfallUsd: 0,
  seenInMempool: false,
  ...over,
});

let n = 0;
const duel = (pub?: Partial<LaneResult>, priv?: Partial<LaneResult>): Duel => ({
  id: `test-${++n}`,
  at: "2026-08-10T00:00:00.000Z",
  amountIn: "10000000000000000000",
  baseForQuote: true,
  slippageBps: 100,
  pool: "0xpool",
  chainId: 11155111,
  public: pub ? lane({ lane: "public", ...pub }) : undefined,
  private: priv ? lane({ lane: "private", ...priv }) : undefined,
  savedUsd: 999_999, // deliberately wrong — must never be trusted
  notes: [],
});

test("a clean duel saves the difference between the two lanes", () => {
  expect(savingFor(duel({ shortfallUsd: 200, seenInMempool: true }, { shortfallUsd: 0 }))).toBe(200);
});

test("an errored private lane claims no saving, however large the public loss", () => {
  const d = duel({ shortfallUsd: 500, seenInMempool: true }, { error: "workflow returned no transaction" });
  expect(savingFor(d)).toBe(0);
});

test("an errored public lane claims no saving either", () => {
  expect(savingFor(duel({ error: "relayer rejected the call" }, { shortfallUsd: 0 }))).toBe(0);
});

test("a missing lane claims no saving", () => {
  expect(savingFor(duel({ shortfallUsd: 300 }, undefined))).toBe(0);
  expect(savingFor(duel(undefined, { shortfallUsd: 0 }))).toBe(0);
});

test("a private lane that fared worse never reports a negative saving", () => {
  // Possible when the pool moves for unrelated reasons. Report zero rather than
  // a negative that would net against genuine savings elsewhere on the board.
  expect(savingFor(duel({ shortfallUsd: 10 }, { shortfallUsd: 40 }))).toBe(0);
});

test("the leaderboard derives savings from the rule, not the stored field", () => {
  // Every duel here carries savedUsd = 999_999. If the aggregate trusted it,
  // the board would read ~3,000,000.
  const board = computeLeaderboard([
    duel({ shortfallUsd: 5 }, { shortfallUsd: 1 }),
    duel({ shortfallUsd: 500 }, { error: "no transaction" }),
    duel({ shortfallUsd: 300 }, undefined),
  ]);
  expect(board.totalSavedUsd).toBe(4);
});

test("total lost counts every public lane, including ones with no private counterpart", () => {
  const board = computeLeaderboard([
    duel({ shortfallUsd: 100 }, { shortfallUsd: 0 }),
    duel({ shortfallUsd: 50 }, { error: "boom" }),
  ]);
  expect(board.totalLostUsd).toBe(150);
  expect(board.totalSavedUsd).toBe(100);
  expect(board.worstSingleLossUsd).toBe(100);
});

test("mempool exposure is counted per lane", () => {
  const board = computeLeaderboard([
    duel({ shortfallUsd: 1, seenInMempool: true }, { shortfallUsd: 0, seenInMempool: false }),
    duel({ shortfallUsd: 1, seenInMempool: true }, { shortfallUsd: 0, seenInMempool: false }),
  ]);
  expect(board.publicSeenInMempool).toBe(2);
  expect(board.privateSeenInMempool).toBe(0);
});

test("only landed sandwiches count as landed", () => {
  const board = computeLeaderboard([
    duel({ shortfallUsd: 1, sandwich: { landed: false } }, { shortfallUsd: 0 }),
    duel({ shortfallUsd: 1, sandwich: { landed: true } }, { shortfallUsd: 0 }),
    duel({ shortfallUsd: 1 }, { shortfallUsd: 0 }),
  ]);
  expect(board.sandwichesLanded).toBe(1);
});

test("an empty board reports zeros rather than NaN", () => {
  const board = computeLeaderboard([]);
  expect(board.avgLossPerPublicTradeUsd).toBe(0);
  expect(board.totalSavedUsd).toBe(0);
  expect(board.entries).toHaveLength(0);
});
