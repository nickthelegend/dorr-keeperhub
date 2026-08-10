import { config as dotenv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const _here = dirname(fileURLToPath(import.meta.url));
/** Monorepo root (dorr/). */
export const DORR_ROOT = resolve(_here, "../../..");
dotenv({ path: resolve(DORR_ROOT, ".env") });

export const env = {
  port: Number(process.env.OPERATOR_PORT || 8790),
  /** When true, commit/execute/close require a valid EIP-191 wallet signature. */
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
  keeperhub: {
    apiKey: process.env.KEEPERHUB_API_KEY || "",
    baseUrl: process.env.KEEPERHUB_BASE_URL || "https://app.keeperhub.com",
    /** Wallet KeeperHub executes from (distinct from the SIWE signer). */
    orgWallet: process.env.KEEPERHUB_ORG_WALLET || "",
    /** `wfb_*` key — the only credential that can fire a workflow webhook. */
    webhookKey: process.env.KEEPERHUB_WEBHOOK_KEY || "",
    /** Workflow whose write node carries usePrivateMempool. */
    privateWorkflowId: process.env.KEEPERHUB_PRIVATE_WORKFLOW_ID || "",
    /** Schedule-triggered workflow that runs duels unattended. */
    scheduledWorkflowId: process.env.KEEPERHUB_SCHEDULED_WORKFLOW_ID || "",
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
  flare: {
    rpcUrl: process.env.FLARE_RPC_URL || "https://coston2-api.flare.network/ext/C/rpc",
    chainId: Number(process.env.FLARE_CHAIN_ID || 114),
    explorer: process.env.FLARE_EXPLORER || "https://coston2-explorer.flare.network",
    pollMs: Number(process.env.FLARE_POLL_MS || 3000),
    /** FAssets FXRP (Coston2 FTestXRP, 6dp) — resolve via AssetManagerFXRP.fAsset() */
    fxrp: process.env.FXRP_ADDRESS || "0x0b6A3645c240605887a5532109323A3E12273dc7",
    vault: process.env.DORR_VAULT_ADDRESS || "",
    settlement: process.env.DORR_SETTLEMENT_ADDRESS || "",
    teeVerifier: process.env.DORR_TEE_VERIFIER_ADDRESS || "",
    /** Enclave signing key + identity for batch attestations. */
    teeKey: process.env.TEE_ENCLAVE_KEY || "",
    teeId: process.env.TEE_ID || "",
    teeMeasurement: process.env.TEE_MEASUREMENT || "",
    /** Relayer that submits settlement txs (pays gas). */
    relayerKey: process.env.FLARE_RELAYER_KEY || "",
  },
};
