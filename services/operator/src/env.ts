import { config as dotenv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const _here = dirname(fileURLToPath(import.meta.url));
/** Monorepo root (dorr/). */
export const DORR_ROOT = resolve(_here, "../../..");
/** Vendored ZKPerps repo (npm-managed; Midnight CLI + Compact artifacts live here). */
export const ZKPERPS_ROOT = resolve(DORR_ROOT, "vendor/zkperps");

dotenv({ path: resolve(DORR_ROOT, ".env") });

// The engine's lucid_wallet/cardano_env read WALLET_MNEMONIC / CARDANO_* names.
// Map dorr's canonical names onto them so both stacks agree.
if (process.env.CARDANO_DEPLOYER_MNEMONIC && !process.env.WALLET_MNEMONIC) {
  process.env.WALLET_MNEMONIC = process.env.CARDANO_DEPLOYER_MNEMONIC;
}
if (process.env.MIDNIGHT_MNEMONIC && !process.env.BIP39_MNEMONIC) {
  process.env.BIP39_MNEMONIC = process.env.MIDNIGHT_MNEMONIC;
}

export const env = {
  port: Number(process.env.OPERATOR_PORT || 8790),
  /** When true, commit/execute/close/withdraw require a valid CIP-30 wallet signature. */
  authRequired: process.env.DORR_AUTH === "1" || process.env.DORR_AUTH === "required",
  cardano: {
    network: (process.env.CARDANO_NETWORK || "Preprod") as "Preprod" | "Preview" | "Mainnet",
    mnemonic: process.env.CARDANO_DEPLOYER_MNEMONIC || "",
    blockfrostProjectId: process.env.BLOCKFROST_PROJECT_ID || "",
    koiosUrl: process.env.KOIOS_URL || "https://preprod.koios.rest/api/v1",
  },
  midnight: {
    network: process.env.MIDNIGHT_DEPLOY_NETWORK || "undeployed",
    mnemonic: process.env.MIDNIGHT_MNEMONIC || "",
    indexerPort: process.env.INDEXER_PORT || "8088",
    nodePort: process.env.NODE_PORT || "9944",
    proofServerPort: process.env.PROOF_SERVER_PORT || "6300",
  },
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
  },
  /** MEV Shield lab — the sandwichable venue and the adversary that hunts it. */
  mev: {
    baseToken: process.env.MEV_BASE_TOKEN || "",
    quoteToken: process.env.MEV_QUOTE_TOKEN || "",
    pool: process.env.MEV_POOL || "",
    /** Searcher EOA. Its own funds, its own gas — it is the adversary, not us. */
    searcherKey: process.env.MEV_SEARCHER_KEY || "",
    searcherAddress: process.env.MEV_SEARCHER_ADDRESS || "",
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
