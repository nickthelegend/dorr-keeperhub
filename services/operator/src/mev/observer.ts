/**
 * The shared, always-on mempool observer.
 *
 * One Searcher instance for the whole process, kept connected whether or not a
 * duel is running, so two things are true at once:
 *
 *   - The UI can show Sepolia's live pending-transaction feed at any moment.
 *     A judge does not have to take "we watch the mempool" on faith; the
 *     transactions scroll past in front of them, and when the public lane fires
 *     they watch its hash appear in that stream *before* it is mined. When the
 *     private lane fires, they watch the same stream stay silent.
 *   - A duel measures against a feed that was already running, rather than one
 *     started moments earlier. A fresh subscription has a warm-up gap, and a
 *     gap in coverage is indistinguishable from "the transaction was private" —
 *     which is precisely the answer this project must never get wrong by
 *     accident.
 */
import type { Address } from "viem";
import { env } from "../env.js";
import { Searcher, type Sighting } from "./searcher.js";

export interface FeedEvent {
  type: "sighting" | "pool-swap" | "status";
  at: number;
  hash?: string;
  from?: string;
  /** Total pending transactions this observer has seen since it connected. */
  seen: number;
  connected: boolean;
  /** Only set on `status` frames. */
  note?: string;
}

let searcher: Searcher | undefined;
const subscribers = new Set<(e: FeedEvent) => void>();
let seenCount = 0;
/** ms epoch when this observer first connected — the window we can vouch for. */
let connectedSince: number | undefined;

/** The process-wide observer, started on first use. */
export function observer(): Searcher {
  if (searcher) return searcher;
  searcher = new Searcher(env.mev.pool as Address);

  searcher.onSighting((s: Sighting) => {
    if (connectedSince === undefined) connectedSince = Date.now();
    seenCount++;
    broadcast({
      type: s.isPoolSwap ? "pool-swap" : "sighting",
      at: s.firstSeenAt,
      hash: s.hash,
      from: s.from,
      seen: seenCount,
      connected: true,
    });
  });

  searcher.start();
  return searcher;
}

function broadcast(e: FeedEvent): void {
  for (const fn of subscribers) {
    try {
      fn(e);
    } catch {
      // A dead SSE connection must not stall the observer.
    }
  }
}

/** Subscribe to the feed. Returns an unsubscribe function. */
export function subscribe(fn: (e: FeedEvent) => void): () => void {
  observer(); // ensure it's running
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/**
 * When this observer started seeing traffic, or undefined if it never has.
 *
 * Callers use it to avoid claiming a transaction was private when we simply
 * weren't watching at the time — an absence of evidence from a disconnected
 * observer is not evidence of privacy.
 */
export function observerConnectedSince(): number | undefined {
  return connectedSince;
}

export function observerStatus(): { connected: boolean; seen: number; subscribers: number } {
  return {
    connected: searcher?.isConnected ?? false,
    seen: seenCount,
    subscribers: subscribers.size,
  };
}

/**
 * Announce something the feed should show alongside the raw sightings — the
 * lane markers that make the stream legible ("public lane submitted", "private
 * lane submitted"). Kept separate from sightings so the two can never be
 * confused: one is observed, the other is asserted by us.
 */
export function announce(note: string): void {
  broadcast({
    type: "status",
    at: Date.now(),
    seen: seenCount,
    connected: searcher?.isConnected ?? false,
    note,
  });
}
