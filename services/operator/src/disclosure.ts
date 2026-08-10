/**
 * Selective disclosure — "private by default, provably disclosable."
 *
 * Your order is a public commitment `H = SHA-256(fields ‖ nonce)`; the fields
 * stay hidden. When you *choose* to prove your position to an auditor or
 * counterparty, you hand them a disclosure: the revealed fields + the nonce.
 * They recompute the hash and check it equals the commitment the operator
 * published at commit time — proving exactly what you traded, WITHOUT the
 * public ever seeing it. The commitment is published, not anchored on chain:
 * that makes this evidence against the operator changing its story after the
 * fact, not proof of when it was made.
 */
import { orderCommitmentHex, type OrderCommitmentInput } from "@dorr/engine/order/commitment";
import { getState } from "./state.js";

export interface Disclosure {
  kind: "dorr-selective-disclosure/v1";
  subject: "order";
  orderId: string;
  audience: string;
  /** the committed value the operator published when the order was sealed. */
  commitment: string;
  /** the opened preimage — share ONLY with the intended auditor. */
  revealed: OrderCommitmentInput;
  issuedAt: string;
  statement: string;
}

export function buildDisclosure(orderId: string, audience: string): Disclosure {
  const order = getState().orders.find((o) => o.id === orderId);
  if (!order) throw new Error("order not found");
  const revealed: OrderCommitmentInput = {
    pairId: order.marketId,
    side: order.side,
    price: order.commitPrice.toFixed(8),
    size: order.sizeBase.toFixed(8),
    leverage: order.leverage,
    margin: order.marginUsd.toFixed(2),
    nonce: order.nonce,
  };
  // sanity: the opened preimage must reproduce the committed hash
  if (orderCommitmentHex(revealed) !== order.commitmentHash) {
    throw new Error("internal: order preimage does not match its commitment");
  }
  return {
    kind: "dorr-selective-disclosure/v1",
    subject: "order",
    orderId,
    audience: audience || "auditor",
    commitment: order.commitmentHash,
    revealed,
    issuedAt: new Date().toISOString(),
    statement:
      "SHA-256(canonical(revealed)) == commitment, the value published when the order was sealed. " +
      "The public only ever saw `commitment`; this disclosure reveals the position solely to its holder.",
  };
}

export interface DisclosureVerdict {
  valid: boolean;
  recomputed: string;
  commitment: string;
  matches: boolean;
  reason: string;
}

/** Anyone handed a disclosure can verify it against the committed hash. */
/** Fields a disclosure must open for the commitment to be recomputable. */
const REVEALED_FIELDS = ["pairId", "side", "price", "size", "leverage", "margin", "nonce"] as const;

export function verifyDisclosure(d: Disclosure): DisclosureVerdict {
  // Validate the shape first so a caller gets a sentence they can act on rather
  // than a JS TypeError leaked out of the hashing code.
  const reject = (reason: string): DisclosureVerdict => ({
    valid: false,
    recomputed: "",
    commitment: typeof d?.commitment === "string" ? d.commitment : "",
    matches: false,
    reason,
  });

  if (!d || typeof d !== "object") return reject("no disclosure supplied — send the object returned by /disclose");
  if (typeof d.commitment !== "string" || !/^[0-9a-f]{64}$/i.test(d.commitment.replace(/^0x/, ""))) {
    return reject("missing or malformed 'commitment' — expected a 32-byte hex hash");
  }
  if (!d.revealed || typeof d.revealed !== "object") {
    return reject("missing 'revealed' — the opened order fields are required to verify a disclosure");
  }
  const missing = REVEALED_FIELDS.filter(
    (k) => (d.revealed as Record<string, unknown>)[k] === undefined || (d.revealed as Record<string, unknown>)[k] === null,
  );
  if (missing.length) {
    return reject(`disclosure is incomplete — missing ${missing.join(", ")}`);
  }

  let recomputed = "";
  try {
    recomputed = orderCommitmentHex(d.revealed);
  } catch {
    return reject("could not recompute the commitment from the revealed fields — they are not in the expected format");
  }
  const matches = recomputed === d.commitment;
  return {
    valid: matches,
    recomputed,
    commitment: d.commitment,
    matches,
    reason: matches
      ? "verified — the revealed position hashes exactly to the on-chain commitment"
      : "REJECTED — the revealed fields do not match the committed hash (forged or tampered)",
  };
}
