/**
 * KeeperHub client.
 *
 * Both lanes of the MEV Shield duel go through this one function. That is the
 * point of the experiment: the public lane and the private lane are the *same*
 * relayer, the same gas policy, the same code path, the same signing wallet —
 * differing by a single boolean. Anything else would confound the measurement,
 * because a difference in outcome could then be blamed on the venue, the
 * signer, or the fee market rather than on routing.
 */
import { randomUUID } from "node:crypto";
import type { Address, Hex } from "viem";
import { env } from "../env.js";

export interface ExecutionResult {
  executionId: string;
  status: string;
  transactionHash?: Hex;
  transactionLink?: string;
  sponsored?: boolean;
  receipts?: Array<{
    blockNumber: number;
    gasUsed: string;
    verified: boolean;
    receiptStatus: string;
    transactionHash?: Hex;
  }>;
  idempotentReplay?: boolean;
  error?: string;
  raw?: unknown;
}

function headers(idempotencyKey?: string): Record<string, string> {
  const h: Record<string, string> = {
    authorization: `Bearer ${env.keeperhub.apiKey}`,
    "content-type": "application/json",
  };
  if (idempotencyKey) h["Idempotency-Key"] = idempotencyKey;
  return h;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(env.keeperhub.baseUrl + path, init);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text.slice(0, 400) };
  }
  return { status: res.status, body: body as T };
}

export function isConfigured(): boolean {
  return Boolean(env.keeperhub.apiKey);
}

/** The wallet KeeperHub signs from — distinct from the SIWE key that enrolled it. */
export async function orgWallet(): Promise<Address> {
  const { body } = await call<any>("/api/user", { headers: headers() });
  const w = body?.walletAddress ?? body?.data?.walletAddress;
  if (!w) throw new Error("KeeperHub did not return an organisation wallet");
  return String(w).toLowerCase() as Address;
}

export interface ChainInfo {
  chainId: number;
  name: string;
  isEnabled: boolean;
  isTestnet: boolean;
  usePrivateMempoolRpc: boolean;
}

export async function chains(): Promise<ChainInfo[]> {
  const { body } = await call<ChainInfo[]>("/api/chains", { headers: headers() });
  return Array.isArray(body) ? body : [];
}

export interface ContractCallParams {
  contractAddress: Address;
  functionName: string;
  /** Human-readable ABI entry, e.g. "function swap(bool,uint256,uint256,address)". */
  abi: unknown[];
  args: unknown[];
  chainId?: number;
  /** THE variable under test. False routes through the public mempool. */
  usePrivateMempool?: boolean;
  simulate?: boolean;
  idempotencyKey?: string;
}

/**
 * Execute a contract call. Always simulate before the real send when the caller
 * asks for it — a revert caught in simulation costs nothing, one caught on
 * chain costs a block and muddies the duel's timing.
 */
export async function contractCall(p: ContractCallParams): Promise<ExecutionResult> {
  // Both `abi` and `functionArgs` must be JSON *strings*, not arrays. Passing
  // arrays is accepted without complaint and then fails much later and much
  // less legibly: an array `abi` is dropped and the API falls back to
  // block-explorer auto-fetch ("contract may not be verified" — misleading,
  // since we supplied one), and an array under `args` encodes as zero
  // arguments ("types/values length mismatch, count=0" — reads like a bad ABI).
  // Serialised here once so no caller has to rediscover either.
  const payload: Record<string, unknown> = {
    chainId: p.chainId ?? env.eth.chainId,
    contractAddress: p.contractAddress,
    functionName: p.functionName,
    abi: JSON.stringify(p.abi),
    functionArgs: JSON.stringify(p.args.map((a) => (typeof a === "bigint" ? a.toString() : a))),
  };
  if (p.usePrivateMempool !== undefined) payload.usePrivateMempool = p.usePrivateMempool;
  if (p.simulate) payload.simulate = true;

  const { status, body } = await call<any>("/api/execute/contract-call", {
    method: "POST",
    headers: headers(p.simulate ? undefined : p.idempotencyKey || randomUUID()),
    body: JSON.stringify(payload),
  });

  if (status >= 400) {
    return {
      executionId: "",
      status: "failed",
      error:
        body?.details || body?.error || body?.message || `HTTP ${status} ${JSON.stringify(body).slice(0, 200)}`,
      raw: body,
    };
  }
  return { ...(body as ExecutionResult), raw: body };
}

export async function executionStatus(executionId: string): Promise<ExecutionResult> {
  const { body } = await call<ExecutionResult>(`/api/execute/${executionId}/status`, {
    headers: headers(),
  });
  return { ...body, raw: body };
}

const TERMINAL = new Set(["completed", "failed", "success", "error", "reverted"]);

/** Poll until the execution reaches a terminal state or the timeout expires. */
export async function waitForExecution(executionId: string, timeoutMs = 180_000): Promise<ExecutionResult> {
  const deadline = Date.now() + timeoutMs;
  let last: ExecutionResult = { executionId, status: "pending" };
  while (Date.now() < deadline) {
    last = await executionStatus(executionId);
    if (TERMINAL.has(String(last.status))) return last;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { ...last, error: `timed out after ${timeoutMs}ms in status "${last.status}"` };
}
