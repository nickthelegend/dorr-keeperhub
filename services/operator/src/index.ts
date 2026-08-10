import { serve } from "@hono/node-server";
import { env } from "./env.js";
import { app } from "./routes.js";
import { loadDuels } from "./mev/store.js";
import { reapOrphanedJobs } from "./jobs.js";
import { observer, observerStatus } from "./mev/observer.js";

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
  console.log("mev-shield operator starting…");
  await assertPortFree(env.port);

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

  serve({ fetch: app.fetch, port: env.port });
  console.log(`mev-shield operator listening on :${env.port}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
