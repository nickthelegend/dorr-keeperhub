import { serve } from "@hono/node-server";
import { env } from "./env.js";
import { pendingSettlement, settleNow } from "./settlement.js";
import { app } from "./routes.js";
import { loadDuels } from "./mev/store.js";
import { reapOrphanedJobs } from "./jobs.js";
import { observer, observerStatus } from "./mev/observer.js";
import { MARKETS } from "./markets.js";
import { validateFeeds, startPricePolling, getPrice } from "./oracle.js";
import { seedPool, recenter } from "./vamm.js";
import { loadState } from "./state.js";
import { applyFundingTick, scanLiquidations, scanLimitOrders, scanStops, settleSealedBatch, expireStaleCommits } from "./trading.js";

/**
 * Refuse to start if an operator is already serving this port.
 *
 * Bun's server sets SO_REUSEPORT, so a second instance binds successfully
 * instead of failing with EADDRINUSE. Both would then serve requests
 * round-robin from different in-memory observers, which produces bizarre
 * symptoms rather than an obvious error.
 */
async function assertPortFree(port: number): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${port}/health`, {
    signal: AbortSignal.timeout(1500),
  }).catch(() => null);
  if (!res?.ok) return;
  console.error(
    `\n✗ an operator is already listening on :${port}.\n` +
      `  Stop it first:  kill $(lsof -ti:${port})\n`,
  );
  process.exit(1);
}

async function main() {
  console.log("dorr operator starting… (perps + MEV Shield, Sepolia via KeeperHub)");
  await assertPortFree(env.port);

  loadState();
  const duels = loadDuels().duels.length;
  console.log(`[mev] ${duels} persisted duel${duels === 1 ? "" : "s"}`);

  const orphans = reapOrphanedJobs();
  if (orphans) console.log(`[jobs] failed ${orphans} job(s) orphaned by a restart`);

  // Start the mempool observer at boot, not lazily on first request. Its value
  // is continuous coverage: a gap means the autonomous agent's swaps land while
  // nothing is watching, and an unwatched swap can only ever be reported as
  // "unobserved" — never as private.
  if (env.mev.pool) {
    observer();
    setTimeout(() => {
      const o = observerStatus();
      console.log(`[mev] mempool observer ${o.connected ? "live" : "not connected"} (${o.seen} seen)`);
    }, 8_000);
  } else {
    console.warn("[mev] MEV_POOL not set — deploy the lab with scripts/mev-deploy.ts");
  }

  // ── perps engine ────────────────────────────────────────────────────────
  // Index prices come from Chainlink on Sepolia; a market whose feed cannot be
  // read is disabled rather than quoted from a stale number.
  await validateFeeds();
  startPricePolling();

  /**
   * Seed the vAMM before serving, not on the first tick.
   *
   * An order commits against the oracle price but fills against the pool, so a
   * pool that does not exist yet accepts the commit and then cannot execute it
   * — leaving the trader's margin locked behind an order that will never fill.
   * The window was two seconds wide and only reachable right after a restart,
   * which is exactly the kind of bug that surfaces during a demo.
   */
  const seeded = new Set<string>();
  const tick = () => {
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
  };
  tick();
  setInterval(tick, 2_000);

  // Keepers: limit triggers, hidden stops, liquidation.
  setInterval(() => {
    const limits = scanLimitOrders();
    if (limits.length) console.log(`[keeper] limit orders triggered: ${limits.join(", ")}`);
    const stops = scanStops();
    if (stops.length) console.log(`[keeper] stops triggered: ${stops.map((s) => `${s.id}:${s.reason}`).join(", ")}`);
    const liq = scanLiquidations();
    if (liq.length) console.log(`[keeper] liquidated: ${liq.join(", ")}`);
    const expired = expireStaleCommits();
    if (expired.length) console.log(`[keeper] expired unexecuted market commits: ${expired.join(", ")}`);
  }, 5_000);
  setInterval(() => applyFundingTick(), 60 * 60 * 1000);

  /**
   * Settlement keeper: push realized PnL onto the chain.
   *
   * Batched rather than per-close because each batch is one transaction and one
   * fee, and because a settlement per trade would publish the timing of every
   * close — the thing sealed orders exist to hide. Five minutes is short enough
   * that a trader's balance is chain-backed almost immediately and long enough
   * that closes group together.
   *
   * Skipped entirely while a run is in flight: KeeperHub serialises writes per
   * wallet, so overlapping runs would just queue behind each other and time out.
   */
  if (env.perps.vault && env.keeperhub.apiKey) {
    let settling = false;
    setInterval(async () => {
      if (settling) return;
      settling = true;
      try {
        const batch = await pendingSettlement();
        if (!batch) return;
        console.log(`[settle] ${batch.traders.length} account(s), ${batch.totalAbs.toFixed(2)} mUSD in flight`);
        const r = await settleNow();
        if (r.settled) console.log(`[settle] landed ${r.txHashes?.[0]}`);
        else console.log(`[settle] deferred: ${r.reason}`);
      } catch (e) {
        console.warn(`[settle] ${String(e).slice(0, 160)}`);
      } finally {
        settling = false;
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Re-quote the autonomous agent's standing order.
   *
   * Its workflow carries a fixed `minOut`, baked in when the schedule was
   * created. Every duel moves the pool, so a floor that was loose on Monday is
   * unreachable by Wednesday and the agent starts failing with
   * `SlippageExceeded` — which looks like the agent is broken when in fact its
   * price is simply stale. Re-pointing it at a fresh quote keeps the standing
   * order tracking the pool it trades against.
   */
  if (env.keeperhub.scheduledWorkflowId && env.keeperhub.apiKey && env.mev.pool) {
    const requote = async () => {
      try {
        const { ensureScheduledDuel } = await import("./mev/scheduled-duel.js");
        const r = await ensureScheduledDuel({
          cron: env.keeperhub.scheduledCron,
          amountIn: env.keeperhub.scheduledAmountIn,
        });
        console.log(`[agent] re-quoted — ${r.cron}, ${r.amountIn} mETH, enabled=${r.enabled}`);
      } catch (e) {
        console.warn(`[agent] could not re-quote: ${String(e).slice(0, 160)}`);
      }
    };
    void requote();
    setInterval(() => void requote(), 20 * 60 * 1000);
  }

  // Sealed-bid keeper: settle each epoch once its drand round lands.
  let settling = false;
  setInterval(async () => {
    if (settling) return;
    settling = true;
    try {
      for (const m of MARKETS) {
        const r = await settleSealedBatch(m.id).catch(() => null);
        if (r && (r.cleared || r.dropped)) {
          console.log(`[seal] ${m.id}: cleared ${r.cleared}${r.dropped ? `, dropped ${r.dropped}` : ""}`);
        }
      }
    } finally {
      settling = false;
    }
  }, 6_000);

  serve({ fetch: app.fetch, port: env.port });
  console.log(`mev-shield operator listening on :${env.port}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
