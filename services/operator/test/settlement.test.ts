/**
 * The settlement batch — the arithmetic that stops the vault paying twice.
 *
 * These are regression tests for a bug that actually happened on Sepolia: the
 * vault paid −1.0002 mUSD against −0.5001 owed, because settlement decremented
 * a local counter and a batch landed that the operator did not observe. The fix
 * was to stop remembering and start subtracting — what is owed is cumulative
 * PnL minus what the chain's own events say was paid.
 *
 * The other half is the zero-sum invariant. `DorrVault.applyPnl` reverts unless
 * the deltas sum to exactly zero, and floats do not sum to exactly anything, so
 * the fund's side is derived from the rounded integers rather than rounded
 * alongside them.
 */
import { describe, expect, test } from "bun:test";
import { buildBatch, toZeroSumUnits, DUST } from "../src/settlement.js";

const A = "0x38bE262f1945F96283d6f084FF488372D7F08214";
const B = "0x937749eFFbB83FDC704417Aab2D5C5C4ba0CCdf7";

describe("buildBatch", () => {
  test("owes the difference between earned and already-paid", () => {
    const batch = buildBatch([{ address: A, cumulativePnl: -3.2, settledPnl: -0.5 }])!;
    expect(batch.traders).toEqual([A]);
    expect(batch.deltas[0]).toBeCloseTo(-2.7, 9);
    expect(batch.fundDelta).toBeCloseTo(2.7, 9);
  });

  test("a fully settled trader drops out — settling twice is a no-op", () => {
    expect(buildBatch([{ address: A, cumulativePnl: -3.2, settledPnl: -3.2 }])).toBeNull();
  });

  test("an overpayment is proposed back, not ignored", () => {
    // The real incident: the chain paid -1.0002 against -0.5001 owed.
    const batch = buildBatch([{ address: A, cumulativePnl: -0.5001, settledPnl: -1.0002 }])!;
    expect(batch.deltas[0]).toBeCloseTo(0.5001, 9);
    expect(batch.fundDelta).toBeCloseTo(-0.5001, 9);
  });

  test("the fund's delta always cancels the traders'", () => {
    const batch = buildBatch([
      { address: A, cumulativePnl: 120.5, settledPnl: 0 },
      { address: B, cumulativePnl: -37.25, settledPnl: -10 },
    ])!;
    expect(batch.deltas.reduce((s, d) => s + d, 0) + batch.fundDelta).toBeCloseTo(0, 9);
    expect(batch.totalAbs).toBeCloseTo(120.5 + 27.25, 9);
  });

  test("dust is not worth a transaction", () => {
    expect(buildBatch([{ address: A, cumulativePnl: DUST / 2, settledPnl: 0 }])).toBeNull();
    expect(buildBatch([{ address: A, cumulativePnl: DUST, settledPnl: 0 }])).not.toBeNull();
  });

  test("dust for one trader does not suppress a real delta for another", () => {
    const batch = buildBatch([
      { address: A, cumulativePnl: 0.001, settledPnl: 0 },
      { address: B, cumulativePnl: 42, settledPnl: 0 },
    ])!;
    expect(batch.traders).toEqual([B]);
    expect(batch.fundDelta).toBeCloseTo(-42, 9);
  });

  test("no entries at all means no batch", () => {
    expect(buildBatch([])).toBeNull();
  });
});

describe("toZeroSumUnits", () => {
  test("sums to exactly zero across the fund", () => {
    const { traderUnits, fundUnits } = toZeroSumUnits([-2.6996, 13.5, -0.7771], 18);
    expect(traderUnits.reduce((s, d) => s + d, 0n) + fundUnits).toBe(0n);
  });

  test("sums to exactly zero on values floats cannot represent", () => {
    // 0.1 + 0.2 !== 0.3 — the residue has to land on the fund, not on the sum.
    const { traderUnits, fundUnits } = toZeroSumUnits([0.1, 0.2, -0.3], 18);
    expect(traderUnits.reduce((s, d) => s + d, 0n) + fundUnits).toBe(0n);
  });

  test("preserves sign and magnitude", () => {
    const { traderUnits, fundUnits } = toZeroSumUnits([-1.5], 18);
    expect(traderUnits[0]).toBe(-1_500_000_000_000_000_000n);
    expect(fundUnits).toBe(1_500_000_000_000_000_000n);
  });

  test("holds at 6 decimals too", () => {
    const { traderUnits, fundUnits } = toZeroSumUnits([-2.6996, 1.3333, 0.0001], 6);
    expect(traderUnits.reduce((s, d) => s + d, 0n) + fundUnits).toBe(0n);
    expect(traderUnits[0]).toBe(-2_699_600n);
  });

  test("a balanced batch leaves the fund with nothing to absorb", () => {
    const { fundUnits } = toZeroSumUnits([5, -5], 18);
    expect(fundUnits).toBe(0n);
  });
});
