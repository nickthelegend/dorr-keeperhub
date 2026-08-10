/**
 * Run one MEV Shield duel and print the verdict.
 *
 *   bun run src/scripts/mev-duel.ts [amountIn] [slippageBps]
 *
 * Reports what happened, including when it is unflattering: a lost race, an
 * ignored privacy flag, or a public lane the observer simply missed are all
 * printed as such rather than smoothed into a nicer number.
 */
import { formatUnits } from "viem";
import { env } from "../env.js";
import { runDuel } from "../mev/duel.js";
import { leaderboard } from "../mev/store.js";

const usd = (n: number) => `$${n.toFixed(2)}`;
const tok = (s?: string) => (s ? Number(formatUnits(BigInt(s), 18)).toFixed(4) : "—");

async function main() {
  const amountIn = process.argv[2] || "10";
  const slippageBps = Number(process.argv[3] || 100);

  console.log("═".repeat(70));
  console.log("MEV SHIELD — the private lane, measured");
  console.log("═".repeat(70));
  console.log(`trade:    sell ${amountIn} mETH for mUSD`);
  console.log(`slippage: ${slippageBps} bps (this is the attacker's budget)`);
  console.log(`pool:     ${env.mev.pool}`);
  console.log("\nrunning both lanes — this takes a few Sepolia blocks…\n");

  const d = await runDuel({ amountIn, slippageBps });

  for (const lane of [d.public, d.private]) {
    if (!lane) continue;
    const title = lane.lane === "public" ? "PUBLIC MEMPOOL" : "PRIVATE LANE (KeeperHub)";
    console.log("─".repeat(70));
    console.log(title);
    if (lane.error) {
      console.log(`  ✗ ${lane.error}`);
      continue;
    }
    console.log(`  quoted            ${tok(lane.quotedOut)} mUSD`);
    console.log(`  actually received ${tok(lane.actualOut)} mUSD`);
    console.log(`  shortfall         ${usd(lane.shortfallUsd)}`);
    console.log(`  seen in mempool   ${lane.seenInMempool ? "YES — exposed to searchers" : "NO — never public before inclusion"}`);
    if (lane.mempoolExposureMs !== undefined) {
      console.log(`  exposure window   ${(lane.mempoolExposureMs / 1000).toFixed(1)}s`);
    }
    if (lane.sandwich) {
      console.log(
        `  sandwich          ${lane.sandwich.landed ? "LANDED" : "attempted, did not land"}` +
          (lane.sandwich.error ? ` (${lane.sandwich.error})` : ""),
      );
      if (lane.sandwich.reactionMs) console.log(`  searcher reacted  ${lane.sandwich.reactionMs}ms after sighting`);
      if (lane.sandwich.frontRunHash) console.log(`  front-run         ${env.eth.explorer}/tx/${lane.sandwich.frontRunHash}`);
      if (lane.sandwich.backRunHash) console.log(`  back-run          ${env.eth.explorer}/tx/${lane.sandwich.backRunHash}`);
      if (lane.sandwich.searcherProfit) console.log(`  searcher profit   ${tok(lane.sandwich.searcherProfit)} mETH`);
    }
    if (lane.transactionLink) console.log(`  tx                ${lane.transactionLink}`);
  }

  console.log("═".repeat(70));
  console.log(`VERDICT: the public mempool cost this trade ${usd(d.public?.shortfallUsd ?? 0)}.`);
  console.log(`         the private lane cost it ${usd(d.private?.shortfallUsd ?? 0)}.`);
  console.log(`         saved: ${usd(d.savedUsd)}`);
  for (const n of d.notes ?? []) console.log(`  note: ${n}`);

  const lb = leaderboard();
  console.log("\nLEADERBOARD (all duels, persisted)");
  console.log(`  duels ${lb.duels} · sandwiches landed ${lb.sandwichesLanded}`);
  console.log(`  mempool exposure — public ${lb.publicSeenInMempool}/${lb.duels}, private ${lb.privateSeenInMempool}/${lb.duels}`);
  console.log(`  total lost to the public mempool ${usd(lb.totalLostUsd)}`);
  console.log(`  total saved by the private lane  ${usd(lb.totalSavedUsd)}`);
  console.log(`  observer saw ${d.observerSightings} pending txs during this duel`);
}

main().catch((e) => {
  console.error("\n✗ duel failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
