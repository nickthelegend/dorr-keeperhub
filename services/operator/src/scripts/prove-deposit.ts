/**
 * Prove the collateral path, on chain, end to end.
 *
 * Mints mUSD from the open faucet, approves the vault, deposits, then asks the
 * operator what the trader's balance is. If the operator's number does not move
 * to match the vault's, the two halves of the system are not actually joined
 * and this script fails — which is the point of running it.
 *
 *   bun run src/scripts/prove-deposit.ts [amount]
 */
import { createPublicClient, createWalletClient, formatUnits, http, parseUnits, getAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { env } from "../env.js";
import { collateralInfo, vaultSolvency } from "../chain.js";

const ERC20_ABI = [
  { inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], name: "mint", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], name: "allowance", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "a", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

const VAULT_ABI = [
  { inputs: [{ name: "amount", type: "uint256" }], name: "deposit", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "amount", type: "uint256" }], name: "withdraw", outputs: [], stateMutability: "nonpayable", type: "function" },
] as const;

interface AccountView {
  deposited: number;
  pnl: number;
  balance: number;
}

const acct = async (a: string): Promise<AccountView> =>
  (await (await fetch(`${OPERATOR}/account/${a}`)).json()) as AccountView;

const OPERATOR = `http://localhost:${env.port}`;

async function main() {
  const human = process.argv[2] ?? "500";
  if (!env.eth.deployerKey) throw new Error("ETH_DEPLOYER_KEY not set");

  const account = privateKeyToAccount(
    (env.eth.deployerKey.startsWith("0x") ? env.eth.deployerKey : `0x${env.eth.deployerKey}`) as `0x${string}`,
  );
  const pc = createPublicClient({ chain: sepolia, transport: http(env.eth.rpcUrl) });
  const wc = createWalletClient({ account, chain: sepolia, transport: http(env.eth.rpcUrl) });

  const { address: token, decimals, symbol } = await collateralInfo();
  const vault = getAddress(env.perps.vault) as Address;
  const amount = parseUnits(human, decimals);

  console.log(`trader   ${account.address}`);
  console.log(`vault    ${vault}`);
  console.log(`token    ${token} (${symbol}, ${decimals}dp)\n`);

  const before = await acct(account.address);
  console.log(`operator says, before: deposited ${before.deposited} ${symbol}`);

  const held = (await pc.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] })) as bigint;
  if (held < amount) {
    const need = amount - held;
    console.log(`\nminting ${formatUnits(need, decimals)} ${symbol} from the open faucet…`);
    const h = await wc.writeContract({ address: token, abi: ERC20_ABI, functionName: "mint", args: [account.address, need] });
    await pc.waitForTransactionReceipt({ hash: h });
    console.log(`  mint     ${env.eth.explorer}/tx/${h}`);
  }

  const allowance = (await pc.readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [account.address, vault] })) as bigint;
  if (allowance < amount) {
    const h = await wc.writeContract({ address: token, abi: ERC20_ABI, functionName: "approve", args: [vault, amount] });
    await pc.waitForTransactionReceipt({ hash: h });
    console.log(`  approve  ${env.eth.explorer}/tx/${h}`);
  }

  const dep = await wc.writeContract({ address: vault, abi: VAULT_ABI, functionName: "deposit", args: [amount] });
  const rcpt = await pc.waitForTransactionReceipt({ hash: dep });
  console.log(`  deposit  ${env.eth.explorer}/tx/${dep}  (block ${rcpt.blockNumber}, ${rcpt.status})`);

  // Bust the cache the way the UI does after a confirmed deposit.
  await fetch(`${OPERATOR}/chain/sync/${account.address}`, { method: "POST" });
  const after = await acct(account.address);
  const sol = await vaultSolvency();

  // This trader's own vault balance — NOT the vault's total. The insurance
  // fund is a depositor too, so `totalInternal` is everyone's collateral
  // added up, and comparing one trader against it was guaranteed to fail the
  // moment the fund was capitalised.
  const [onChainBalance] = (await pc.readContract({
    address: vault,
    abi: [{ type: "function", name: "accountOf", inputs: [{ name: "trader", type: "address", internalType: "address" }], outputs: [{ name: "balance", type: "uint256", internalType: "uint256" }, { name: "locked", type: "uint256", internalType: "uint256" }, { name: "free", type: "uint256", internalType: "uint256" }], stateMutability: "view" }],
    functionName: "accountOf",
    args: [account.address],
  })) as readonly [bigint, bigint, bigint];
  const traderOnChain = Number(formatUnits(onChainBalance, decimals));

  console.log(`\noperator says, after:   deposited ${after.deposited} ${symbol}`);
  console.log(`vault says, this trader: ${traderOnChain} ${symbol}`);
  console.log(`vault reserves (all):    ${sol.reserves} ${symbol}`);
  console.log(`vault liabilities (all): ${sol.liabilities} ${symbol}`);
  console.log(`solvent:                 ${sol.solvent}`);

  const moved = after.deposited - before.deposited;
  const expected = Number(formatUnits(amount, decimals));
  if (Math.abs(moved - expected) > 1e-9) {
    throw new Error(`operator credited ${moved}, chain moved ${expected} — the halves are not joined`);
  }
  if (Math.abs(after.deposited - traderOnChain) > 1e-9) {
    throw new Error(
      `operator says this trader has ${after.deposited}, the vault says ${traderOnChain}`,
    );
  }
  if (sol.reserves + 1e-9 < sol.liabilities) {
    throw new Error(`vault is undercollateralised: ${sol.reserves} backing ${sol.liabilities}`);
  }
  console.log(`\n✓ operator balance is the vault's number, not its own`);
}

main().catch((e) => {
  console.error("✗", e.message ?? e);
  process.exit(1);
});
