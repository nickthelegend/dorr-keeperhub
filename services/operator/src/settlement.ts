/**
 * On-chain PnL settlement, executed by KeeperHub.
 *
 * The perps match off chain — sealed orders, hidden stops, a private book. That
 * privacy is the product, and it means the operator alone knows what everyone
 * is owed. Which is exactly why the operator must not be the one who pays it.
 *
 * `DorrVault.applyPnl` is gated on a `settlement` address that is KeeperHub's
 * wallet, not ours, and the vault rejects any batch whose deltas do not sum to
 * zero. So the operator's power is bounded twice over: it can *propose* a
 * settlement, and the proposal must be a closed system. It cannot mint balance,
 * cannot drain the vault, and cannot pay itself — the contract enforces all
 * three regardless of what this file does.
 *
 * The counterparty on the other side of every trader's delta is the insurance
 * fund, which is KeeperHub's own vault account. When traders win, the fund pays
 * out of capital it actually holds; when they lose, it takes the other side.
 * That is what makes the batch balance without inventing money.
 *
 * Settlement runs through private routing for the same reason orders do: a
 * public settlement batch is a published list of who closed what and for how
 * much. Routing it privately means the ledger updates without broadcasting the
 * book first.
 */
import { createPublicClient, formatUnits, getAddress, http, parseUnits, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { env } from "./env.js";
import { collateralInfo, settledPnlOf, refreshSettled, refreshCollateral } from "./chain.js";
import { getState, persist, logEvent } from "./state.js";

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

export interface KeeperStep {
  label: string;
  contractAddress: string;
  abi: readonly unknown[];
  abiFunction: string;
  /** Stringified, in the order the function takes them. */
  args: unknown[];
  /**
   * Route this write privately.
   *
   * Not a default, because privacy is not free: private routing does not
   * broadcast, it offers the transaction to builders and waits to be included,
   * and measured across this project that has taken anywhere from 12s to 233s.
   * So it is applied where it buys something. A settlement batch is a list of
   * who closed what and for how much — that goes private. An ERC-20 approve
   * discloses nothing about anyone's position, and paying minutes of latency to
   * hide it would be theatre.
   */
  usePrivateMempool?: boolean;
}

export interface KeeperRun {
  executionId: string;
  status: string;
  transactions: Array<{ hash: Hex; blockNumber?: number; receiptStatus?: string }>;
  error?: string;
}

function nodesFor(steps: KeeperStep[]) {
  const nodes: any[] = [
    {
      id: "trigger-1",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: { type: "trigger", label: "Trigger", config: { triggerType: "Webhook" }, status: "idle" },
    },
  ];
  const edges: any[] = [];
  steps.forEach((s, i) => {
    const id = `step-${i + 1}`;
    nodes.push({
      id,
      type: "action",
      position: { x: 252 * (i + 1), y: 0 },
      data: {
        type: "action",
        label: s.label,
        status: "idle",
        config: {
          actionType: "web3/write-contract",
          network: String(env.eth.chainId),
          // The signing wallet. Without it the node has nobody to sign as and
          // fails as "exceeded max retries", which points nowhere near the
          // actual cause.
          integrationId: env.keeperhub.integrationId,
          usePrivateMempool: s.usePrivateMempool === true,
          contractAddress: s.contractAddress,
          abi: JSON.stringify(s.abi),
          abiFunction: s.abiFunction,
          // `functionArgs`, and a JSON *string*. An `args` key is accepted and
          // silently dropped, surfacing much later as "no matching fragment".
          functionArgs: JSON.stringify(s.args),
        },
      },
    });
    const source = i === 0 ? "trigger-1" : `step-${i}`;
    edges.push({ id: `e-${source}-${id}`, source, target: id });
  });
  return { nodes, edges };
}

/**
 * Run a sequence of contract writes on KeeperHub and wait for the result.
 *
 * The workflow is re-pointed at this run's arguments and fired with the org
 * key. `enabled` has to go through PATCH — `go-live` answers 200 and leaves the
 * workflow disabled, which then fails at execution with "Workflow is disabled".
 */
export async function runOnKeeperHub(
  spec: { name: string; description: string; steps: KeeperStep[] },
  timeoutMs = 420_000,
): Promise<KeeperRun> {
  if (!env.keeperhub.apiKey) throw new Error("KEEPERHUB_API_KEY not set");
  const { nodes, edges } = nodesFor(spec.steps);
  const body = {
    name: spec.name,
    description: spec.description,
    nodes,
    edges,
    visibility: "private",
    workflowType: "write",
  };

  let workflowId = env.keeperhub.settlementWorkflowId;
  if (workflowId) {
    const upd = await api(`/api/workflows/${workflowId}`, {
      method: "PATCH",
      body: JSON.stringify({ ...body, enabled: true }),
    });
    if (upd.status >= 400) throw new Error(`could not update workflow: ${JSON.stringify(upd.body).slice(0, 200)}`);
  } else {
    const created = await api<any>("/api/workflows/create", { method: "POST", body: JSON.stringify(body) });
    workflowId = created.body?.id;
    if (!workflowId) throw new Error(`workflow creation failed: ${JSON.stringify(created.body).slice(0, 220)}`);
    await api(`/api/workflows/${workflowId}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: true, workflowType: "write" }),
    });
    console.log(`[settlement] created workflow ${workflowId} — set DORR_SETTLEMENT_WORKFLOW_ID to reuse it`);
  }

  /**
   * Never fire while a previous run is unresolved.
   *
   * KeeperHub sends one transaction at a time per wallet, and private routing
   * holds that lock through inclusion — measured here up to 233s. Firing again
   * on top of that does not queue politely: it produces a second execution
   * that may also land, which is exactly the double-payment the reconciliation
   * exists to clean up after. Better not to create it. So an in-flight run is
   * adopted and waited on rather than duplicated.
   */
  const TERMINAL = new Set(["completed", "failed", "error", "success", "system_error"]);

  const inFlight = async (): Promise<string | undefined> => {
    const { body } = await api<any[]>(`/api/workflows/${workflowId}/executions`);
    const list = Array.isArray(body) ? body : [];
    return list.find((e) => !TERMINAL.has(String(e?.status)))?.id;
  };

  const waitFor = async (id: string, deadline: number): Promise<any> => {
    let st: any = { status: "running" };
    while (Date.now() < deadline) {
      st = (await api<any>(`/api/workflows/executions/${id}/status`)).body;
      if (TERMINAL.has(String(st?.status))) return st;
      await new Promise((r) => setTimeout(r, 2500));
    }
    return st;
  };

  /**
   * Causes worth another attempt.
   *
   * "exceeded max retries" is KeeperHub's generic mask — it covers nonce
   * contention as well as real faults, and the specific message often only
   * appears on a later poll. Treating it as fatal meant giving up on a batch
   * that was merely queued behind the MEV lab.
   */
  const RETRYABLE = /saturated|nonce lock|exceeded max retries|timeout|ECONNRESET|502|503/i;

  let last: any = { status: "unknown" };
  let executionId = "";

  for (let attempt = 0; attempt < 4; attempt++) {
    const adopted = await inFlight();
    if (adopted) {
      console.log(`[keeperhub] adopting in-flight execution ${adopted} instead of firing another`);
      executionId = adopted;
    } else {
      const fire = await api<{ executionId?: string }>(`/api/workflows/${workflowId}/execute`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      executionId = fire.body?.executionId ?? "";
      if (!executionId) {
        throw new Error(
          `could not start settlement (HTTP ${fire.status}): ${JSON.stringify(fire.body).slice(0, 220)}`,
        );
      }
    }

    last = await waitFor(executionId, Date.now() + timeoutMs);

    const err = String(last?.errorContext?.error ?? last?.error ?? "");
    const landed = Array.isArray(last?.transactionHashes) && last.transactionHashes.length > 0;
    // Still running at the deadline is not a failure and must not be reported
    // as one — the caller would keep the PnL owed and the keeper would fire
    // again on top of a live execution.
    if (landed || !TERMINAL.has(String(last?.status))) break;
    if (!RETRYABLE.test(err)) break;

    console.log(`[keeperhub] retryable failure (attempt ${attempt + 1}/4): ${err.slice(0, 90)}`);
    await new Promise((r) => setTimeout(r, 30_000 * (attempt + 1)));
  }

  const raw = Array.isArray(last?.transactionHashes) ? last.transactionHashes : [];
  return {
    executionId,
    status: String(last?.status ?? "unknown"),
    transactions: raw
      .map((t: any) => (typeof t === "string" ? { hash: t as Hex } : t?.hash ? { hash: t.hash as Hex, blockNumber: t.blockNumber != null ? Number(t.blockNumber) : undefined, receiptStatus: t.receiptStatus } : null))
      .filter(Boolean),
    error: last?.errorContext?.error ?? last?.error,
  };
}

// ─── the settlement batch ────────────────────────────────────────────────────

/**
 * Foundry's ABI shape, `internalType` included.
 *
 * Not cosmetic: KeeperHub's write node rejects the terser viem-style entry —
 * and reports it as "exceeded max retries", which points at the network rather
 * than at the ABI that actually caused it. Matching what `forge` emits is the
 * difference between a settlement landing and a silent retry loop.
 */
const VAULT_APPLY_PNL_ABI = [
  {
    type: "function",
    name: "applyPnl",
    inputs: [
      { name: "traders", type: "address[]", internalType: "address[]" },
      { name: "deltas", type: "int256[]", internalType: "int256[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export interface SettlementBatch {
  traders: string[];
  /** Human-readable deltas, trader-order, before the fund's offset. */
  deltas: number[];
  /** What the insurance fund takes on to make the batch sum to zero. */
  fundDelta: number;
  totalAbs: number;
}

/** Anything below this is not worth a transaction. */
export const DUST = 0.01;

/**
 * Build the zero-sum batch from what each trader has earned and what the chain
 * has already paid them.
 *
 * Pure, and separated out because this is where double-payment would happen:
 * `owed` is the difference, so an already-settled trader contributes nothing
 * and a partially-settled one contributes only the remainder.
 */
export function buildBatch(
  entries: Array<{ address: string; cumulativePnl: number; settledPnl: number }>,
): SettlementBatch | null {
  const live = entries
    .map((e) => ({ address: e.address, delta: e.cumulativePnl - e.settledPnl }))
    .filter((o) => Math.abs(o.delta) >= DUST);
  if (live.length === 0) return null;

  const sum = live.reduce((s, o) => s + o.delta, 0);
  return {
    traders: live.map((o) => o.address),
    deltas: live.map((o) => o.delta),
    fundDelta: -sum,
    totalAbs: live.reduce((s, o) => s + Math.abs(o.delta), 0),
  };
}

/**
 * Convert the batch to token units, with the fund absorbing the exact residue.
 *
 * The fund's delta is derived from the *rounded integers*, not from the floats.
 * Rounding each side independently leaves a wei of drift and `applyPnl` reverts
 * on `PnlNotZeroSum` — so the sum is made exact here rather than approximately
 * exact and hoped for.
 */
export function toZeroSumUnits(deltas: number[], decimals: number): { traderUnits: bigint[]; fundUnits: bigint } {
  const units = (v: number): bigint => {
    const u = parseUnits(Math.abs(v).toFixed(decimals), decimals);
    return v < 0 ? -u : u;
  };
  const traderUnits = deltas.map(units);
  return { traderUnits, fundUnits: -traderUnits.reduce((s, d) => s + d, 0n) };
}

/**
 * Collect what is genuinely still owed into a zero-sum batch.
 *
 * "Owed" is the engine's cumulative realized PnL minus what the vault's own
 * `PnlApplied` history says has already been paid. Running this twice in a row
 * produces a batch the second time only if something is actually outstanding —
 * a settlement that landed without the operator noticing simply drops out.
 */
export async function pendingSettlement(): Promise<SettlementBatch | null> {
  const fund = env.keeperhub.orgWallet ? getAddress(env.keeperhub.orgWallet) : "";
  if (!fund || !env.perps.vault) return null;

  const candidates = Object.values(getState().accounts).filter(
    (a) => /^0x[0-9a-fA-F]{40}$/.test(a.address) && getAddress(a.address) !== fund && Math.abs(a.pnl) > 1e-12,
  );
  if (candidates.length === 0) return null;

  const entries = await Promise.all(
    candidates.map(async (a) => ({
      address: getAddress(a.address),
      cumulativePnl: a.pnl,
      settledPnl: await settledPnlOf(a.address),
    })),
  );
  return buildBatch(entries);
}

export interface SettlementResult {
  settled: boolean;
  reason?: string;
  batch?: SettlementBatch;
  executionId?: string;
  status?: string;
  txHashes?: string[];
  error?: string;
}

/**
 * Settle every pending PnL on chain.
 *
 * Nothing local is cleared until the chain confirms. A settlement that reports
 * "completed" but produced no transaction has not settled anything, and zeroing
 * the ledger on that basis would silently delete what traders are owed — so the
 * local `pnl` survives a failure and the next run retries it.
 */
export async function settleNow(): Promise<SettlementResult> {
  if (!env.perps.vault) return { settled: false, reason: "DORR_VAULT_ADDRESS not set" };
  if (!env.keeperhub.orgWallet) return { settled: false, reason: "KEEPERHUB_ORG_WALLET not set" };

  const batch = await pendingSettlement();
  if (!batch) return { settled: false, reason: "nothing to settle" };

  const { decimals } = await collateralInfo();
  const vault = getAddress(env.perps.vault) as Address;
  const fund = getAddress(env.keeperhub.orgWallet) as Address;

  const { traderUnits, fundUnits } = toZeroSumUnits(batch.deltas, decimals);

  const traders = [...batch.traders.map((t) => getAddress(t)), fund];
  const deltas = [...traderUnits, fundUnits];

  // Guard the invariant here too, so a bug shows up as a refusal rather than a
  // revert that costs gas.
  if (deltas.reduce((s, d) => s + d, 0n) !== 0n) {
    return { settled: false, reason: "internal error: batch does not sum to zero" };
  }

  // The fund cannot pay out more than it holds. Checking first turns an
  // undercapitalised fund into a clear message instead of a BackingShortfall.
  if (fundUnits < 0n) {
    const pc = createPublicClient({ chain: sepolia, transport: http(env.eth.rpcUrl) });
    const [fundBal] = (await pc.readContract({
      address: vault,
      abi: [{ inputs: [{ name: "t", type: "address" }], name: "accountOf", outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], stateMutability: "view", type: "function" }],
      functionName: "accountOf",
      args: [fund],
    })) as readonly [bigint, bigint, bigint];
    if (fundBal < -fundUnits) {
      return {
        settled: false,
        reason: `insurance fund holds ${formatUnits(fundBal, decimals)} but owes ${formatUnits(-fundUnits, decimals)} — capitalise it first`,
        batch,
      };
    }
  }

  const run = await runOnKeeperHub({
    name: "dorr — settle PnL",
    description: "Applies the operator's proposed PnL batch to DorrVault. Zero-sum, enforced on chain.",
    steps: [
      {
        label: `Apply PnL (${traders.length} accounts)`,
        contractAddress: vault,
        abi: VAULT_APPLY_PNL_ABI,
        abiFunction: "applyPnl",
        args: [traders, deltas.map((d) => d.toString())],
        usePrivateMempool: true,
      },
    ],
  });

  const stillRunning = !["completed", "success", "failed", "error", "system_error"].includes(run.status);
  const landed = run.transactions.length > 0 && ["completed", "success"].includes(run.status);
  if (!landed) {
    return {
      settled: false,
      reason: stillRunning
        ? "KeeperHub is still executing this settlement — nothing is lost; the next run adopts it rather than firing another"
        : "KeeperHub did not land the settlement — local PnL kept for the next run",
      batch,
      executionId: run.executionId,
      status: run.status,
      error: run.error,
    };
  }

  // Nothing local is decremented. `pnl` is the engine's cumulative record and
  // stays that way; what has been paid is re-read from the vault's events, so
  // the next batch is empty because the chain says so — not because we
  // remembered to subtract.
  for (const t of traders) {
    refreshSettled(t);
    refreshCollateral(t);
  }
  for (let i = 0; i < batch.traders.length; i++) {
    logEvent({
      at: new Date().toISOString(),
      type: "settle",
      address: batch.traders[i],
      detail: `Settled ${batch.deltas[i] >= 0 ? "+" : "−"}${Math.abs(batch.deltas[i]).toFixed(2)} mUSD on chain via KeeperHub`,
      txHash: run.transactions[0]?.hash,
    });
  }
  persist();

  return {
    settled: true,
    batch,
    executionId: run.executionId,
    status: run.status,
    txHashes: run.transactions.map((t) => t.hash),
  };
}
