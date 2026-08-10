/**
 * The operator's HTTP surface.
 *
 * MEV Shield is the whole product now, so this file is thin: health, config,
 * job polling, and the `/mev/*` routes mounted from `mev/routes.ts`. The
 * perps-trading API that used to live here belonged to a Flare deployment and
 * went with it.
 */
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getJob } from "./jobs.js";
import { mev } from "./mev/routes.js";
import { env } from "./env.js";

export const app = new Hono();
app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Content-Type"] }));

// MEV Shield — duels, the live mempool feed, the agent, and the leaderboard.
app.route("/", mev);

const bad = (c: Context, msg: string, code: ContentfulStatusCode = 400) => c.json({ error: msg }, code);

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "mev-shield-operator",
    chain: env.eth.network,
    chainId: env.eth.chainId,
    now: new Date().toISOString(),
  }),
);

/** What this deployment actually talks to — no hardcoded stand-ins. */
app.get("/config", (c) =>
  c.json({
    chain: env.eth.network,
    chainId: env.eth.chainId,
    explorerBase: `${env.eth.explorer}/tx/`,
    relayer: "keeperhub",
    keeperhubBaseUrl: env.keeperhub.baseUrl,
    contracts: {
      pool: env.mev.pool || null,
      baseToken: env.mev.baseToken || null,
      quoteToken: env.mev.quoteToken || null,
    },
    wallets: {
      trader: env.keeperhub.orgWallet || null,
      searcher: env.mev.searcherAddress || null,
    },
  }),
);

app.get("/jobs/:id", (c) => {
  const job = getJob(c.req.param("id"));
  if (!job) return bad(c, "not found", 404);
  return c.json(job);
});
