import { serve } from "@hono/node-server";
import { env } from "./env.js";
import { app } from "./routes.js";
import { MARKETS } from "./markets.js";
import { validateFeeds, startPricePolling, getPrice } from "./ftso.js";
import { seedPool, recenter } from "./vamm.js";
import { loadState } from "./state.js";
import { loadDuels } from "./mev/store.js";
import { reapOrphanedJobs } from "./jobs.js";
import { applyFundingTick, scanLiquidations, scanLimitOrders, scanStops, settleSealedBatch } from "./trading.js";
import { initCardano } from "./cardano.js";

/**
 * Refuse to start if an operator is already serving this port.
 *
 * Bun's server sets SO_REUSEPORT, so a second instance binds successfully
 * instead of failing with EADDRINUSE. Both then hold their own in-memory state
 * and both write `state.json`, so the last writer silently erases the other's
 * jobs — and incoming requests round-robin between two disagreeing operators.
 * The symptom is bizarre (a duel "running" with no job to show for it), so fail
 * loudly here rather than let it happen.
 */
async function assertPortFree(port: number): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${port}/health`, {
    signal: AbortSignal.timeout(1500),
  }).catch(() => null);
  if (!res?.ok) return;
  const who = await res.json().catch(() => ({}) as { service?: string });
  console.error(
    `\n✗ an operator is already listening on :${port} (${(who as { service?: string }).service ?? "unknown"}).\n` +
      `  Two instances share one state file and will corrupt each other's jobs.\n` +
      `  Stop it first:  kill $(lsof -ti:${port})\n`,
  );
  process.exit(1);
}

async function main() {
  console.log("dorr operator starting…");
  await assertPortFree(env.port);
  loadState();
  // MEV Shield duel history is persisted separately from trading state, so the
  // leaderboard survives independently of the operator ledger.
  const duels = loadDuels().duels.length;
  if (duels) console.log(`[mev] ${duels} persisted duel${duels === 1 ? "" : "s"} loaded`);

  // Jobs cannot survive the process that ran them; leaving them "running" makes
  // the UI poll a spinner that will never resolve.
  const orphans = reapOrphanedJobs();
  if (orphans) console.log(`[jobs] failed ${orphans} job(s) orphaned by a restart`);

  // Eagerly bring up Cardano so cardanoReady() is true from the start (enables
  // CIP-68 minting on execute). Non-fatal: an unfunded/misconfigured wallet just
  // leaves Cardano routes to surface their own errors.
  await initCardano().catch((e) =>
    console.warn(`[cardano] init deferred: ${String(e).slice(0, 160)}`),
  );

  await validateFeeds();
  startPricePolling();

  // Seed vAMM pools once prices exist, then keep them centered on Pyth.
  const seeded = new Set<string>();
  setInterval(() => {
    for (const m of MARKETS) {
      const p = getPrice(m.feedId);
      if (!p) continue;
      if (!seeded.has(m.id)) {
        seedPool(m, p.price);
        seeded.add(m.id);
        console.log(`[vamm] seeded ${m.symbol} @ $${p.price.toFixed(6)}`);
      } else {
        recenter(m, p.price);
      }
    }
  }, 2_000);

  // Keepers: limit-order triggers, hidden SL/TP triggers, liquidation — every 5s.
  setInterval(() => {
    const limits = scanLimitOrders();
    if (limits.length) console.log(`[keeper] limit orders triggered: ${limits.join(", ")}`);
    const stops = scanStops();
    if (stops.length) console.log(`[keeper] stops triggered: ${stops.map((s) => `${s.id}:${s.reason}`).join(", ")}`);
    const liq = scanLiquidations();
    if (liq.length) console.log(`[keeper] liquidated: ${liq.join(", ")}`);
  }, 5_000);
  setInterval(() => applyFundingTick(), 60 * 60 * 1000);

  // Sealed-bid keeper: settle each market's sealed epoch once its drand round
  // lands (decrypt → verify → uniform-price clear → open positions). Talks to
  // the real drand network, so run it on its own interval and never overlap.
  let settling = false;
  setInterval(async () => {
    if (settling) return;
    settling = true;
    try {
      for (const m of MARKETS) {
        const r = await settleSealedBatch(m.id).catch(() => null);
        if (r && (r.cleared || r.dropped)) {
          console.log(`[seal] ${m.id}: cleared ${r.cleared} @ ${r.clearingPrice?.toFixed(6) ?? "?"}${r.dropped ? `, dropped ${r.dropped}` : ""}`);
        }
      }
    } finally {
      settling = false;
    }
  }, 6_000);

  serve({ fetch: app.fetch, port: env.port });
  console.log(`dorr operator listening on :${env.port}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
