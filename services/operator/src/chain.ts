/**
 * The settlement layer: `DorrVault` on Ethereum Sepolia.
 *
 * This replaces the Flare client the perps used to settle against. The vault is
 * the same contract, generalised from FXRP to any ERC-20, and it holds mUSD —
 * the same open-faucet token the MEV lab prices. One faucet, both subsystems,
 * so a judge who has collateral for one has collateral for the other.
 *
 * Three properties are read straight off the chain rather than tracked here,
 * because the operator asserting them would be worth nothing:
 *
 *   • `reserves()`   — mUSD actually sitting in the vault
 *   • `totalInternal()` — what the vault owes traders
 *   • `isSolvent()`  — the first covers the second
 *
 * If the operator ever books more liability than it holds collateral, the chain
 * says so and this endpoint reports it. Nothing here is cached.
 */
import { createPublicClient, formatUnits, http, getAddress, type Address } from "viem";
import { sepolia } from "viem/chains";
import { env } from "./env.js";

const ERC20_ABI = [
  { inputs: [{ name: "a", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "symbol", outputs: [{ type: "string" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "decimals", outputs: [{ type: "uint8" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "totalSupply", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

const VAULT_ABI = [
  { inputs: [{ name: "trader", type: "address" }], name: "accountOf", outputs: [{ name: "balance", type: "uint256" }, { name: "locked", type: "uint256" }, { name: "free", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "trader", type: "address" }], name: "freeBalanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "reserves", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "totalInternal", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "isSolvent", outputs: [{ type: "bool" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "collateral", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
] as const;

const pc = () => createPublicClient({ chain: sepolia, transport: http(env.eth.rpcUrl) });

export const vaultConfigured = (): boolean => Boolean(env.perps.vault);

const vaultAddress = (): Address => {
  if (!env.perps.vault) throw new Error("DORR_VAULT_ADDRESS not set");
  return getAddress(env.perps.vault) as Address;
};

export const explorerAddress = (a: string) => `${env.eth.explorer}/address/${a}`;
export const explorerTx = (h: string) => `${env.eth.explorer}/tx/${h}`;

/** The collateral token, as the vault itself reports it. */
export async function collateralInfo(): Promise<{
  address: Address;
  symbol: string;
  decimals: number;
  totalSupply: string;
}> {
  const client = pc();
  const token = (await client.readContract({
    address: vaultAddress(),
    abi: VAULT_ABI,
    functionName: "collateral",
  })) as Address;

  const [symbol, decimals, totalSupply] = await Promise.all([
    client.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }) as Promise<string>,
    client.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }) as Promise<number>,
    client.readContract({ address: token, abi: ERC20_ABI, functionName: "totalSupply" }) as Promise<bigint>,
  ]);

  return {
    address: getAddress(token) as Address,
    symbol,
    decimals: Number(decimals),
    totalSupply: formatUnits(totalSupply, Number(decimals)),
  };
}

/**
 * Solvency, straight from the vault.
 *
 * `reserves` is the token balance the vault actually holds; `liabilities` is
 * what it has credited to traders internally. The operator does not get a say.
 */
export async function vaultSolvency(): Promise<{
  vaultAddress: Address;
  solvent: boolean;
  reserves: number;
  liabilities: number;
  decimals: number;
}> {
  const client = pc();
  const vault = vaultAddress();
  const { decimals } = await collateralInfo();

  const [reserves, liabilities, solvent] = await Promise.all([
    client.readContract({ address: vault, abi: VAULT_ABI, functionName: "reserves" }) as Promise<bigint>,
    client.readContract({ address: vault, abi: VAULT_ABI, functionName: "totalInternal" }) as Promise<bigint>,
    client.readContract({ address: vault, abi: VAULT_ABI, functionName: "isSolvent" }) as Promise<boolean>,
  ]);

  return {
    vaultAddress: vault,
    solvent,
    reserves: Number(formatUnits(reserves, decimals)),
    liabilities: Number(formatUnits(liabilities, decimals)),
    decimals,
  };
}

/** On-chain collateral for one trader — balance, locked as margin, and free. */
export async function traderAccount(trader: string): Promise<{
  balance: number;
  locked: number;
  free: number;
}> {
  const { decimals } = await collateralInfo();
  const [balance, locked, free] = (await pc().readContract({
    address: vaultAddress(),
    abi: VAULT_ABI,
    functionName: "accountOf",
    args: [getAddress(trader) as Address],
  })) as readonly [bigint, bigint, bigint];

  return {
    balance: Number(formatUnits(balance, decimals)),
    locked: Number(formatUnits(locked, decimals)),
    free: Number(formatUnits(free, decimals)),
  };
}

/**
 * Pull a trader's vault collateral into their engine account.
 *
 * This is the join between the two halves of the system: the money is on chain,
 * the matching is not. `deposited` is overwritten from the vault every time, so
 * a deposit shows up in the terminal without anyone telling the operator about
 * it, and — more importantly — the operator cannot inflate it. If the chain is
 * unreachable the previous value is kept and the caller is told, rather than a
 * trader's collateral silently reading zero.
 *
 * Cached briefly because the terminal polls the account endpoint; a deposit
 * bypasses the cache via `refreshCollateral`.
 */
const CACHE_MS = 4_000;
const balanceCache = new Map<string, { at: number; deposited: number }>();

export function refreshCollateral(address: string): void {
  balanceCache.delete(getAddress(address).toLowerCase());
}

export async function syncCollateral(
  address: string,
): Promise<{ deposited: number; stale: boolean }> {
  if (!vaultConfigured()) return { deposited: 0, stale: true };
  const key = getAddress(address).toLowerCase();
  const hit = balanceCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { deposited: hit.deposited, stale: false };

  try {
    const { decimals } = await collateralInfo();
    const [balance] = (await pc().readContract({
      address: vaultAddress(),
      abi: VAULT_ABI,
      functionName: "accountOf",
      args: [getAddress(address) as Address],
    })) as readonly [bigint, bigint, bigint];

    const deposited = Number(formatUnits(balance, decimals));
    balanceCache.set(key, { at: Date.now(), deposited });
    return { deposited, stale: false };
  } catch {
    if (hit) return { deposited: hit.deposited, stale: true };
    throw new Error("could not read vault collateral");
  }
}

/**
 * How much PnL has actually been paid into the vault for a trader.
 *
 * This exists so settlement can never double-pay. The naive design decrements a
 * local counter when a batch lands — which is fine until a batch lands that the
 * operator did not observe (a retry that timed out here but succeeded there, a
 * restart mid-flight, someone firing the workflow from KeeperHub's own UI).
 * Then the local counter still shows the PnL as owed and the next run pays it
 * again.
 *
 * So what has been settled is read from the chain's own record — the vault's
 * `PnlApplied` events — and what is owed is the difference between the engine's
 * cumulative PnL and that. Settle twice and the second batch is empty, because
 * the difference is zero. Idempotency comes from the arithmetic rather than
 * from remembering correctly.
 */
const PNL_APPLIED_EVENT = {
  type: "event",
  name: "PnlApplied",
  inputs: [
    { name: "trader", type: "address", indexed: true, internalType: "address" },
    { name: "delta", type: "int256", indexed: false, internalType: "int256" },
    { name: "newBalance", type: "uint256", indexed: false, internalType: "uint256" },
  ],
} as const;

/** Scan floor: the vault cannot have events before it existed. */
const deployBlockCache = { value: undefined as bigint | undefined };
const settledCache = new Map<string, { toBlock: bigint; total: bigint }>();

async function vaultDeployBlock(client: ReturnType<typeof pc>): Promise<bigint> {
  if (deployBlockCache.value !== undefined) return deployBlockCache.value;
  const configured = process.env.DORR_VAULT_DEPLOY_BLOCK;
  if (configured) {
    deployBlockCache.value = BigInt(configured);
    return deployBlockCache.value;
  }
  // Without a configured floor, look back a bounded window rather than from
  // genesis — public RPCs reject unbounded getLogs ranges outright.
  const head = await client.getBlockNumber();
  const floor = head > 200_000n ? head - 200_000n : 0n;
  deployBlockCache.value = floor;
  return floor;
}

export async function settledPnlOf(address: string): Promise<number> {
  if (!vaultConfigured()) return 0;
  const client = pc();
  const key = getAddress(address).toLowerCase();
  const { decimals } = await collateralInfo();
  const head = await client.getBlockNumber();

  const cached = settledCache.get(key);
  const from = cached ? cached.toBlock + 1n : await vaultDeployBlock(client);
  let total = cached?.total ?? 0n;

  if (from <= head) {
    // Chunked: public endpoints cap the span a single getLogs may cover.
    const SPAN = 45_000n;
    for (let start = from; start <= head; start += SPAN) {
      const end = start + SPAN - 1n > head ? head : start + SPAN - 1n;
      const logs = await client.getLogs({
        address: vaultAddress(),
        event: PNL_APPLIED_EVENT,
        args: { trader: getAddress(address) as Address },
        fromBlock: start,
        toBlock: end,
      });
      for (const l of logs) total += (l.args as { delta: bigint }).delta;
    }
    settledCache.set(key, { toBlock: head, total });
  }

  return Number(formatUnits(total, decimals));
}

export interface SettlementRecord {
  txHash: string;
  blockNumber: number;
  trader: string;
  delta: number;
  newBalance: number;
  explorerUrl: string;
}

/**
 * The vault's own record of every PnL it has paid.
 *
 * This is the evidence tab's whole point: not the operator saying it settled,
 * but `DorrVault`'s `PnlApplied` logs, which only KeeperHub could have caused
 * and which anyone can re-read from Sepolia with the address in `/chain/info`.
 */
export async function settlementHistory(limit = 25): Promise<SettlementRecord[]> {
  if (!vaultConfigured()) return [];
  const client = pc();
  const { decimals } = await collateralInfo();
  const head = await client.getBlockNumber();
  const floor = await vaultDeployBlock(client);

  // Walk backwards from the head so a short list costs one query, not a scan
  // of the vault's entire life.
  const SPAN = 45_000n;
  const out: SettlementRecord[] = [];
  for (let end = head; end >= floor && out.length < limit; end -= SPAN) {
    const start = end - SPAN + 1n > floor ? end - SPAN + 1n : floor;
    const logs = await client.getLogs({
      address: vaultAddress(),
      event: PNL_APPLIED_EVENT,
      fromBlock: start,
      toBlock: end,
    });
    for (const l of logs.reverse()) {
      const a = l.args as { trader?: string; delta?: bigint; newBalance?: bigint };
      if (!a.trader || a.delta === undefined) continue;
      out.push({
        txHash: l.transactionHash,
        blockNumber: Number(l.blockNumber),
        trader: getAddress(a.trader),
        delta: Number(formatUnits(a.delta, decimals)),
        newBalance: Number(formatUnits(a.newBalance ?? 0n, decimals)),
        explorerUrl: explorerTx(l.transactionHash),
      });
      if (out.length >= limit) break;
    }
    if (start === floor) break;
  }
  return out;
}

/** Drop the settled-PnL cache for an address (after a batch lands). */
export function refreshSettled(address: string): void {
  settledCache.delete(getAddress(address).toLowerCase());
}

/** Native ETH held by the deployer — the account that would pay for keeper txs. */
export async function relayerBalance(): Promise<{ address: string; eth: number } | null> {
  if (!env.eth.deployerAddress) return null;
  const wei = await pc().getBalance({ address: getAddress(env.eth.deployerAddress) as Address });
  return { address: getAddress(env.eth.deployerAddress), eth: Number(formatUnits(wei, 18)) };
}
