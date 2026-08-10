// Create or refresh the autonomous private-swap agent on KeeperHub, then show
// its recent runs with the observer's privacy verdict for each.
//
//   bun run src/scripts/mev-schedule.ts [cron] [amountIn] [slippageBps]
//   bun run src/scripts/mev-schedule.ts "0 * * * *" 2 100
//
// Prints the workflow id to put in KEEPERHUB_SCHEDULED_WORKFLOW_ID.
import { agentRuns, ensureScheduledDuel } from "../mev/scheduled-duel.js";

const [cron, amountIn, slippageBps] = process.argv.slice(2);

const r = await ensureScheduledDuel({
  cron: cron || undefined,
  amountIn: amountIn || undefined,
  slippageBps: slippageBps ? Number(slippageBps) : undefined,
});

console.log("═".repeat(68));
console.log("MEV Shield — autonomous private-swap agent");
console.log("═".repeat(68));
console.log(`workflow  ${r.workflowId}`);
console.log(`schedule  ${r.cron} (UTC)`);
console.log(`trade     ${r.amountIn} mETH → mUSD, routed privately`);
console.log(`valid     ${r.valid}${r.warnings.length ? ` · warnings: ${r.warnings.join("; ")}` : ""}`);
console.log(`enabled   ${r.enabled}`);

const runs = await agentRuns(5);
if (runs.length) {
  console.log("\nrecent runs (privacy audited by our own observer):");
  for (const x of runs) {
    const verdict =
      x.seenInMempool === null
        ? "unobserved (operator wasn't watching)"
        : x.seenInMempool
          ? "SEEN IN MEMPOOL"
          : "never public";
    console.log(`  ${x.startedAt ?? "?"}  ${x.status.padEnd(9)} ${verdict}${x.transactionHash ? `  ${x.transactionHash.slice(0, 18)}…` : ""}`);
  }
} else {
  console.log("\nno runs yet — the schedule fires on its own from here.");
}
console.log(`\nKEEPERHUB_SCHEDULED_WORKFLOW_ID="${r.workflowId}"`);

// The observer holds an open socket when it is used; exit explicitly.
process.exit(0);
