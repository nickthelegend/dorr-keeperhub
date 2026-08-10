/**
 * MEV Shield operator client.
 *
 * Every helper throws OperatorError on a non-2xx; callers (TanStack Query) fail
 * soft so the page renders an honest empty state rather than a blank screen when
 * the operator is down.
 */

const OPERATOR = process.env.NEXT_PUBLIC_OPERATOR_URL || "http://localhost:8790";

export const OPERATOR_URL = OPERATOR;

// ─── job tracking (a duel spans several blocks) ──────────────────────────────

export interface JobStep {
  label: string;
  status: "running" | "complete" | "error";
  detail?: string;
  txHash?: string;
  ms?: number;
}

export interface Job {
  id: string;
  kind: "mev-duel";
  refId: string;
  status: "running" | "complete" | "error";
  steps: JobStep[];
  error?: string;
  createdAt: string;
  completedAt?: string;
}

// ─── MEV Shield ──────────────────────────────────────────────────────────────
// `seenInMempool` is an independent observer's record, not a claim echoed back
// by an API — it is what makes the dollar figures an attribution.

export interface MevStatus {
  configured: boolean;
  reason?: string;
  chainId: number;
  network: string;
  explorer: string;
  pool: string;
  baseToken: string;
  quoteToken: string;
  reserveBase: string;
  reserveQuote: string;
  midPriceUsd: number;
  searcher: string | null;
  searcherArmed: boolean;
  searcherGasEth?: number;
  /** False once the adversary can no longer pay for its own attacks. */
  searcherFunded?: boolean;
  trader: string | null;
  privateLaneReady: boolean;
  /** A duel is in flight on the operator — true even for clients that just loaded. */
  duelRunning?: boolean;
  note: string;
}

export interface MevSandwich {
  landed: boolean;
  frontRunHash?: string;
  backRunHash?: string;
  reactionMs?: number;
  searcherProfit?: string;
  error?: string;
}

export interface MevLane {
  lane: "public" | "private";
  quotedOut: string;
  actualOut: string;
  shortfall: string;
  shortfallUsd: number;
  transactionHash?: string;
  transactionLink?: string;
  blockNumber?: number;
  executionId?: string;
  seenInMempool: boolean;
  mempoolExposureMs?: number;
  sandwich?: MevSandwich;
  error?: string;
}

export interface MevDuel {
  id: string;
  at: string;
  amountIn: string;
  baseForQuote: boolean;
  slippageBps: number;
  pool: string;
  chainId: number;
  public?: MevLane;
  private?: MevLane;
  savedUsd: number;
  notes?: string[];
}

export interface MevLeaderboard {
  duels: number;
  sandwichesLanded: number;
  publicSeenInMempool: number;
  privateSeenInMempool: number;
  totalLostUsd: number;
  totalSavedUsd: number;
  worstSingleLossUsd: number;
  avgLossPerPublicTradeUsd: number;
  entries: Array<{
    id: string;
    at: string;
    amountIn: string;
    lostUsd: number;
    savedUsd: number;
    sandwichLanded: boolean;
    publicTx?: string;
    privateTx?: string;
  }>;
}

export interface MevAgentRun {
  executionId: string;
  status: string;
  startedAt?: string;
  transactionHash?: string;
  blockNumber?: number;
  /** null = the observer wasn't connected when this was mined, so we can't say. */
  seenInMempool: boolean | null;
  amountOut?: string;
}

export interface MevAgent {
  configured: boolean;
  reason?: string;
  workflowId?: string;
  runs: MevAgentRun[];
  audited?: number;
  everSeenInMempool?: number;
}

// ─── fetch plumbing ──────────────────────────────────────────────────────────

export class OperatorError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "OperatorError";
    this.status = status;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${OPERATOR}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
      cache: "no-store",
    });
  } catch {
    throw new OperatorError(`operator unreachable at ${OPERATOR}`, 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new OperatorError(
      typeof (body as { error?: string })?.error === "string"
        ? (body as { error: string }).error
        : `HTTP ${res.status}`,
      res.status,
    );
  }
  return body as T;
}

const get = <T>(path: string) => req<T>(path);
const post = <T>(path: string, body?: unknown) =>
  req<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });

export const mevApi = {
  status: () => get<MevStatus>("/mev/status"),
  leaderboard: () => get<MevLeaderboard>("/mev/leaderboard"),
  duels: async (limit = 25) => (await get<{ duels: MevDuel[] }>(`/mev/duels?limit=${limit}`)).duels,
  duel: (id: string) => get<MevDuel>(`/mev/duels/${id}`),
  agent: () => get<MevAgent>("/mev/agent"),
  job: (id: string) => get<Job>(`/jobs/${id}`),
  chains: () =>
    get<{
      chains: Array<{ chainId: number; name: string; enabled: boolean; testnet: boolean; privateMempool: boolean }>;
      privateCapable: string[];
    }>("/mev/chains"),
  /** Starts a duel and returns a job id — it spans several blocks. Poll `job`. */
  runDuel: (p: { amountIn?: string; slippageBps?: number; baseForQuote?: boolean }) =>
    post<{ jobId: string; note: string }>("/mev/duel", p),
};
