import { describe, expect, it } from "bun:test";
import { MAX_AGE_SEC, SLOWEST_FEED_HEARTBEAT_SEC, isStale } from "../src/oracle.js";

const HOUR = 3600;

/**
 * A staleness bound set to exactly a feed's heartbeat is a scheduled outage.
 *
 * Chainlink updates a feed on a deviation threshold *or* a heartbeat, whichever
 * comes first. DAI/USD on Sepolia has a 24h heartbeat and, being a stablecoin,
 * essentially never trips the deviation arm — so it legitimately sits unchanged
 * for very nearly the whole day. With the bound also at 24h, the age crossed it
 * in the minutes before every update and disabled a perfectly healthy market;
 * observed live as "DAI/USD stale by 24h — market disabled" while the feed's own
 * updatedAt was 48 seconds old.
 *
 * These are cheap to run and the bug is otherwise only reproducible once a day.
 */
describe("oracle staleness", () => {
  it("clears the slowest configured heartbeat with real margin", () => {
    expect(MAX_AGE_SEC).toBeGreaterThan(SLOWEST_FEED_HEARTBEAT_SEC);
    // At least a 25% cushion, so a late heartbeat is not an outage either.
    expect(MAX_AGE_SEC).toBeGreaterThanOrEqual(SLOWEST_FEED_HEARTBEAT_SEC * 1.25);
  });

  it("does not disable a feed sitting just under its heartbeat", () => {
    const now = 1_800_000_000;
    // The exact condition that used to fail: DAI moments before its update.
    expect(isStale(now - (SLOWEST_FEED_HEARTBEAT_SEC - 60), now)).toBe(false);
    expect(isStale(now - SLOWEST_FEED_HEARTBEAT_SEC, now)).toBe(false);
    // And a heartbeat that runs a few hours late is still not an outage.
    expect(isStale(now - (SLOWEST_FEED_HEARTBEAT_SEC + 6 * HOUR), now)).toBe(false);
  });

  it("still disables a feed that has genuinely stopped", () => {
    const now = 1_800_000_000;
    expect(isStale(now - (MAX_AGE_SEC + 1), now)).toBe(true);
    expect(isStale(now - 48 * HOUR, now)).toBe(true);
    expect(isStale(0, now)).toBe(true);
  });

  it("treats a fresh reading as fresh", () => {
    const now = 1_800_000_000;
    expect(isStale(now, now)).toBe(false);
    expect(isStale(now - 48, now)).toBe(false);
  });
});
