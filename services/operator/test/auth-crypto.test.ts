import { test, expect, beforeEach } from "bun:test";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { authMessage, verifyAuth, eip191Verifier, _resetAuthSeen } from "../src/auth.js";

/**
 * The real EIP-191 verifier, against real wallet signatures.
 *
 * No injected test double: these sign with an actual secp256k1 key through
 * viem's `signMessage` — byte-identical to what MetaMask's `personal_sign`
 * produces — and run them through the production verifier. That matters because
 * the previous implementation verified Cardano CIP-30 signatures while the
 * frontend had already moved to `personal_sign`, and nothing caught it: the
 * envelope was rejected for a missing `key` field before the signature was ever
 * checked, so enabling DORR_AUTH silently broke every authenticated route.
 */

const account = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());

const sign = async (action: string, params: Record<string, unknown>, ts: number, who = account) => ({
  signer: who.address,
  ts,
  sig: { signature: await who.signMessage({ message: authMessage(action, params, ts) }) },
});

beforeEach(() => _resetAuthSeen());

test("a real personal_sign signature verifies", async () => {
  const ts = Date.now();
  const params = { address: account.address, amount: 25 };
  const env = await sign("withdraw", params, ts);
  expect(verifyAuth("withdraw", params, env, account.address, ts)).toEqual({ ok: true });
});

test("the verifier recovers the signing address", async () => {
  const msg = authMessage("commit", { a: 1 }, 1);
  const signature = await account.signMessage({ message: msg });
  expect(eip191Verifier(msg, { signature }, account.address)).toBe(true);
  expect(eip191Verifier(msg, { signature }, other.address)).toBe(false);
});

test("checksummed and lowercase addresses are the same account", async () => {
  const ts = Date.now();
  const params = { address: account.address };
  const env = await sign("close", params, ts);
  env.signer = account.address.toLowerCase();
  expect(verifyAuth("close", params, env, account.address, ts).ok).toBe(true);
});

test("a signature over different params does not authorise the action", async () => {
  const ts = Date.now();
  const env = await sign("withdraw", { address: account.address, amount: 1 }, ts);
  const res = verifyAuth("withdraw", { address: account.address, amount: 1000 }, env, account.address, ts);
  expect(res).toEqual({ ok: false, error: "invalid signature for this message/address" });
});

test("a signature for one action does not authorise another", async () => {
  const ts = Date.now();
  const params = { address: account.address, amount: 5 };
  const env = await sign("withdraw", params, ts);
  expect(verifyAuth("close", params, env, account.address, ts).ok).toBe(false);
});

test("you cannot act as someone else", async () => {
  const ts = Date.now();
  const params = { address: other.address };
  const env = await sign("close", params, ts); // signed by `account`
  expect(verifyAuth("close", params, env, other.address, ts)).toEqual({
    ok: false,
    error: "signer does not match the acting address",
  });
});

test("a replayed signature is rejected the second time", async () => {
  const ts = Date.now();
  const params = { address: account.address, amount: 3 };
  const env = await sign("withdraw", params, ts);
  expect(verifyAuth("withdraw", params, env, account.address, ts).ok).toBe(true);
  expect(verifyAuth("withdraw", params, env, account.address, ts)).toEqual({
    ok: false,
    error: "signature already used (replay)",
  });
});

test("a stale signature is rejected", async () => {
  const ts = Date.now();
  const params = { address: account.address };
  const env = await sign("close", params, ts);
  const res = verifyAuth("close", params, env, account.address, ts + 130_000);
  expect(res).toEqual({ ok: false, error: "stale or future-dated signature (replay window exceeded)" });
});

test("malformed envelopes are rejected rather than thrown on", async () => {
  const ts = Date.now();
  expect(verifyAuth("close", {}, undefined, undefined, ts).ok).toBe(false);
  expect(verifyAuth("close", {}, { signer: "", ts, sig: { signature: "" } }, undefined, ts).ok).toBe(false);
  // Right shape, wrong length — must not throw out of the verifier.
  expect(
    verifyAuth("close", {}, { signer: account.address, ts, sig: { signature: "0xdead" } }, undefined, ts).ok,
  ).toBe(false);
});

test("a garbage signature of the correct length is rejected", async () => {
  const ts = Date.now();
  const env = { signer: account.address, ts, sig: { signature: `0x${"11".repeat(65)}` } };
  expect(verifyAuth("close", {}, env, account.address, ts).ok).toBe(false);
});
