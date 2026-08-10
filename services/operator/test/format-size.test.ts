/**
 * Base-size formatting.
 *
 * Regression coverage for a display bug that was worse than it looked: a $200
 * BTC position at 2x is 0.0031 BTC, and `toFixed(2)` rendered it as `0.00`. The
 * activity log then read "Opened SHORT 0.00 @ 63834" — a real, correctly-filled
 * position that looks like a broken engine to anyone reading it.
 *
 * The invariant that matters: a non-zero size never renders as zero.
 */
import { describe, expect, test } from "bun:test";
import { formatSize } from "../src/trading-math.js";

describe("formatSize", () => {
  test("a small BTC position does not render as zero", () => {
    expect(formatSize(200 / 63_834)).toBe("0.003133");
  });

  test("no non-zero size ever renders as zero", () => {
    const sizes = [1e-9, 1e-6, 0.0001, 0.0031, 0.01, 0.5, 1, 12.13, 999.9, 5000];
    for (const s of sizes) {
      expect(Number(formatSize(s))).not.toBe(0);
      expect(Number(formatSize(-s))).not.toBe(0);
    }
  });

  test("precision scales with magnitude", () => {
    expect(formatSize(12.131711)).toBe("12.13"); // LINK
    expect(formatSize(0.2669052)).toBe("0.2669"); // ETH
    expect(formatSize(0.0031331)).toBe("0.003133"); // BTC
    expect(formatSize(4200)).toBe("4200"); // DAI
  });

  test("keeps the sign", () => {
    expect(formatSize(-0.0031331)).toBe("-0.003133");
    expect(formatSize(-12.13)).toBe("-12.13");
  });

  test("exactly zero is plain zero, not scientific notation", () => {
    expect(formatSize(0)).toBe("0");
  });

  test("dust falls back to exponential rather than a row of zeros", () => {
    expect(formatSize(0.00000001)).toBe("1.00e-8");
  });
});
