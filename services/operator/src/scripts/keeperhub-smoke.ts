/**
 * KeeperHub smoke test — land a real, verifiable Sepolia transaction.
 *
 * Uses a zero-value self-transfer: it is a genuine mined transaction, and because
 * KeeperHub's relayer sponsors the gas, a wallet that has never held a wei can
 * land one. That proves the whole path (auth -> org wallet -> chain -> receipt)
 * before any application logic exists.
 *
 * Every write goes out with `simulate` first and an `Idempotency-Key`, which is
 * also how the production paths in this repo behave.
 *
 *   bun run src/scripts/keeperhub-smoke.ts
 */
import { randomUUID } from "node:crypto";
import { env } from "../env.js";

const BASE = env.keeperhub.baseUrl;
const KEY = env.keeperhub.apiKey;
const SEPOLIA = 11155111;

const auth = { authorization: `Bearer ${KEY}`, "content-type": "application/json" };

async function api<T = any>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(BASE + path, { ...init, headers: { ...auth, ...(init.headers as any) } });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 300);
  }
  return { status: res.status, body: body as T };
}

const failures: string[] = [];
const ok = (c: unknown, m: string) => {
  if (c) console.log(`   ✓ ${m}`);
  else {
    failures.push(m);
    console.log(`   ✗ ${m}`);
  }
};

async function main() {
  console.log("═".repeat(68));
  console.log("KeeperHub smoke — Ethereum Sepolia");
  console.log("═".repeat(68));
  if (!KEY) throw new Error("KEEPERHUB_API_KEY missing in .env");

  console.log("\n[1] auth + org wallet");
  const keys = await api("/api/keys");
  ok(keys.status === 200, `API key authenticates (HTTP ${keys.status})`);

  const user = await api<any>("/api/user");
  const orgWallet = user.body?.walletAddress ?? user.body?.data?.walletAddress;
  console.log(`   org wallet: ${orgWallet}`);
  ok(!!orgWallet, "organisation wallet resolved");

  console.log("\n[2] chain support — the fact the whole pitch rests on");
  const chains = await api<any[]>("/api/chains");
  const sep = (chains.body as any[]).find((c) => c.chainId === SEPOLIA);
  console.log(`   ${sep?.name}: enabled=${sep?.isEnabled} testnet=${sep?.isTestnet} privateMempool=${sep?.usePrivateMempoolRpc}`);
  ok(sep?.isEnabled, "Sepolia is enabled");
  ok(sep?.usePrivateMempoolRpc === true, "Sepolia supports PRIVATE MEMPOOL routing");

  console.log("\n[3] simulate a zero-value self-transfer (free, catches everything)");
  const transfer = { chainId: SEPOLIA, recipientAddress: orgWallet, amount: "0" };
  const sim = await api<any>("/api/execute/transfer", {
    method: "POST",
    body: JSON.stringify({ ...transfer, simulate: true }),
  });
  console.log(`   ${sim.status} ${JSON.stringify(sim.body).slice(0, 200)}`);
  ok(sim.status < 400 && !sim.body?.wouldRevert, "simulation passes without reverting");

  console.log("\n[4] execute for real (gas sponsored — wallet holds 0 ETH)");
  const idem = randomUUID();
  const exec = await api<any>("/api/execute/transfer", {
    method: "POST",
    headers: { "Idempotency-Key": idem },
    body: JSON.stringify(transfer),
  });
  console.log(`   ${exec.status} ${JSON.stringify(exec.body).slice(0, 220)}`);
  const executionId = exec.body?.executionId;
  ok(!!executionId, "execution accepted");

  console.log("\n[5] poll for the receipt");
  let status: any = null;
  for (let i = 0; i < 40; i++) {
    const s = await api<any>(`/api/execute/${executionId}/status`);
    status = s.body;
    if (["completed", "failed", "success", "error"].includes(String(status?.status))) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log(`   status:    ${status?.status}`);
  console.log(`   sponsored: ${status?.sponsored}`);
  console.log(`   tx:        ${status?.transactionLink ?? status?.transactionHash}`);
  const receipt = status?.receipts?.[0];
  if (receipt) {
    console.log(`   receipt:   block ${receipt.blockNumber} · gas ${receipt.gasUsed} · verified=${receipt.verified} · ${receipt.receiptStatus}`);
  }
  ok(status?.status === "completed", "execution completed");
  ok(!!status?.transactionHash, "real transaction hash returned");
  ok(receipt?.verified === true, "receipt independently verified on-chain by KeeperHub");

  console.log("\n[6] idempotency — replaying the same key must not double-spend");
  const replay = await api<any>("/api/execute/transfer", {
    method: "POST",
    headers: { "Idempotency-Key": idem },
    body: JSON.stringify(transfer),
  });
  ok(
    replay.body?.idempotentReplay === true || replay.body?.executionId === executionId,
    `replay returned the original execution (idempotentReplay=${replay.body?.idempotentReplay})`,
  );

  console.log("\n" + "═".repeat(68));
  if (failures.length === 0) {
    console.log("✓ KEEPERHUB SMOKE PASSED");
    console.log(`  submission-ready transaction: ${status?.transactionLink}`);
    process.exit(0);
  }
  console.log(`✗ ${failures.length} failure(s):`);
  failures.forEach((f) => console.log(`   - ${f}`));
  process.exit(1);
}

main().catch((e) => {
  console.error("\n✗ smoke failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
