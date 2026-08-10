/**
 * The autonomous private-routing agent.
 *
 * MEV Shield uses KeeperHub to *execute* — both lanes of a duel go through it.
 * This closes the loop and uses KeeperHub to *operate*: a Schedule-triggered
 * workflow performs a real private swap on a cron, unattended, with no operator
 * involvement at all. It is an onchain agent in the sense KeeperHub means it.
 *
 * What makes it more than a cron job is that its privacy is continuously
 * audited. The operator's always-on mempool observer is watching independently,
 * so every autonomous swap can be checked after the fact: was this hash ever
 * visible in the public mempool before it was mined? A claim of privacy that
 * nobody checks is marketing; this one is checked every time, by something that
 * did not participate in sending it.
 *
 * Two honesty constraints are enforced below rather than glossed over:
 *   - A verdict is only reported for swaps mined while the observer was
 *     actually connected. "We didn't see it" is worthless if we weren't
 *     looking, so those are reported as unobserved, not as private.
 *   - The outbound-webhook action (which would let KeeperHub call this operator
 *     directly) requires a paid plan. Rather than ship a workflow that cannot
 *     run, the agent does the swap itself — which needs no inbound reachability
 *     and is a better demonstration anyway.
 */
import { createPublicClient, decodeEventLog, formatUnits, http, parseUnits, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { env } from "../env.js";
import { POOL_ABI } from "./artifacts.js";
import { observer, observerConnectedSince } from "./observer.js";

const BASE = env.keeperhub.baseUrl;

const headers = (): Record<string, string> => ({
  authorization: `Bearer ${env.keeperhub.apiKey}`,
  "content-type": "application/json",
});

async function api<T = any>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(BASE + path, { headers: headers(), ...init });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body };
}

export interface ScheduleOptions {
  /** Standard 5-field cron, UTC. Default: hourly. */
  cron?: string;
  /** Human units of base token to sell each run. */
  amountIn?: string;
  /** Slippage tolerance for the agent's own swap. */
  slippageBps?: number;
}

function workflowBody(cron: string, amountIn: bigint, minOut: bigint, recipient: Address) {
  return {
    name: "MEV Shield — autonomous private swap",
    description:
      "Executes a real swap through KeeperHub private routing on a schedule. The operator's mempool observer audits each one for exposure.",
    visibility: "private",
    workflowType: "write",
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 0, y: 0 },
        data: {
          type: "trigger",
          label: "Schedule",
          status: "idle",
          config: { triggerType: "Schedule", scheduleCron: cron, scheduleTimezone: "UTC" },
        },
      },
      {
        id: "step-1",
        type: "action",
        position: { x: 252, y: 0 },
        data: {
          type: "action",
          label: "Private swap",
          description: "Routed privately — should never reach the public mempool",
          status: "idle",
          config: {
            actionType: "web3/write-contract",
            network: String(env.eth.chainId),
            usePrivateMempool: true,
            contractAddress: env.mev.pool,
            abi: JSON.stringify(POOL_ABI),
            abiFunction: "swap",
            functionArgs: JSON.stringify([true, amountIn.toString(), minOut.toString(), recipient]),
          },
        },
      },
    ],
    edges: [{ id: "e-trigger-1-step-1", source: "trigger-1", target: "step-1" }],
  };
}

export interface ScheduleResult {
  workflowId: string;
  enabled: boolean;
  cron: string;
  amountIn: string;
  valid: boolean;
  warnings: string[];
}

/** Create or refresh the autonomous agent. Idempotent on the id in env. */
export async function ensureScheduledDuel(opts: ScheduleOptions = {}): Promise<ScheduleResult> {
  if (!env.keeperhub.apiKey) throw new Error("KEEPERHUB_API_KEY not set");
  if (!env.mev.pool) throw new Error("MEV_POOL not set — deploy the lab first");
  if (!env.keeperhub.orgWallet) throw new Error("KEEPERHUB_ORG_WALLET not set");

  const cron = opts.cron ?? "0 * * * *";
  const amountIn = parseUnits(opts.amountIn ?? "2", 18);
  const slippageBps = opts.slippageBps ?? 100;

  // Quote now so the standing order carries a real slippage floor rather than
  // accepting any price. The pool drifts between runs, so the floor is
  // deliberately loose — but it is a floor, not `0`.
  const pc = createPublicClient({ chain: sepolia, transport: http(env.eth.rpcUrl) });
  const quoted = (await pc.readContract({
    address: env.mev.pool as Address,
    abi: POOL_ABI,
    functionName: "getAmountOut",
    args: [true, amountIn],
  })) as bigint;
  const minOut = (quoted * BigInt(10_000 - slippageBps * 5)) / 10_000n;

  const body = workflowBody(cron, amountIn, minOut, env.keeperhub.orgWallet as Address);

  let workflowId = env.keeperhub.scheduledWorkflowId;
  if (workflowId) {
    const upd = await api(`/api/workflows/${workflowId}`, {
      method: "PATCH",
      body: JSON.stringify({ ...body, enabled: true }),
    });
    if (upd.status >= 400) throw new Error(`could not update: ${JSON.stringify(upd.body).slice(0, 220)}`);
  } else {
    const created = await api<any>("/api/workflows/create", { method: "POST", body: JSON.stringify(body) });
    workflowId = created.body?.id;
    if (!workflowId) throw new Error(`create failed: ${JSON.stringify(created.body).slice(0, 260)}`);
    await api(`/api/workflows/${workflowId}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: true, workflowType: "write" }),
    });
  }

  const check = await api<any>(`/api/workflows/${workflowId}/validate`);
  const result = check.body?.result ?? {};
  const after = await api<any>(`/api/workflows/${workflowId}`);

  return {
    workflowId,
    enabled: Boolean(after.body?.enabled),
    cron,
    amountIn: formatUnits(amountIn, 18),
    valid: Boolean(result.valid),
    warnings: (result.warnings ?? []).map((w: { message?: string }) => w.message ?? String(w)),
  };
}

export interface AgentRun {
  executionId: string;
  status: string;
  startedAt?: string;
  transactionHash?: string;
  blockNumber?: number;
  /**
   * Was this transaction ever visible in the public mempool? `null` means the
   * observer was not connected when it was mined, so we cannot say — which is
   * reported as such rather than being counted as a privacy win.
   */
  seenInMempool: boolean | null;
  amountOut?: string;
}

/**
 * Recent agent runs, each audited against the observer's own record.
 */
export async function agentRuns(limit = 10): Promise<AgentRun[]> {
  const id = env.keeperhub.scheduledWorkflowId;
  if (!id) return [];

  const { body } = await api<any[]>(`/api/workflows/${id}/executions`);
  const executions = (Array.isArray(body) ? body : []).slice(0, limit);
  if (executions.length === 0) return [];

  // Only touch the observer when there is actually something to audit —
  // `observer()` opens a long-lived WebSocket, which would keep a short-lived
  // CLI process alive forever.
  const watchingSince = observerConnectedSince();
  const pc = createPublicClient({ chain: sepolia, transport: http(env.eth.rpcUrl) });
  const obs = watchingSince !== undefined ? observer() : undefined;

  const out: AgentRun[] = [];
  for (const e of executions) {
    const { body: st } = await api<any>(`/api/workflows/executions/${e.id}/status`);
    const tx = (st?.transactionHashes ?? [])[0];
    const hash: Hex | undefined = typeof tx === "string" ? (tx as Hex) : tx?.hash;

    const run: AgentRun = {
      executionId: e.id,
      status: String(st?.status ?? e.status),
      startedAt: e.startedAt,
      transactionHash: hash,
      blockNumber: tx?.blockNumber,
      seenInMempool: null,
    };

    if (hash) {
      try {
        const receipt = await pc.getTransactionReceipt({ hash });
        run.blockNumber = Number(receipt.blockNumber);
        const block = await pc.getBlock({ blockNumber: receipt.blockNumber });
        const minedAt = Number(block.timestamp) * 1000;
        // Only judge runs that happened while we were actually watching.
        if (obs && watchingSince && minedAt >= watchingSince) {
          run.seenInMempool = Boolean(obs.sawInMempool(hash));
        }
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== (env.mev.pool as string).toLowerCase()) continue;
          try {
            const d = decodeEventLog({ abi: POOL_ABI, data: log.data, topics: log.topics });
            if (d.eventName === "Swap") {
              run.amountOut = formatUnits((d.args as unknown as { amountOut: bigint }).amountOut, 18);
            }
          } catch {
            /* not the Swap event */
          }
        }
      } catch {
        /* receipt not available yet */
      }
    }
    out.push(run);
  }
  return out;
}
