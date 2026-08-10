/**
 * Wire on-chain PnL settlement, and hand the keys to KeeperHub.
 *
 * The perps compute PnL off-chain — that is what a private matching engine is
 * for. But an off-chain number is only the operator's word until it lands in
 * the vault, and `DorrVault.applyPnl` is deliberately gated: only the address
 * set as `settlement` can move balances, and even then the deltas must sum to
 * zero. The operator is not that address. KeeperHub is.
 *
 * So the operator can decide what you are owed and cannot pay it to you. It has
 * to ask KeeperHub, which executes the settlement on chain through private
 * routing — so a batch does not broadcast who closed what before it lands.
 *
 * This script does the one-time wiring:
 *   1. mint the insurance fund's capital (mUSD's faucet is permissionless)
 *   2. have KeeperHub's wallet approve and deposit it — signed by KeeperHub,
 *      because the fund is the counterparty of record, not ours
 *   3. point the vault's `settlement` at KeeperHub's wallet
 *
 *   bun run src/scripts/provision-settlement.ts [fundAmount]
 */
import { createPublicClient, createWalletClient, formatUnits, http, parseUnits, getAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { env } from "../env.js";
import { collateralInfo } from "../chain.js";
import { runOnKeeperHub } from "../settlement.js";

const ERC20_ABI = [
  { inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], name: "mint", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "a", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

const VAULT_ABI = [
  { inputs: [{ name: "s", type: "address" }], name: "setSettlement", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [], name: "settlement", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "t", type: "address" }], name: "accountOf", outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

async function main() {
  const fundHuman = process.argv[2] ?? "50000";
  const keeper = getAddress(env.keeperhub.orgWallet) as Address;
  const vault = getAddress(env.perps.vault) as Address;

  const account = privateKeyToAccount(
    (env.eth.deployerKey.startsWith("0x") ? env.eth.deployerKey : `0x${env.eth.deployerKey}`) as `0x${string}`,
  );
  const pc = createPublicClient({ chain: sepolia, transport: http(env.eth.rpcUrl) });
  const wc = createWalletClient({ account, chain: sepolia, transport: http(env.eth.rpcUrl) });

  const { address: token, decimals, symbol } = await collateralInfo();
  const fund = parseUnits(fundHuman, decimals);

  console.log(`vault    ${vault}`);
  console.log(`keeper   ${keeper}  ← will be the settlement address and the insurance fund`);
  console.log(`token    ${token} (${symbol})\n`);

  // 1 ─ capitalise. The faucet is permissionless, so we can fund KeeperHub's
  //     wallet without holding its key.
  const held = (await pc.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [keeper] })) as bigint;
  if (held < fund) {
    const h = await wc.writeContract({ address: token, abi: ERC20_ABI, functionName: "mint", args: [keeper, fund - held] });
    await pc.waitForTransactionReceipt({ hash: h });
    console.log(`minted   ${formatUnits(fund - held, decimals)} ${symbol} → keeper   ${env.eth.explorer}/tx/${h}`);
  } else {
    console.log(`keeper already holds ${formatUnits(held, decimals)} ${symbol}`);
  }

  // 2 ─ KeeperHub signs its own approve + deposit. We cannot do this for it,
  //     which is the point: the fund is its capital, in its custody.
  const [beforeBal] = (await pc.readContract({ address: vault, abi: VAULT_ABI, functionName: "accountOf", args: [keeper] })) as readonly [bigint, bigint, bigint];
  if (beforeBal < fund) {
    console.log(`\nasking KeeperHub to approve + deposit ${fundHuman} ${symbol}…`);
    // Two separate executions, not two nodes in one workflow: `deposit` calls
    // `transferFrom`, so it reverts unless the approve is already mined. A
    // single workflow fires its nodes back to back and does not wait.
    const approve = await runOnKeeperHub({
      name: "dorr — approve the vault",
      description: "KeeperHub approves DorrVault to pull the insurance fund's capital",
      steps: [
        {
          label: "Approve vault",
          contractAddress: token,
          abi: [{ type: "function", name: "approve", inputs: [{ name: "spender", type: "address", internalType: "address" }, { name: "amount", type: "uint256", internalType: "uint256" }], outputs: [{ name: "", type: "bool", internalType: "bool" }], stateMutability: "nonpayable" }],
          abiFunction: "approve",
          args: [vault, fund.toString()],
        },
      ],
    });
    console.log(`  approve  ${approve.status}` + (approve.transactions[0] ? `  ${env.eth.explorer}/tx/${approve.transactions[0].hash}` : ""));
    if (approve.error) console.log(`  error: ${approve.error}`);
    if (approve.transactions[0]) {
      await pc.waitForTransactionReceipt({ hash: approve.transactions[0].hash });
    }

    const res = await runOnKeeperHub({
      name: "dorr — fund the insurance vault",
      description: "KeeperHub deposits the insurance fund's own capital into DorrVault",
      steps: [
        {
          label: "Deposit into vault",
          contractAddress: vault,
          abi: [{ type: "function", name: "deposit", inputs: [{ name: "amount", type: "uint256", internalType: "uint256" }], outputs: [], stateMutability: "nonpayable" }],
          abiFunction: "deposit",
          args: [fund.toString()],
        },
      ],
    });
    console.log(`  deposit  ${res.status}` + (res.transactions[0] ? `  ${env.eth.explorer}/tx/${res.transactions[0].hash}` : ""));
    if (res.error) console.log(`  error: ${res.error}`);
  } else {
    console.log(`keeper already has ${formatUnits(beforeBal, decimals)} ${symbol} in the vault`);
  }

  // 3 ─ hand over settlement authority.
  const current = (await pc.readContract({ address: vault, abi: VAULT_ABI, functionName: "settlement" })) as Address;
  if (current.toLowerCase() !== keeper.toLowerCase()) {
    const h = await wc.writeContract({ address: vault, abi: VAULT_ABI, functionName: "setSettlement", args: [keeper] });
    await pc.waitForTransactionReceipt({ hash: h });
    console.log(`\nsettlement → keeper   ${env.eth.explorer}/tx/${h}`);
  } else {
    console.log(`\nsettlement already points at the keeper`);
  }

  const [after] = (await pc.readContract({ address: vault, abi: VAULT_ABI, functionName: "accountOf", args: [keeper] })) as readonly [bigint, bigint, bigint];
  console.log(`\ninsurance fund in vault: ${formatUnits(after, decimals)} ${symbol}`);
  console.log(`settlement address:      ${(await pc.readContract({ address: vault, abi: VAULT_ABI, functionName: "settlement" })) as Address}`);
  console.log(`\nthe operator can now compute PnL but not pay it — only KeeperHub can`);
}

main().catch((e) => {
  console.error("✗", e?.message ?? e);
  process.exit(1);
});
