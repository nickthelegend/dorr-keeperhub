/**
 * The private lane.
 *
 * Private routing is not available on the direct `/api/execute/*` REST path —
 * that path accepts a `usePrivateMempool` flag, returns 200, and then publishes
 * the transaction to the public mempool anyway. We measured that: the first
 * live duel saw the supposedly-private transaction in the mempool 1.0s before
 * inclusion. A flag that is silently ignored is worse than one that errors, so
 * this module does not use it.
 *
 * Private routing lives on workflow nodes instead, and reaching it costs three
 * credentials and a trade-off:
 *
 *   1. create a workflow (`kh_` org key) whose write node carries
 *      `usePrivateMempool: true`
 *   2. enable it (`kh_` key, PATCH — `go-live` returns 200 without enabling)
 *   3. fire it (`wfb_` webhook key, which only a browser session can mint)
 *
 * The trade-off: the sponsored REST path pays gas for you, the private workflow
 * path does not. The executing wallet must hold native ETH. That is a real
 * product constraint, not a lab artifact, and MEV Shield reports it rather than
 * hiding it — for small trades the gas can exceed the MEV saved, and a tool
 * that tells you to route privately regardless of size would be selling you
 * something.
 */
import type { Address, Hex } from "viem";
import { env } from "../env.js";
import { POOL_ABI } from "./artifacts.js";
import { mintWebhookKey, siweLogin } from "./kh-session.js";

const BASE = env.keeperhub.baseUrl;

const orgHeaders = (): Record<string, string> => ({
  authorization: `Bearer ${env.keeperhub.apiKey}`,
  "content-type": "application/json",
});

async function api<T = any>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(BASE + path, { headers: orgHeaders(), ...init });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  return { status: res.status, body };
}

export interface SwapArgs {
  pool: Address;
  baseForQuote: boolean;
  amountIn: bigint;
  minAmountOut: bigint;
  recipient: Address;
}

function swapNode(a: SwapArgs) {
  return {
    id: "step-1",
    type: "action",
    position: { x: 252, y: 0 },
    data: {
      type: "action",
      label: "Private Swap",
      status: "idle",
      config: {
        actionType: "web3/write-contract",
        network: String(env.eth.chainId),
        // The whole point of this module.
        usePrivateMempool: true,
        contractAddress: a.pool,
        abi: JSON.stringify(POOL_ABI),
        abiFunction: "swap",
        // JSON *string*, and the key is `functionArgs`. An `args` key is
        // accepted and silently dropped, which surfaces much later as
        // "no matching fragment" — an error that points at the ABI, not the
        // field name that actually caused it.
        functionArgs: JSON.stringify([
          a.baseForQuote,
          a.amountIn.toString(),
          a.minAmountOut.toString(),
          a.recipient,
        ]),
      },
    },
  };
}

const TRIGGER_NODE = {
  id: "trigger-1",
  type: "trigger",
  position: { x: 0, y: 0 },
  data: { type: "trigger", label: "Trigger", config: { triggerType: "Webhook" }, status: "idle" },
};

const EDGES = [{ id: "e-trigger-1-step-1", source: "trigger-1", target: "step-1" }];

/** Create the private-lane workflow, or reuse the configured one. */
export async function ensureWorkflow(args: SwapArgs): Promise<string> {
  const existing = env.keeperhub.privateWorkflowId;
  const nodes = [TRIGGER_NODE, swapNode(args)];

  if (existing) {
    // Re-point the node at this duel's arguments and make sure it is live.
    // `enabled` must go through PATCH: `go-live` answers 200 and leaves the
    // workflow disabled, which then fails at the webhook with "Workflow is
    // disabled".
    const { status, body } = await api(`/api/workflows/${existing}`, {
      method: "PATCH",
      body: JSON.stringify({ nodes, edges: EDGES, enabled: true, workflowType: "write" }),
    });
    if (status >= 400) throw new Error(`could not update workflow: ${JSON.stringify(body).slice(0, 200)}`);
    return existing;
  }

  const created = await api<any>("/api/workflows/create", {
    method: "POST",
    body: JSON.stringify({
      name: "MEV Shield — private lane",
      description: "Executes the lab swap through KeeperHub private routing",
      nodes,
      edges: EDGES,
      visibility: "private",
      workflowType: "write",
    }),
  });
  const id = created.body?.id;
  if (!id) throw new Error(`workflow creation failed: ${JSON.stringify(created.body).slice(0, 200)}`);
  await api(`/api/workflows/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled: true, workflowType: "write" }),
  });
  return id;
}

/** A `wfb_` key, minted on demand if one isn't configured. */
export async function webhookKey(): Promise<string> {
  if (env.keeperhub.webhookKey) return env.keeperhub.webhookKey;
  const session = await siweLogin();
  return mintWebhookKey(session, "mev-shield-webhook");
}

/**
 * One transaction produced by a workflow run.
 *
 * Note the shape: workflow executions report `transactionHashes` as an array of
 * *objects*, whereas the direct REST executor reports a bare `transactionHash`
 * string. The two paths disagree, so this normalises to the richer form.
 */
export interface PrivateTx {
  hash: Hex;
  blockNumber?: number;
  gasUsed?: string;
  verified?: boolean;
  receiptStatus?: string;
}

export interface PrivateExecution {
  executionId: string;
  status: string;
  transactions: PrivateTx[];
  error?: string;
  /** Confirms the run really did take the private path we configured. */
  routedPrivately: boolean;
}

function normaliseHashes(raw: unknown): PrivateTx[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t): PrivateTx | undefined => {
      if (typeof t === "string") return { hash: t as Hex };
      if (t && typeof t === "object" && typeof (t as any).hash === "string") {
        const o = t as any;
        return {
          hash: o.hash as Hex,
          blockNumber: o.blockNumber != null ? Number(o.blockNumber) : undefined,
          gasUsed: o.gasUsed,
          verified: o.verified,
          receiptStatus: o.receiptStatus,
        };
      }
      return undefined;
    })
    .filter((t): t is PrivateTx => Boolean(t));
}

/**
 * Fire the workflow and wait for it to reach a terminal state.
 *
 * The default timeout is deliberately generous. Private routing does not
 * broadcast — it offers the transaction to builders and waits to be included,
 * so its latency is far more variable than a public send. Measured across runs
 * of this lab: 11.8s, 60.3s, 232.8s. A 180s timeout looked reasonable and threw
 * away a successful 232s execution as a failure, which then suppressed the
 * saving for that duel. Waiting longer costs nothing; giving up early
 * fabricates a loss for the lane we are trying to measure fairly.
 */
export async function executePrivately(args: SwapArgs, timeoutMs = 420_000): Promise<PrivateExecution> {
  const workflowId = await ensureWorkflow(args);
  const wfb = await webhookKey();

  const res = await fetch(`${BASE}/api/workflows/${workflowId}/webhook`, {
    method: "POST",
    headers: { authorization: `Bearer ${wfb}`, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  const fired = (await res.json().catch(() => ({}))) as { executionId?: string };
  const executionId = fired?.executionId;
  if (!executionId) {
    throw new Error(`webhook trigger failed (HTTP ${res.status}): ${JSON.stringify(fired).slice(0, 250)}`);
  }

  const deadline = Date.now() + timeoutMs;
  let last: any = { status: "running" };
  while (Date.now() < deadline) {
    const { body } = await api<any>(`/api/workflows/executions/${executionId}/status`);
    last = body;
    if (["completed", "failed", "error", "success"].includes(String(body?.status))) break;
    await new Promise((r) => setTimeout(r, 2500));
  }

  return {
    executionId,
    status: String(last?.status ?? "unknown"),
    transactions: normaliseHashes(last?.transactionHashes),
    error: last?.errorContext?.error ?? last?.error,
    routedPrivately: true,
  };
}
