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
import { runDuel, type DuelStage } from "./duel.js";
import * as kh from "./keeperhub.js";
import { getDuel, leaderboard, listDuels } from "./store.js";
import { observerStatus, subscribe, type FeedEvent } from "./observer.js";
import { agentRuns } from "./scheduled-duel.js";
import { extractionCurve } from "./extraction.js";

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
let runningSince: string | null = null;
let runningJobId: string | null = null;

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
      /**
       * When the in-flight duel started, so a client that reloads mid-run shows
       * the real elapsed time instead of restarting its own stopwatch. A timer
       * that resets on refresh reads as "13 seconds in" when the duel is four
       * minutes old — a small lie, in a page whose whole argument is that its
       * numbers are not.
       */
      duelStartedAt: runningSince,
      /**
       * The in-flight duel's job id, so a tab that reloads mid-run can
       * re-attach to the stage list. Without it a reload keeps the elapsed
       * clock but loses every stage, leaving a timer ticking against no
       * explanation of what it is waiting for.
       */
      duelJobId: runningJobId,
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
  runningSince = new Date().toISOString();
  runningJobId = job.id;
  const pair = baseForQuote ? "mETH→mUSD" : "mUSD→mETH";
  const step = jobStep(job, `duel: ${amountIn} ${pair} public vs private`);
  running = true;

  /**
   * One job step per stage, so the UI can say which lane is where.
   *
   * A duel is minutes of wall clock — two lanes across several blocks, and
   * private routing waits for inclusion rather than broadcasting. Reported as a
   * single step it is indistinguishable from a hang, which is exactly where
   * someone evaluating this gives up and closes the tab.
   */
  const STAGE_LABELS: Record<DuelStage, string> = {
    preparing: "preparing the trading wallet",
    "public-submitting": "public lane — submitting, visible in the mempool",
    "public-landed": "public lane — landed",
    "private-submitting": "private lane — offered to builders, never broadcast",
    "private-landed": "private lane — landed",
    measuring: "measuring both lanes",
  };
  let open: { step: ReturnType<typeof jobStep>; detail?: string } | undefined;
  const closeOpen = () => {
    open?.step.done(open.detail ? { detail: open.detail } : undefined);
    open = undefined;
  };

  void (async () => {
    try {
      const result = await runDuel({
        amountIn,
        slippageBps,
        baseForQuote,
        onStage: (stage, detail) => {
          // Exactly one row pulses at a time: the arriving stage's detail
          // describes the one that just finished, so it closes that row and
          // opens the next.
          if (detail && open) {
            open.detail = detail;
            closeOpen();
            return;
          }
          closeOpen();
          open = { step: jobStep(job, STAGE_LABELS[stage]) };
        },
      });
      closeOpen();
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
      open?.step.fail(msg);
      open = undefined;
      step.fail(msg);
      failJob(job, msg);
    } finally {
      running = false;
      runningSince = null;
      runningJobId = null;
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

/**
 * What each slippage tolerance is worth to an attacker, priced against the pool
 * as it stands right now. Read-only, instant, no gas — see extraction.ts.
 */
mev.get("/mev/extraction", async (c) => {
  if (!env.mev.pool) return bad(c, "MEV lab not deployed", 400);
  const amountIn = (c.req.query("amountIn") ?? "10").trim();
  const size = Number(amountIn);
  if (!Number.isFinite(size) || size <= 0) {
    return bad(c, "amountIn must be a positive number of tokens");
  }
  // `Number()` happily parses "1e99" and "0x10"; `parseUnits` does not, and its
  // rejection surfaced as a 502 with a raw library error in it. Require the
  // plain-decimal form the token amount actually has to be, and bound it —
  // nobody can swap more tokens than exist.
  if (!/^\d+(\.\d+)?$/.test(amountIn)) {
    return bad(c, "amountIn must be a plain decimal, e.g. 10 or 2.5");
  }
  if (size > 1_000_000) {
    return bad(c, "amountIn is larger than the pool could ever quote — try 1000 or less");
  }
  try {
    return c.json(await extractionCurve(amountIn));
  } catch (e) {
    return bad(c, `could not price the curve: ${String(e).slice(0, 180)}`, 502);
  }
});

/** The headline number. Computed only from persisted duels. */
mev.get("/mev/leaderboard", (c) => c.json(leaderboard()));
