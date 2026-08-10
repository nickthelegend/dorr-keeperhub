import { test, expect } from "bun:test";
import { parseUnits, type Address } from "viem";
import { decodeSwapFromCalldata } from "../src/mev/searcher.js";

/**
 * The searcher's calldata parser, pinned against real Sepolia transactions.
 *
 * These two fixtures are verbatim `input` fields from the first live duel —
 * both are KeeperHub-relayed swaps against the lab pool. They are here because
 * the first version of the searcher matched on `tx.to == pool` and therefore
 * saw neither of them, which made a fully-exposed transaction look private.
 * That is the single most dangerous way this project can be wrong: a blind
 * searcher reports "no MEV" and the product claims credit for it.
 *
 * If detection ever regresses, these fail rather than the demo quietly
 * producing a flattering number.
 */

const POOL = "0xb261e0df84a14ec7bb698f986b65b8a27d1b50e1" as Address;
const OTHER_POOL = "0x1111111111111111111111111111111111111111" as Address;
const TRADER = "0x330c29a1a026325bb39516f1774e0e6a26efd7df";

/** Public-lane swap, sepolia 0xaea80679…, sell 10 mETH, minOut 19545.72 mUSD. */
const PUBLIC_LANE_CALLDATA =
  "0x9aefaff8000000000000000000000000330c29a1a026325bb39516f1774e0e6a26efd7df000000000000000000000000b261e0df84a14ec7bb698f986b65b8a27d1b50e100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080" +
  "00000000000000000000000000000000000000000000000000000000000000d9af3f69a9977066d406c72cf9798f2cd024085a2904aace3ab0e42958b5213bbf68bcce745f0bf34827b236efab70ef328664fea2652dec2f2a985de6adff204e1c000000000000000000000000000000036a79de85f936644600000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000008ac7230489e80000000000000000000000000000000000000000000000000423937b1183c7a308f6000000000000000000000000330c29a1a026325bb39516f1774e0e6a26efd7df00000000000000";

/** Private-lane swap, sepolia 0xcb79587f…, same size, different minOut. */
const PRIVATE_LANE_CALLDATA =
  "0x9aefaff8000000000000000000000000330c29a1a026325bb39516f1774e0e6a26efd7df000000000000000000000000b261e0df84a14ec7bb698f986b65b8a27d1b50e100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080" +
  "00000000000000000000000000000000000000000000000000000000000000d901257f947569306668da78141ff4e5f713f14f8dbd857901d1d497c92c3f94db57fc43c865875af2e69affe97af407bf014aade2170cbf07218e6e5f76d03e1e1c000000000000000000000000000000046a79df5ef936644600000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000008ac7230489e8000000000000000000000000000000000000000000000000040ed4a562878f4b57c8000000000000000000000000330c29a1a026325bb39516f1774e0e6a26efd7df00000000000000";

test("decodes a relayed swap that never names the pool as `to`", () => {
  const swap = decodeSwapFromCalldata(PUBLIC_LANE_CALLDATA, POOL);
  expect(swap).toBeDefined();
  expect(swap!.baseForQuote).toBe(true);
  expect(swap!.amountIn).toBe(parseUnits("10", 18));
  expect(swap!.recipient.toLowerCase()).toBe(TRADER);
});

test("recovers the victim's slippage limit — the attacker's budget", () => {
  const swap = decodeSwapFromCalldata(PUBLIC_LANE_CALLDATA, POOL)!;
  // 1% under a 19743.16 mUSD quote.
  const minOut = Number(swap.minAmountOut) / 1e18;
  expect(minOut).toBeGreaterThan(19_500);
  expect(minOut).toBeLessThan(19_600);
  expect(swap.minAmountOut).toBeLessThan(parseUnits("19743.1608", 18));
});

test("decodes both lanes identically — routing must not change the payload", () => {
  const pub = decodeSwapFromCalldata(PUBLIC_LANE_CALLDATA, POOL)!;
  const priv = decodeSwapFromCalldata(PRIVATE_LANE_CALLDATA, POOL)!;
  expect(priv.baseForQuote).toBe(pub.baseForQuote);
  expect(priv.amountIn).toBe(pub.amountIn);
  expect(priv.recipient).toBe(pub.recipient);
});

test("ignores swaps against a different pool", () => {
  expect(decodeSwapFromCalldata(PUBLIC_LANE_CALLDATA, OTHER_POOL)).toBeUndefined();
});

test("ignores calldata with no swap in it", () => {
  const transfer =
    "0xa9059cbb000000000000000000000000b261e0df84a14ec7bb698f986b65b8a27d1b50e10000000000000000000000000000000000000000000000008ac7230489e80000";
  expect(decodeSwapFromCalldata(transfer, POOL)).toBeUndefined();
});

test("ignores a truncated payload rather than decoding garbage", () => {
  // Pool named, selector present, but the arguments are cut short. Guessing
  // here would size an attack off nonsense.
  const truncated = PUBLIC_LANE_CALLDATA.slice(0, PUBLIC_LANE_CALLDATA.indexOf("f9366446") + 8 + 64);
  expect(decodeSwapFromCalldata(truncated, POOL)).toBeUndefined();
});

test("decodes a plain, unwrapped swap sent straight to the pool", () => {
  // The searcher must keep working if a trader bypasses the relayer entirely.
  const direct =
    "0xf9366446" +
    "0000000000000000000000000000000000000000000000000000000000000001" +
    "0000000000000000000000000000000000000000000000008ac7230489e80000" +
    "00000000000000000000000000000000000000000000000423937b1183c7a308" +
    `000000000000000000000000${POOL.slice(2)}`;
  const swap = decodeSwapFromCalldata(direct, POOL);
  expect(swap).toBeDefined();
  expect(swap!.amountIn).toBe(parseUnits("10", 18));
});
