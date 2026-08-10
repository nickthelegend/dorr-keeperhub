/**
 * Stand up the MEV Shield lab on Sepolia.
 *
 * Deploys the two faucet tokens and the pool, seeds liquidity, and funds the
 * searcher EOA with ETH for gas and inventory to attack with. Idempotent: if
 * MEV_POOL is already set and live, it verifies and tops up rather than
 * redeploying.
 *
 * The searcher is funded from the deployer here purely for convenience. It is
 * still a genuinely independent actor at runtime — its own key, its own nonce
 * sequence, paying its own gas, racing us for block position.
 *
 *   bun run src/scripts/mev-deploy.ts
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  formatUnits,
  http,
  parseEther,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { DORR_ROOT, env } from "../env.js";
import { POOL_ABI, POOL_BYTECODE, TOKEN_ABI, TOKEN_BYTECODE } from "../mev/artifacts.js";
import * as kh from "../mev/keeperhub.js";

const ENV_PATH = resolve(DORR_ROOT, ".env");

/** Pool depth: 1,000 mETH against 2,000,000 mUSD -> a $2,000 mid price. */
const POOL_BASE = parseUnits("1000", 18);
const POOL_QUOTE = parseUnits("2000000", 18);
/** Inventory the searcher needs to be able to front-run with. */
const SEARCHER_BASE = parseUnits("500", 18);
const SEARCHER_QUOTE = parseUnits("1000000", 18);
/** Sepolia gas is ~1 gwei; this covers hundreds of sandwiches. */
const SEARCHER_ETH = parseEther("0.01");

function upsertEnv(updates: Record<string, string>): void {
  let text = "";
  try {
    text = readFileSync(ENV_PATH, "utf8");
  } catch {
    /* first write */
  }
  for (const [k, v] of Object.entries(updates)) {
    const line = `${k}="${v}"`;
    const re = new RegExp(`^${k}=.*$`, "m");
    if (re.test(text)) text = text.replace(re, line);
    else text += (text.endsWith("\n") || text === "" ? "" : "\n") + line + "\n";
  }
  writeFileSync(ENV_PATH, text);
}

async function main() {
  console.log("═".repeat(70));
  console.log("MEV Shield — deploy the lab to Sepolia");
  console.log("═".repeat(70));

  if (!env.eth.deployerKey) throw new Error("ETH_DEPLOYER_KEY missing");
  const deployer = privateKeyToAccount(env.eth.deployerKey as Hex);
  const pc = createPublicClient({ chain: sepolia, transport: http(env.eth.rpcUrl) });
  const wallet = createWalletClient({ account: deployer, chain: sepolia, transport: http(env.eth.rpcUrl) });

  const balance = await pc.getBalance({ address: deployer.address });
  console.log(`deployer ${deployer.address}  ${formatEther(balance)} ETH`);
  if (balance < parseEther("0.015")) {
    throw new Error(
      `deployer needs ~0.02 Sepolia ETH to deploy the lab and fund the searcher (has ${formatEther(balance)}). ` +
        `Fund ${deployer.address} from a Sepolia faucet and re-run.`,
    );
  }

  // ─── searcher key ───────────────────────────────────────────────────────
  let searcherKey = env.mev.searcherKey as Hex;
  if (!searcherKey) {
    searcherKey = generatePrivateKey();
    console.log("\n[0] generated a fresh searcher key (the adversary)");
  }
  const searcher = privateKeyToAccount(searcherKey);
  console.log(`searcher ${searcher.address}`);

  // ─── tokens ─────────────────────────────────────────────────────────────
  const deployed: Record<string, string> = {};

  async function deploy(name: string, args: unknown[], abi: typeof TOKEN_ABI, bytecode: Hex): Promise<Address> {
    const hash = await wallet.deployContract({ abi, bytecode, args, account: deployer, chain: sepolia });
    const receipt = await pc.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (!receipt.contractAddress) throw new Error(`${name} deployment produced no address`);
    console.log(`   ${name.padEnd(8)} ${receipt.contractAddress}  (${env.eth.explorer}/tx/${hash})`);
    return receipt.contractAddress;
  }

  console.log("\n[1] deploy tokens");
  const baseToken =
    (env.mev.baseToken as Address) ||
    (await deploy("mETH", ["MEV Shield ETH", "mETH", 18], TOKEN_ABI, TOKEN_BYTECODE));
  const quoteToken =
    (env.mev.quoteToken as Address) ||
    (await deploy("mUSD", ["MEV Shield USD", "mUSD", 18], TOKEN_ABI, TOKEN_BYTECODE));
  deployed.MEV_BASE_TOKEN = baseToken;
  deployed.MEV_QUOTE_TOKEN = quoteToken;

  console.log("\n[2] deploy pool");
  const pool =
    (env.mev.pool as Address) ||
    (await deploy("pool", [baseToken, quoteToken], POOL_ABI as typeof TOKEN_ABI, POOL_BYTECODE));
  deployed.MEV_POOL = pool;

  // ─── liquidity ──────────────────────────────────────────────────────────
  console.log("\n[3] seed liquidity");
  const reserveBase = (await pc.readContract({ address: pool, abi: POOL_ABI, functionName: "reserveBase" })) as bigint;
  if (reserveBase === 0n) {
    for (const [token, amount] of [
      [baseToken, POOL_BASE],
      [quoteToken, POOL_QUOTE],
    ] as const) {
      const h = await wallet.writeContract({
        address: token, abi: TOKEN_ABI, functionName: "mint",
        args: [deployer.address, amount], account: deployer, chain: sepolia,
      });
      await pc.waitForTransactionReceipt({ hash: h });
      const a = await wallet.writeContract({
        address: token, abi: TOKEN_ABI, functionName: "approve",
        args: [pool, amount], account: deployer, chain: sepolia,
      });
      await pc.waitForTransactionReceipt({ hash: a });
    }
    const h = await wallet.writeContract({
      address: pool, abi: POOL_ABI, functionName: "addLiquidity",
      args: [POOL_BASE, POOL_QUOTE], account: deployer, chain: sepolia,
    });
    const r = await pc.waitForTransactionReceipt({ hash: h });
    console.log(`   seeded 1,000 mETH / 2,000,000 mUSD  (${env.eth.explorer}/tx/${r.transactionHash})`);
  } else {
    console.log(`   already seeded: ${formatUnits(reserveBase, 18)} mETH`);
  }
  const mid = (await pc.readContract({ address: pool, abi: POOL_ABI, functionName: "midPrice" })) as bigint;
  console.log(`   mid price: $${Number(formatUnits(mid, 18)).toFixed(2)} per mETH`);

  // ─── arm the adversary ──────────────────────────────────────────────────
  console.log("\n[4] fund and arm the searcher");
  const searcherEth = await pc.getBalance({ address: searcher.address });
  if (searcherEth < SEARCHER_ETH / 2n) {
    const h = await wallet.sendTransaction({
      to: searcher.address, value: SEARCHER_ETH, account: deployer, chain: sepolia,
    });
    await pc.waitForTransactionReceipt({ hash: h });
    console.log(`   sent ${formatEther(SEARCHER_ETH)} ETH for gas`);
  } else {
    console.log(`   has ${formatEther(searcherEth)} ETH`);
  }

  // Inventory: minted straight to the searcher via the open faucet.
  for (const [token, amount, label] of [
    [baseToken, SEARCHER_BASE, "mETH"],
    [quoteToken, SEARCHER_QUOTE, "mUSD"],
  ] as const) {
    const held = (await pc.readContract({
      address: token, abi: TOKEN_ABI, functionName: "balanceOf", args: [searcher.address],
    })) as bigint;
    if (held < amount / 2n) {
      const h = await wallet.writeContract({
        address: token, abi: TOKEN_ABI, functionName: "mint",
        args: [searcher.address, amount], account: deployer, chain: sepolia,
      });
      await pc.waitForTransactionReceipt({ hash: h });
      console.log(`   minted ${formatUnits(amount, 18)} ${label} of attack inventory`);
    }
  }

  // The searcher approves the pool itself — it is its own agent.
  const searcherWallet = createWalletClient({ account: searcher, chain: sepolia, transport: http(env.eth.rpcUrl) });
  for (const [token, label] of [[baseToken, "mETH"], [quoteToken, "mUSD"]] as const) {
    const allowance = (await pc.readContract({
      address: token, abi: TOKEN_ABI, functionName: "allowance", args: [searcher.address, pool],
    })) as bigint;
    if (allowance < SEARCHER_QUOTE) {
      const h = await searcherWallet.writeContract({
        address: token, abi: TOKEN_ABI, functionName: "approve",
        args: [pool, (1n << 255n) - 1n], account: searcher, chain: sepolia,
      });
      await pc.waitForTransactionReceipt({ hash: h });
      console.log(`   searcher approved the pool for ${label}`);
    }
  }

  // ─── persist ────────────────────────────────────────────────────────────
  deployed.MEV_SEARCHER_KEY = searcherKey;
  deployed.MEV_SEARCHER_ADDRESS = searcher.address;
  upsertEnv(deployed);

  console.log("\n" + "═".repeat(70));
  console.log("✓ LAB READY");
  console.log(`  pool     ${pool}`);
  console.log(`  base     ${baseToken} (mETH)`);
  console.log(`  quote    ${quoteToken} (mUSD, 1 mUSD := $1)`);
  console.log(`  searcher ${searcher.address}`);
  if (kh.isConfigured()) {
    const w = await kh.orgWallet().catch(() => undefined);
    console.log(`  trader   ${w ?? "?"} (KeeperHub, gas sponsored)`);
  }
  console.log("\nnext: bun run src/scripts/mev-duel.ts");
}

main().catch((e) => {
  console.error("\n✗ deploy failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
