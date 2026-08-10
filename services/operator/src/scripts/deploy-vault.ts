// Deploy the margin vault to Sepolia, collateralised in mUSD.
//
// Non-custodial by construction: collateral leaves only via the depositor's own
// withdraw(). The operator can lock margin against a position but can never
// move someone else's tokens out.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, formatEther, http, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { DORR_ROOT, env } from "../env.js";

const artifact = JSON.parse(
  readFileSync(resolve(DORR_ROOT, "contracts/out/DorrVault.sol/DorrVault.json"), "utf8"),
) as { abi: Abi; bytecode: { object: Hex } };

const account = privateKeyToAccount(env.eth.deployerKey as Hex);
const pc = createPublicClient({ chain: sepolia, transport: http(env.eth.rpcUrl) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(env.eth.rpcUrl) });

const collateral = env.mev.quoteToken as Address; // mUSD, 18dp
if (!collateral) throw new Error("MEV_QUOTE_TOKEN not set — deploy the lab first");

console.log("deployer :", account.address, formatEther(await pc.getBalance({ address: account.address })), "ETH");
console.log("collateral:", collateral, "(mUSD)");

const hash = await wallet.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [collateral, account.address],
  account,
  chain: sepolia,
});
const receipt = await pc.waitForTransactionReceipt({ hash, timeout: 180_000 });
console.log("\n✓ vault deployed:", receipt.contractAddress);
console.log("  tx:", `${env.eth.explorer}/tx/${hash}`);
console.log(`\nDORR_VAULT_ADDRESS="${receipt.contractAddress}"`);
process.exit(0);
