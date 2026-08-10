/**
 * Wallet-signature auth (EIP-191 `personal_sign`).
 *
 * Every value-moving action (commit / execute / close) must carry a signature
 * produced by the acting wallet over a canonical, timestamped message. The
 * operator verifies (a) the signature really recovers to the claimed address,
 * (b) the message is fresh (anti-replay window), and (c) the signature hasn't
 * been seen before (replay dedupe). This binds each request to the real key
 * owner — you cannot place or close someone else's trade.
 *
 * This used to verify CIP-30 Cardano data signatures, left over from before the
 * move to Flare. The frontend had already migrated to `personal_sign`, and the
 * envelope it sends carries no `key` field — which the old verifier rejected as
 * malformed before it ever reached the signature check. The net effect was that
 * enabling DORR_AUTH broke every authenticated route. Verifying what the client
 * actually signs fixes that.
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { hashMessage, keccak256, type Hex } from "viem";

export interface DataSignature {
  /** 65-byte `personal_sign` output, 0x-prefixed. */
  signature: string;
  /** Unused for EVM (the address is recoverable). Kept so the envelope shape
   *  stays stable across wallet backends. */
  key?: string;
}

/** Crypto verifier: does `sig` recover to `address` over `message`? */
export type SigVerifier = (message: string, sig: DataSignature, address: string) => boolean;

/** Address implied by an uncompressed secp256k1 public key. */
function addressFromPublicKey(pub: Uint8Array): string {
  // Drop the 0x04 prefix; the address is the last 20 bytes of keccak(pubkey).
  const hash = keccak256(`0x${Buffer.from(pub.slice(1)).toString("hex")}` as Hex);
  return `0x${hash.slice(-40)}`.toLowerCase();
}

/**
 * Production verifier — EIP-191 recovery.
 *
 * Deliberately synchronous. viem's `recoverMessageAddress` is async, and making
 * this async would ripple through every route's auth check for no benefit;
 * noble's secp256k1 recovery is sync and is already a dependency.
 */
export const eip191Verifier: SigVerifier = (message, sig, address) => {
  const hex = sig.signature.startsWith("0x") ? sig.signature.slice(2) : sig.signature;
  if (hex.length !== 130) return false; // r(32) + s(32) + v(1)

  const raw = Buffer.from(hex, "hex");
  let v = raw[64];
  if (v >= 27) v -= 27;
  if (v !== 0 && v !== 1) return false;

  const digest = hashMessage(message).slice(2);
  const signature = secp256k1.Signature.fromCompact(raw.subarray(0, 64)).addRecoveryBit(v);
  const pub = signature.recoverPublicKey(digest).toRawBytes(false);

  return addressFromPublicKey(pub) === address.toLowerCase();
};

export interface AuthEnvelope {
  /** 0x address that signed. */
  signer: string;
  /** Client timestamp (ms). */
  ts: number;
  sig: DataSignature;
}

const FRESH_MS = 120_000;
const seen = new Map<string, number>(); // signature → firstSeen (replay dedupe)

/** Canonical message a client must sign for a given action + params. */
export function authMessage(action: string, params: Record<string, unknown>, ts: number): string {
  // Deterministic key order so client and server agree byte-for-byte.
  const canonical = JSON.stringify(params, Object.keys(params).sort());
  return `dorr:${action}\n${canonical}\nts:${ts}`;
}

function pruneSeen(now: number): void {
  for (const [k, t] of seen) if (now - t > FRESH_MS * 2) seen.delete(k);
}

export type AuthResult = { ok: true } | { ok: false; error: string };

/**
 * Verify an auth envelope for an action. `expectedSigner`, when provided, must
 * equal the envelope signer (binds the action to a specific address/owner).
 */
export function verifyAuth(
  action: string,
  params: Record<string, unknown>,
  envelope: AuthEnvelope | undefined,
  expectedSigner: string | undefined,
  now: number = Date.now(),
  verify: SigVerifier = eip191Verifier,
): AuthResult {
  if (!envelope) return { ok: false, error: "missing auth (sign the request with your wallet)" };
  const { signer, ts, sig } = envelope;
  if (!signer || !sig?.signature) return { ok: false, error: "malformed auth envelope" };
  if (!Number.isFinite(ts) || Math.abs(now - ts) > FRESH_MS) {
    return { ok: false, error: "stale or future-dated signature (replay window exceeded)" };
  }
  // Addresses are compared case-insensitively: EIP-55 checksumming means the
  // same account can legitimately arrive in different cases.
  if (expectedSigner && expectedSigner.toLowerCase() !== signer.toLowerCase()) {
    return { ok: false, error: "signer does not match the acting address" };
  }
  if (seen.has(sig.signature)) return { ok: false, error: "signature already used (replay)" };

  const message = authMessage(action, params, ts);
  let valid = false;
  try {
    valid = verify(message, sig, signer);
  } catch (e) {
    return { ok: false, error: `signature check failed: ${String(e).slice(0, 120)}` };
  }
  if (!valid) return { ok: false, error: "invalid signature for this message/address" };

  pruneSeen(now);
  seen.set(sig.signature, now);
  return { ok: true };
}

/** Test/reset helper — clears the replay-dedupe set. */
export function _resetAuthSeen(): void {
  seen.clear();
}
