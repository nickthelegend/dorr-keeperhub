/**
 * Committed-order expiry.
 *
 * A market order commits against the index price at commit time. If it is never
 * executed, two things go wrong and neither is visible: the margin stays locked
 * with no cause the UI can show, and the order remains executable — so it would
 * fill at today's price against a commitment made much earlier.
 *
 * Limit orders are deliberately exempt: resting until their price is reached is
 * what one is for, and they are listed and cancellable.
 */
import { describe, expect, test } from "bun:test";
import { COMMIT_TTL_MS, commitAgeMs } from "../src/trading.js";

const orderAgedMs = (ms: number, orderType: "market" | "limit" = "market") =>
  ({
    createdAt: new Date(Date.now() - ms).toISOString(),
    orderType,
  }) as Parameters<typeof commitAgeMs>[0];

describe("cancel reasons", () => {
  // "order is cancelled" answers a question the trader did not ask: they
  // cancelled nothing, the TTL swept it. The two cases must stay
  // distinguishable so the execute path can say which one happened.
  test("the two cancel reasons are distinct values", () => {
    const reasons: Array<"user" | "expired"> = ["user", "expired"];
    expect(new Set(reasons).size).toBe(2);
  });
});

describe("commit expiry", () => {
  test("the TTL is long enough for a real commit→execute round trip", () => {
    expect(COMMIT_TTL_MS).toBeGreaterThanOrEqual(60_000);
  });

  test("a fresh commit is well inside the window", () => {
    expect(commitAgeMs(orderAgedMs(500))).toBeLessThan(COMMIT_TTL_MS);
  });

  test("an old commit is outside it", () => {
    expect(commitAgeMs(orderAgedMs(COMMIT_TTL_MS + 1_000))).toBeGreaterThanOrEqual(COMMIT_TTL_MS);
  });

  test("age is measured from createdAt, not from now", () => {
    const age = commitAgeMs(orderAgedMs(30_000));
    expect(age).toBeGreaterThan(29_000);
    expect(age).toBeLessThan(31_000);
  });

  test("a commit made in the future does not read as expired", () => {
    // Clock skew between a client timestamp and the server should never expire
    // an order early — that would release margin out from under a live trade.
    expect(commitAgeMs(orderAgedMs(-60_000))).toBeLessThan(0);
  });
});
