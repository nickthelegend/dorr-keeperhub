import { config as dotenv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const _here = dirname(fileURLToPath(import.meta.url));
/** Monorepo root (dorr/). */
export const DORR_ROOT = resolve(_here, "../../..");
dotenv({ path: resolve(DORR_ROOT, ".env") });

export const env = {
  port: Number(process.env.OPERATOR_PORT || 8790),
  /** When true, value-moving actions require a valid EIP-191 wallet signature. */
  authRequired: process.env.DORR_AUTH === "1" || process.env.DORR_AUTH === "required",
  eth: {
    network: process.env.ETH_NETWORK || "sepolia",
    chainId: Number(process.env.ETH_CHAIN_ID || 11155111),
    rpcUrl: process.env.ETH_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
    explorer: process.env.ETH_EXPLORER || "https://sepolia.etherscan.io",
    deployerAddress: process.env.ETH_DEPLOYER_ADDRESS || "",
    deployerKey: process.env.ETH_DEPLOYER_KEY || "",
    /** WebSocket endpoint — required for mempool subscription, not just RPC. */
    wsUrl: process.env.ETH_WS_URL || "wss://ethereum-sepolia-rpc.publicnode.com",
  },
  /** Perps settlement: DorrVault on Sepolia, collateralised in mUSD. */
  perps: {
    vault: process.env.DORR_VAULT_ADDRESS || "",
    /** Account the UI follows read-only when no wallet is connected. */
    spectator: process.env.DORR_SPECTATOR_ADDRESS || "",
  },
  /** Chainlink price polling on Sepolia. */
  oracle: {
    pollMs: Number(process.env.ORACLE_POLL_MS || 15_000),
  },
  keeperhub: {
    apiKey: process.env.KEEPERHUB_API_KEY || "",
    baseUrl: process.env.KEEPERHUB_BASE_URL || "https://app.keeperhub.com",
    /** Wallet KeeperHub executes from (distinct from the SIWE signer). */
    orgWallet: process.env.KEEPERHUB_ORG_WALLET || "",
    /** The web3 integration that signs write nodes. GET /api/integrations. */
    integrationId: process.env.KEEPERHUB_INTEGRATION_ID || "",
    /** Workflow whose write node carries usePrivateMempool. */
    privateWorkflowId: process.env.KEEPERHUB_PRIVATE_WORKFLOW_ID || "",
    /** Schedule-triggered workflow that runs duels unattended. */
    scheduledWorkflowId: process.env.KEEPERHUB_SCHEDULED_WORKFLOW_ID || "",
    /** Cron for that agent (UTC), and the size it swaps each run. */
    scheduledCron: process.env.KEEPERHUB_SCHEDULED_CRON || "*/15 * * * *",
    scheduledAmountIn: process.env.KEEPERHUB_SCHEDULED_AMOUNT_IN || "2",
    /** Workflow that applies the perps' PnL batches to the vault. */
    settlementWorkflowId: process.env.DORR_SETTLEMENT_WORKFLOW_ID || "",
  },
  /** MEV Shield lab — the sandwichable venue and the adversary that hunts it. */
  mev: {
    baseToken: process.env.MEV_BASE_TOKEN || "",
    quoteToken: process.env.MEV_QUOTE_TOKEN || "",
    pool: process.env.MEV_POOL || "",
    /** Searcher EOA. Its own funds, its own gas — it is the adversary, not us. */
    searcherKey: process.env.MEV_SEARCHER_KEY || "",
    searcherAddress: process.env.MEV_SEARCHER_ADDRESS || "",
    /** Publicly reachable operator base URL, so KeeperHub's scheduler can call in. */
    publicUrl: process.env.MEV_PUBLIC_URL || "",
    /** Priority fee multiplier the searcher bids to win the front-run slot. */
    searcherPriorityMultiple: Number(process.env.MEV_SEARCHER_PRIORITY_MULTIPLE || 25),
  },
};
