/**
 * Operator state — the authoritative off-chain ledger (v1 trusted-operator model).
 * JSON-persisted with atomic writes; engine modules provide the math,
 * this store owns the facts.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DORR_ROOT } from "./env.js";

export type Side = "LONG" | "SHORT";
export type PrivacyMode = "private" | "public";

/**
 * A trader's margin account.
 *
 * `deposited` is not the operator's number — it is read from `DorrVault` on
 * Sepolia and overwritten on every sync, so the operator cannot credit anyone
 * collateral they did not actually put in. `pnl` is the engine's own running
 * settlement, which is off-chain by design: that is what a private matching
 * engine is. Keeping the two apart means the UI can show exactly how much of a
 * balance is backed by the chain and how much is still the operator's word.
 */
export interface Account {
  address: string;
  /** Vault collateral, read from chain. Never written by the engine. */
  deposited: number;
  /** Cumulative realized PnL, fees and funding. Never decremented. */
  pnl: number;
  /** Of that, how much the vault has already paid — read from its events. */
  settledPnl: number;
  /** deposited + the unsettled remainder. Derived — see `balanceOf`. */
  balance: number;
  locked: number;
  /** vault deposit txs already credited (idempotency). */
  creditedUtxos: string[];
}

/**
 * The single definition of a tradable balance.
 *
 * `deposited` is the vault's number and already contains every settled PnL, so
 * only the part that has *not* reached the chain yet is added on top. Once a
 * batch lands the remainder is zero and the balance is purely the chain's.
 */
export function balanceOf(a: Account): number {
  return Math.max(0, a.deposited + (a.pnl - a.settledPnl));
}

export interface DorrOrder {
  id: string;
  address: string;
  marketId: string;
  side: Side;
  sizeBase: number;
  leverage: number;
  marginUsd: number;
  /** market fills immediately on execute; limit rests until the keeper triggers it. */
  orderType: "market" | "limit";
  /** limit trigger price (hidden — part of the commitment preimage). */
  limitPrice?: number;
  /** reject a fill whose realized slippage vs reference exceeds this (bps). */
  maxSlippageBps?: number;
  /** Index price captured at commit time — part of the commitment preimage. */
  commitPrice: number;
  privacyMode: PrivacyMode;
  nonce: string;
  commitmentHash: string;
  status: "committed" | "executed" | "cancelled" | "failed";
  /**
   * Why a cancelled order was cancelled.
   *
   * "cancelled" alone is the operator's answer to a question the trader did
   * not ask — they cancelled nothing, the TTL swept it. Recording the reason
   * lets the error say so.
   */
  cancelReason?: "user" | "expired";
  createdAt: string;
  executedFill?: { avgPrice: number; priceImpactBps: number; notional: number };
}

export interface DorrPosition {
  id: string;
  orderId: string;
  address: string;
  marketId: string;
  side: Side;
  sizeBase: number;
  entryPrice: number;
  marginUsd: number;
  leverage: number;
  openedAt: string;
  fundingPaid: number;
  status: "open" | "closed" | "liquidated";
  /** hidden protective triggers — never public; the keeper closes when Chainlink crosses. */
  stopLossPrice?: number;
  takeProfitPrice?: number;
  /** accumulates across partial closes. */
  realizedPnlCum?: number;
  closedAt?: string;
  exitPrice?: number;
  realizedPnl?: number;
  closeReason?: "close" | "liquidated" | "stop-loss" | "take-profit";
  settlement?: {
    settlementId?: string;
  };
}

/**
 * A timelock-SEALED order — the operator holds only ciphertext + a commitment and
 * cannot read the contents until the epoch's drand round lands. `maxMarginUsd` is
 * the publicly-locked upper bound (only a bound leaks; exact size/side/price stay
 * sealed). Settled in a uniform-price batch once decryptable.
 */
export interface SealedOrder {
  id: string;
  address: string;
  marketId: string;
  /** public — H(contents); anchorable before any key exists */
  commitment: string;
  /** tlock/AGE ciphertext — undecryptable until `targetRound` */
  ciphertext: string;
  /** drand quicknet round whose beacon unseals this order (the epoch close) */
  targetRound: number;
  epochId: string;
  /** locked upper bound on margin; the sealed order's true margin must be ≤ this */
  maxMarginUsd: number;
  status: "sealed" | "cleared" | "dropped";
  createdAt: string;
  positionId?: string;
  clearingPrice?: number;
  droppedReason?: string;
  settledAt?: string;
}

export interface Job {
  id: string;
  kind: "commit" | "execute" | "close" | "faucet" | "withdraw" | "mev-duel";
  refId: string;
  status: "running" | "complete" | "error";
  steps: Array<{ label: string; status: "running" | "complete" | "error"; detail?: string; txHash?: string; ms?: number }>;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface FeedEntry {
  at: string;
  marketId: string;
  privacyMode: PrivacyMode;
  /** private mode: only the commitment hash is public. */
  commitmentHash: string;
  /** public mode leaks everything (the A/B foil). */
  leaked?: { side: Side; sizeBase: number; leverage: number; address: string };
}

export type EventType =
  | "commit" | "limit-rest" | "execute" | "limit-fill" | "cancel"
  | "seal" | "batch-settle"
  | "close" | "partial-close" | "stop-loss" | "take-profit" | "liquidated"
  | "margin" | "stops-set" | "anchor" | "deposit" | "withdraw" | "disclose" | "settle";

export interface DorrEvent {
  at: string;
  type: EventType;
  address?: string;
  marketId?: string;
  /** human-readable line for the activity log. */
  detail: string;
  txHash?: string;
  /** which chain the tx is on (for explorer links). */
  /** A Sepolia transaction hash, when the event has one. */
}

export interface StateFile {
  accounts: Record<string, Account>;
  orders: DorrOrder[];
  positions: DorrPosition[];
  sealedOrders: SealedOrder[];
  jobs: Job[];
  feed: FeedEntry[];
  events: DorrEvent[];
  insuranceFundUsd: number;
  fundingHistory: Array<{ marketId: string; rate: number; markPrice: number; indexPrice: number; at: string }>;
}

const DATA_DIR = resolve(DORR_ROOT, "services/operator/data");
const STATE_PATH = resolve(DATA_DIR, "state.json");

const empty = (): StateFile => ({
  accounts: {},
  orders: [],
  positions: [],
  sealedOrders: [],
  jobs: [],
  feed: [],
  events: [],
  insuranceFundUsd: 0,
  fundingHistory: [],
});

let state: StateFile = empty();

export function loadState(): StateFile {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(STATE_PATH)) {
    state = { ...empty(), ...JSON.parse(readFileSync(STATE_PATH, "utf8")) };
  }
  return state;
}

export function getState(): StateFile {
  return state;
}

/** Atomic persist (write temp, rename). Call after every mutation. */
export function persist(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${STATE_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE_PATH);
}

/** Append to the activity log (keeps the last 500) and persist. */
export function logEvent(e: Omit<DorrEvent, "at"> & { at?: string }): void {
  const { at, ...rest } = e;
  state.events.push({ at: at ?? new Date().toISOString(), ...rest });
  if (state.events.length > 500) state.events = state.events.slice(-500);
  persist();
}

export function account(address: string): Account {
  if (!state.accounts[address]) {
    state.accounts[address] = { address, deposited: 0, pnl: 0, settledPnl: 0, balance: 0, locked: 0, creditedUtxos: [] };
  }
  const a = state.accounts[address];
  // Older persisted accounts predate the deposited/pnl split.
  if (a.deposited === undefined) a.deposited = 0;
  if (a.pnl === undefined) a.pnl = 0;
  if (a.settledPnl === undefined) a.settledPnl = 0;
  a.balance = balanceOf(a);
  return a;
}
