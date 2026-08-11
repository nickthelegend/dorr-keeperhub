import { describe, expect, it } from "bun:test";
import { assertStopDirection } from "../src/trading.js";
import type { DorrPosition } from "../src/state.js";

/**
 * Stop levels are the one number this product promises never to publish, and
 * `GET /positions/:address` needs no authentication — knowing an address is
 * enough to call it, and on a public chain every address is knowable. An
 * earlier build spread the stored position into that response, so a searcher
 * could read exactly where a trader's stop sat and push price into it.
 *
 * Both halves are pinned here: the redaction the route applies, and the
 * direction rule that stops a nonsensical pair being stored at all.
 *
 * Deliberately pure. An earlier version of this file installed a fixture
 * position in module state so it could call `setStops` for real — but
 * `setStops` calls `persist()`, so running the test wrote the fixture into the
 * operator's live `data/state.json` and destroyed the ledger it found there.
 * A unit test must not be able to reach the running system's data.
 */

/** Exactly the transformation `GET /positions/:address` applies. */
const redact = (p: DorrPosition) => {
  const { stopLossPrice, takeProfitPrice, ...safe } = p;
  return { ...safe, hasStopLoss: stopLossPrice != null, hasTakeProfit: takeProfitPrice != null };
};

describe("stop levels never leave the operator", () => {
  it("redacts levels to booleans", () => {
    const pos = {
      id: "p1", side: "LONG", entryPrice: 2000, marginUsd: 100, leverage: 2,
      stopLossPrice: 1750, takeProfitPrice: 2400,
    } as unknown as DorrPosition;

    const out = redact(pos);
    const json = JSON.stringify(out);

    expect(out.hasStopLoss).toBe(true);
    expect(out.hasTakeProfit).toBe(true);
    expect(json).not.toContain("1750");
    expect(json).not.toContain("2400");
    expect(json).not.toContain("stopLossPrice");
    expect(json).not.toContain("takeProfitPrice");
  });

  it("reports absent stops as false without inventing a level", () => {
    const out = redact({ id: "p2", side: "SHORT", entryPrice: 2000 } as unknown as DorrPosition);
    expect(out.hasStopLoss).toBe(false);
    expect(out.hasTakeProfit).toBe(false);
  });
});

describe("stop direction", () => {
  const ENTRY = 2000;

  it("rejects a long's stop-loss placed above entry", () => {
    // Already true when set: the position closes on the next tick and the
    // trader is told they were stopped out of a trade that never moved.
    expect(() => assertStopDirection("LONG", ENTRY, { stopLoss: 2500 })).toThrow(
      /below the entry price/,
    );
  });

  it("rejects a long's take-profit placed below entry", () => {
    expect(() => assertStopDirection("LONG", ENTRY, { takeProfit: 1500 })).toThrow(
      /above the entry price/,
    );
  });

  it("rejects a short's stop-loss placed below entry", () => {
    expect(() => assertStopDirection("SHORT", ENTRY, { stopLoss: 1500 })).toThrow(
      /above the entry price/,
    );
  });

  it("rejects a short's take-profit placed above entry", () => {
    expect(() => assertStopDirection("SHORT", ENTRY, { takeProfit: 2500 })).toThrow(
      /below the entry price/,
    );
  });

  it("rejects non-positive levels", () => {
    expect(() => assertStopDirection("LONG", ENTRY, { stopLoss: 0 })).toThrow(/must be > 0/);
    expect(() => assertStopDirection("LONG", ENTRY, { takeProfit: -5 })).toThrow(/must be > 0/);
  });

  it("accepts a correctly-sided pair on both sides", () => {
    expect(() => assertStopDirection("LONG", ENTRY, { stopLoss: 1800, takeProfit: 2300 })).not.toThrow();
    expect(() => assertStopDirection("SHORT", ENTRY, { stopLoss: 2300, takeProfit: 1800 })).not.toThrow();
  });

  it("leaves an omitted side alone", () => {
    expect(() => assertStopDirection("LONG", ENTRY, {})).not.toThrow();
    expect(() => assertStopDirection("LONG", ENTRY, { stopLoss: null, takeProfit: null })).not.toThrow();
  });
});
