/**
 * Isolate why a write node fails.
 *
 * The failure KeeperHub reports — "exceeded max retries" — is the same string
 * for every cause, so the only way to find the real one is to vary a single
 * knob at a time against a contract we already know works.
 */
import { env } from "../env.js";

const BASE = env.keeperhub.baseUrl;
const headers = { authorization: `Bearer ${env.keeperhub.apiKey}`, "content-type": "application/json" };

async function api<T = any>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(BASE + path, { headers, ...init });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: { raw: text.slice(0, 300) } as any };
  }
}

const APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "nonpayable",
  },
];

async function trial(label: string, config: Record<string, unknown>) {
  const body = {
    name: `probe — ${label}`,
    description: "diagnostic",
    visibility: "private",
    workflowType: "write",
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 0, y: 0 },
        data: { type: "trigger", label: "Trigger", config: { triggerType: "Webhook" }, status: "idle" },
      },
      {
        id: "step-1",
        type: "action",
        position: { x: 252, y: 0 },
        data: { type: "action", label: "Approve", status: "idle", config },
      },
    ],
    edges: [{ id: "e-trigger-1-step-1", source: "trigger-1", target: "step-1" }],
  };

  const created = await api<any>("/api/workflows/create", { method: "POST", body: JSON.stringify(body) });
  const id = created.body?.id;
  if (!id) return console.log(`${label.padEnd(28)} create failed: ${JSON.stringify(created.body).slice(0, 120)}`);
  await api(`/api/workflows/${id}`, { method: "PATCH", body: JSON.stringify({ enabled: true, workflowType: "write" }) });

  const val = await api<any>(`/api/workflows/${id}/validate`);
  const fire = await api<any>(`/api/workflows/${id}/execute`, { method: "POST", body: JSON.stringify({}) });
  const exec = fire.body?.executionId;
  if (!exec) {
    console.log(`${label.padEnd(28)} fire failed (${fire.status}): ${JSON.stringify(fire.body).slice(0, 140)}`);
    await api(`/api/workflows/${id}`, { method: "DELETE" });
    return;
  }

  let st: any = {};
  for (let i = 0; i < 40; i++) {
    st = (await api<any>(`/api/workflows/executions/${exec}/status`)).body;
    if (["completed", "failed", "error", "success", "system_error"].includes(String(st?.status))) break;
    await new Promise((r) => setTimeout(r, 2500));
  }
  const tx = (st?.transactionHashes ?? [])[0];
  console.log(
    `${label.padEnd(28)} valid=${val.body?.result?.valid} status=${st?.status}` +
      (tx ? `  tx=${typeof tx === "string" ? tx : tx.hash}` : "") +
      (st?.errorContext?.error ? `\n${" ".repeat(30)}${String(st.errorContext.error).slice(0, 160)}` : ""),
  );
  await api(`/api/workflows/${id}`, { method: "DELETE" });
}

const base = {
  actionType: "web3/write-contract",
  network: String(env.eth.chainId),
  integrationId: env.keeperhub.integrationId,
  contractAddress: env.mev.quoteToken,
  abi: JSON.stringify(APPROVE_ABI),
  abiFunction: "approve",
  functionArgs: JSON.stringify([env.perps.vault, "1000000000000000000"]),
};

console.log(`integration ${env.keeperhub.integrationId || "(none)"}\ntoken       ${env.mev.quoteToken}\n`);

// Does the write node handle array + negative-int256 arguments at all?
const APPLY_ABI = [
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
];

// Zero deltas: a real call shape that changes no balances if it lands.
const applyBase = {
  actionType: "web3/write-contract",
  network: String(env.eth.chainId),
  integrationId: env.keeperhub.integrationId,
  contractAddress: env.perps.vault,
  abi: JSON.stringify(APPLY_ABI),
  abiFunction: "applyPnl",
  functionArgs: JSON.stringify([[env.keeperhub.orgWallet], ["0"]]),
};

const TRADER = "0x38bE262f1945F96283d6f084FF488372D7F08214";
const pair = (deltas: string[]) => JSON.stringify([[env.keeperhub.orgWallet, TRADER], deltas]);

// 1 wei each way — a real zero-sum batch, small enough to be free to be wrong.
await trial("zero deltas (string)", { ...applyBase });
await trial("negative delta (string)", { ...applyBase, functionArgs: pair(["1", "-1"]) });
await trial("negative delta (number)", { ...applyBase, functionArgs: JSON.stringify([[env.keeperhub.orgWallet, TRADER], [1, -1]]) });
