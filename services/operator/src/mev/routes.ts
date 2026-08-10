/**
 * MEV Shield HTTP surface.
 *
 * A duel spans several Sepolia blocks — two relayed executions plus a live
 * sandwich race — so `POST /mev/duel` starts a job and returns immediately
 * rather than holding a request open for minutes. The UI polls the job, which
 * is the same pattern the rest of this operator uses for on-chain work.
 */
import { Hono, type Context } from "hono";
import { createPublicClient, formatUnits, http, type Address } from "viem";
import { sepolia } from "viem/chains";
import { env } from "../env.js";
import { completeJob, createJob, failJob, jobStep } from "../jobs.js";
import { POOL_ABI } from "./artifacts.js";
import { runDuel } from "./duel.js";
import * as kh from "./keeperhub.js";
import { getDuel, leaderboard, listDuels } from "./store.js";
import { observerStatus, subscribe, type FeedEvent } from "./observer.js";
import { agentRuns } from "./scheduled-duel.js";

export const mev = new Hono();

const bad = (c: Context, msg: string, code: 400 | 404 | 409 | 500 | 502 = 400) => c.json({ error: msg }, code);

const configured = () => Boolean(env.mev.pool && env.keeperhub.apiKey);

/**
 * Whether a duel is in flight. Module-scoped because it guards a physical
 * resource — the pool — not a per-request one: two overlapping duels would
 * sandwich each other and neither result would mean anything.
 *
 * Reported by /mev/status so a client that reloaded mid-duel can tell, rather
 * than re-enabling its button and walking into a 409.
 */
let running = false;

/** Lab configuration and live pool state. */
mev.get("/mev/status", async (c) => {
  if (!env.mev.pool) {
    return c.json({
      configured: false,
      reason: "MEV_POOL not set — run services/operator/src/scripts/mev-deploy.ts",
    });
  }
  try {
    const pc = createPublicClient({ chain: sepolia, transport: http(env.eth.rpcUrl) });
    const pool = env.mev.pool as Address;
    const [reserveBase, reserveQuote, midPrice, searcherGas] = (await Promise.all([
      pc.readContract({ address: pool, abi: POOL_ABI, functionName: "reserveBase" }),
      pc.readContract({ address: pool, abi: POOL_ABI, functionName: "reserveQuote" }),
      pc.readContract({ address: pool, abi: POOL_ABI, functionName: "midPrice" }),
      env.mev.searcherAddress
        ? pc.getBalance({ address: env.mev.searcherAddress as Address })
        : Promise.resolve(0n),
    ])) as [bigint, bigint, bigint, bigint];

    return c.json({
      configured: configured(),
      chainId: env.eth.chainId,
      network: env.eth.network,
      explorer: env.eth.explorer,
      pool,
      baseToken: env.mev.baseToken,
      quoteToken: env.mev.quoteToken,
      reserveBase: formatUnits(reserveBase, 18),
      reserveQuote: formatUnits(reserveQuote, 18),
      midPriceUsd: Number(formatUnits(midPrice, 18)),
      searcher: env.mev.searcherAddress || null,
      searcherArmed: Boolean(env.mev.searcherKey),
      // The adversary pays its own gas, so it runs dry over a long session and
      // then silently stops landing attacks. Surface it before that happens —
      // a lab whose attacker is broke reports "$0 lost" and looks like a win.
      searcherGasEth: Number(formatUnits(searcherGas, 18)),
      searcherFunded: searcherGas > 1_000_000_000_000_000n, // 0.001 ETH
      trader: env.keeperhub.orgWallet || null,
      privateLaneReady: Boolean(env.keeperhub.apiKey && env.keeperhub.orgWallet),
      duelRunning: running,
      note:
        "quote token is an 18dp USD stand-in: 1 mUSD := $1, so a base->quote shortfall is already denominated in dollars",
    });
  } catch (e) {
    return bad(c, `could not read the pool: ${String(e).slice(0, 200)}`, 500);
  }
});

/** Which chains KeeperHub can route privately — the constraint the pitch rests on. */
mev.get("/mev/chains", async (c) => {
  if (!kh.isConfigured()) return bad(c, "KEEPERHUB_API_KEY not set");
  try {
    const chains = await kh.chains();
    return c.json({
      chains: chains.map((ch) => ({
        chainId: ch.chainId,
        name: ch.name,
        enabled: ch.isEnabled,
        testnet: ch.isTestnet,
        privateMempool: ch.usePrivateMempoolRpc,
      })),
      privateCapable: chains.filter((ch) => ch.usePrivateMempoolRpc).map((ch) => ch.name),
    });
  } catch (e) {
    return bad(c, `could not read chains: ${String(e).slice(0, 200)}`, 500);
  }
});

/** Start a duel. Returns a job id immediately; poll `/jobs/:id`. */
mev.post("/mev/duel", async (c) => {
  if (!configured()) return bad(c, "MEV lab not configured — deploy it and set KEEPERHUB_API_KEY");

  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const amountIn = String(body.amountIn ?? "10");
  const size = Number(amountIn);
  const slippageBps = Number(body.slippageBps ?? 100);
  const baseForQuote = body.baseForQuote !== false;

  // Validate the request before the concurrency check. Otherwise a malformed
  // request sent while a duel happens to be running is answered with "already
  // running", the caller fixes the wrong thing, and the real problem only
  // surfaces on the next attempt.
  if (!Number.isFinite(size) || size <= 0) {
    return bad(c, "amountIn must be a positive number of tokens, e.g. \"10\"");
  }
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 5000) {
    return bad(c, "slippageBps must be a whole number between 1 and 5000");
  }

  // A trade larger than the pool can absorb is not a demo, it is a wasted pair
  // of real transactions: it drains the reserve, wrecks the price for every
  // later duel, and the searcher can extract nothing meaningful from it.
  try {
    const pc = createPublicClient({ chain: sepolia, transport: http(env.eth.rpcUrl) });
    const reserve = (await pc.readContract({
      address: env.mev.pool as Address,
      abi: POOL_ABI,
      functionName: baseForQuote ? "reserveBase" : "reserveQuote",
    })) as bigint;
    const max = Number(formatUnits(reserve, 18)) / 4;
    if (size > max) {
      return bad(
        c,
        `amountIn ${size} is too large for this pool — keep it under ${max.toFixed(2)} ` +
          `(a quarter of the ${baseForQuote ? "mETH" : "mUSD"} reserve) so the trade stays meaningful`,
      );
    }
  } catch {
    // A read failure here should not block a duel; the swap's own slippage
    // guard is the real backstop.
  }

  if (running) return bad(c, "a duel is already running — they must not overlap", 409);

  const job = createJob("mev-duel", `${amountIn}@${slippageBps}bps`);
  const step = jobStep(job, `duel: ${amountIn} ${baseForQuote ? "mETH→mUSD" : "mUSD→mETH"} public vs private`);
  running = true;

  void (async () => {
    try {
      const result = await runDuel({ amountIn, slippageBps, baseForQuote });
      step.done({
        detail:
          `public $${(result.public?.shortfallUsd ?? 0).toFixed(2)} lost · ` +
          `private $${(result.private?.shortfallUsd ?? 0).toFixed(2)} lost · ` +
          `saved $${result.savedUsd.toFixed(2)}`,
        txHash: result.public?.transactionHash,
      });
      completeJob(job);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e).slice(0, 300);
      step.fail(msg);
      failJob(job, msg);
    } finally {
      running = false;
    }
  })();

  return c.json({ jobId: job.id, duelsUrl: "/mev/duels", note: "poll /jobs/:id for progress" });
});

mev.get("/mev/duels", (c) => {
  // `Number("abc")` is NaN and `Number("-1")` is negative; both reach
  // `slice(-limit)` and quietly return the wrong window rather than erroring —
  // `slice(NaN)` yields everything, `slice(1)` drops the newest duel. Clamp to a
  // sane integer instead of trusting the query string.
  const raw = Number(c.req.query("limit") ?? 25);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 200) : 25;
  return c.json({ duels: listDuels(limit) });
});

mev.get("/mev/duels/:id", (c) => {
  const d = getDuel(c.req.param("id"));
  if (!d) return bad(c, "duel not found", 404);
  return c.json(d);
});

/**
 * Server-sent stream of the live mempool observation.
 *
 * The point of exposing this is falsifiability: the same feed the attacker acts
 * on, shown to whoever is watching. A private-lane transaction that never
 * appears here, while hundreds of unrelated ones do, is evidence — an empty
 * feed would just be a broken socket.
 */
mev.get("/mev/stream", (c) => {
  return c.newResponse(
    new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        const send = (e: FeedEvent | { type: "hello"; [k: string]: unknown }) =>
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));

        send({ type: "hello", ...observerStatus() });
        const unsubscribe = subscribe(send);
        // Comment frames keep proxies from closing an idle connection, and tell
        // the client the socket is alive during a quiet stretch of mempool.
        const keepAlive = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), 15_000);

        c.req.raw.signal.addEventListener("abort", () => {
          clearInterval(keepAlive);
          unsubscribe();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });
      },
    }),
    {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    },
  );
});

/**
 * The autonomous agent's recent runs, each audited by our own observer.
 *
 * `seenInMempool: null` means the observer was not connected when that swap was
 * mined. Reported as unknown rather than folded into the "never public" count —
 * not looking is not the same as looking and seeing nothing.
 */
mev.get("/mev/agent", async (c) => {
  if (!env.keeperhub.scheduledWorkflowId) {
    return c.json({
      configured: false,
      reason: "KEEPERHUB_SCHEDULED_WORKFLOW_ID not set — run scripts/mev-schedule.ts",
      runs: [],
    });
  }
  try {
    const runs = await agentRuns(10);
    const judged = runs.filter((r) => r.seenInMempool !== null);
    return c.json({
      configured: true,
      workflowId: env.keeperhub.scheduledWorkflowId,
      runs,
      audited: judged.length,
      everSeenInMempool: judged.filter((r) => r.seenInMempool).length,
    });
  } catch (e) {
    return bad(c, `could not read agent runs: ${String(e).slice(0, 180)}`, 502);
  }
});

/** Observer health, for the UI to show whether the feed is genuinely live. */
mev.get("/mev/observer", (c) => c.json(observerStatus()));

/** The headline number. Computed only from persisted duels. */
mev.get("/mev/leaderboard", (c) => c.json(leaderboard()));
