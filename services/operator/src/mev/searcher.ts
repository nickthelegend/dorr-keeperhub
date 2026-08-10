/**
 * The adversary.
 *
 * A real searcher: it subscribes to Sepolia's pending-transaction feed, watches
 * for swaps against our pool, and when it finds one it front-runs and back-runs
 * it with its own signed transactions, paid for with its own ETH. Nothing here
 * is simulated — the sandwich either lands on chain or it doesn't, and this
 * module reports which.
 *
 * It plays two roles in MEV Shield, and it is important they stay separate:
 *
 *   1. OBSERVER — records every pending transaction hash it sees, with the
 *      timestamp it first saw it. This is the ground truth for the product's
 *      central claim. "Private routing worked" does not mean an API returned
 *      200; it means *this* log never contained the hash before the block did.
 *      The observer runs unconditionally and signs nothing.
 *
 *   2. ATTACKER — when armed, converts a detection into an actual sandwich.
 *
 * Keeping (1) independent of (2) is what makes the measurement falsifiable: the
 * observer would happily report seeing a transaction that the attacker then
 * failed to exploit, and it does report exactly that when the race is lost.
 */
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  formatEther,
  http,
  toFunctionSelector,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { env } from "../env.js";
import { POOL_ABI, TOKEN_ABI } from "./artifacts.js";

/** `swap(bool,uint256,uint256,address)` — the only call worth attacking. */
export const SWAP_SELECTOR = toFunctionSelector("swap(bool,uint256,uint256,address)");

export interface DecodedSwap {
  baseForQuote: boolean;
  amountIn: bigint;
  minAmountOut: bigint;
  recipient: Address;
}

/**
 * Recover a swap from a pending transaction's calldata, wrapped or not.
 *
 * A naive searcher matches `tx.to == pool` and decodes the top-level call. That
 * finds almost nothing in practice, and it found nothing here: transactions
 * relayed by KeeperHub do not target the pool directly. They target a relayer,
 * which carries the real call as an inner payload:
 *
 *   relayer(account, target, value, bytes( signature(65) ++ swap(...) ))
 *
 * The inner payload sits at an arbitrary, non-word-aligned offset, so this
 * scans for the selector and decodes the four static words that follow it.
 * `swap`'s arguments are all static types, so their encoding is positional and
 * self-contained wherever the call happens to be embedded.
 *
 * This is exactly the work a real searcher does to see through routers and
 * aggregators. Building the lab against only unwrapped calls would have made
 * every relayed trade look private, which is the flattering answer, not the
 * true one.
 */
export function decodeSwapFromCalldata(input: string, pool: Address): DecodedSwap | undefined {
  const data = input.toLowerCase();
  const target = pool.toLowerCase().slice(2);
  // The pool must be named somewhere in the call, or this swap isn't ours.
  if (!data.includes(target)) return undefined;

  const at = data.indexOf(SWAP_SELECTOR.slice(2));
  if (at < 0) return undefined;

  const words = data.slice(at + 8);
  if (words.length < 4 * 64) return undefined;
  const word = (i: number) => words.slice(i * 64, (i + 1) * 64);

  try {
    return {
      baseForQuote: BigInt(`0x${word(0)}`) !== 0n,
      amountIn: BigInt(`0x${word(1)}`),
      minAmountOut: BigInt(`0x${word(2)}`),
      recipient: `0x${word(3).slice(24)}` as Address,
    };
  } catch {
    return undefined;
  }
}

export interface Sighting {
  hash: Hex;
  /** ms epoch when the mempool feed first surfaced this transaction. */
  firstSeenAt: number;
  from: Address;
  to: Address | null;
  isPoolSwap: boolean;
}

export interface SandwichAttempt {
  victimHash: Hex;
  /** Detection latency: how long after we saw it we managed to react. */
  reactionMs: number;
  frontRun?: { hash: Hex; amountIn: string; block?: number };
  backRun?: { hash: Hex; amountIn: string; block?: number };
  victimBlock?: number;
  /**
   * Did the front-run actually land at or before the victim's position? A
   * sandwich that arrives late is not a sandwich, and is reported as such.
   */
  landed: boolean;
  /** Searcher's net gain in the token it staked, as a decimal string. */
  profit?: string;
  error?: string;
}

type VictimHandler = (a: SandwichAttempt) => void;

/**
 * Compress a chain error into one line a person can read.
 *
 * viem throws multi-paragraph errors carrying the full request — calldata, gas
 * settings, decoded arguments, a docs URL. Stored verbatim, that lands in the
 * duel record and then straight into the UI, where it both reads as a crash and
 * blows out the card's layout. The first line is the part that says what
 * actually went wrong.
 */
function readableError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const first = raw.split("\n").map((l) => l.trim()).find(Boolean) ?? "unknown error";
  return first.slice(0, 160);
}

export class Searcher {
  private ws?: WebSocket;
  private readonly sightings = new Map<Hex, Sighting>();
  /** Bounded so a long-running operator can't accumulate the whole mempool. */
  private readonly maxSightings = 20_000;
  private readonly order: Hex[] = [];

  private armed = false;
  private attacking = false;
  private handler?: VictimHandler;
  private stopped = false;
  private reconnectDelay = 1000;

  readonly pool: Address;
  private readonly account = env.mev.searcherKey
    ? privateKeyToAccount(env.mev.searcherKey as Hex)
    : undefined;
  private readonly publicClient: PublicClient;
  private readonly wallet?: WalletClient;

  /** Set once the feed is live, so callers can wait for real coverage. */
  private connected = false;
  private connectedResolvers: Array<() => void> = [];

  constructor(pool?: Address) {
    this.pool = (pool || env.mev.pool) as Address;
    this.publicClient = createPublicClient({
      chain: sepolia,
      transport: http(env.eth.rpcUrl),
    }) as PublicClient;
    if (this.account) {
      this.wallet = createWalletClient({
        account: this.account,
        chain: sepolia,
        transport: http(env.eth.rpcUrl),
      });
    }
  }

  get address(): Address | undefined {
    return this.account?.address;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /** Every pending transaction observed, newest last. */
  allSightings(): Sighting[] {
    return this.order.map((h) => this.sightings.get(h)!).filter(Boolean);
  }

  /**
   * THE measurement. Did the public mempool expose this transaction to us
   * before it was mined?
   */
  sawInMempool(hash: Hex): Sighting | undefined {
    return this.sightings.get(hash.toLowerCase() as Hex);
  }

  // ─── observer ───────────────────────────────────────────────────────────

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.connected = false;
    try {
      this.ws?.close();
    } catch {
      /* already gone */
    }
  }

  /** Resolves once the pending-tx subscription is actually live. */
  waitUntilConnected(timeoutMs = 15_000): Promise<void> {
    if (this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("searcher: mempool feed did not connect in time")),
        timeoutMs,
      );
      this.connectedResolvers.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private connect(): void {
    const ws = new WebSocket(env.eth.wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      // `true` asks the node to push full transaction bodies rather than bare
      // hashes. Without it every sighting would cost a round-trip and the
      // searcher would lose the race it is supposed to win.
      ws.send(
        JSON.stringify({ id: 1, jsonrpc: "2.0", method: "eth_subscribe", params: ["newPendingTransactions", true] }),
      );
      this.reconnectDelay = 1000;
    };

    ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.id === 1 && msg.result) {
        this.connected = true;
        this.connectedResolvers.splice(0).forEach((r) => r());
        return;
      }
      const tx = msg.params?.result;
      if (!tx || typeof tx !== "object") return;
      this.record(tx);
    };

    ws.onerror = () => {
      /* surfaced by onclose */
    };

    ws.onclose = () => {
      this.connected = false;
      if (this.stopped) return;
      // A dropped feed is a blind spot, and a blind spot reads as "the trade
      // was private". Reconnect with backoff rather than silently going deaf.
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15_000);
    };
  }

  private record(tx: any): void {
    const hash = String(tx.hash).toLowerCase() as Hex;
    if (this.sightings.has(hash)) return;

    const to = tx.to ? (String(tx.to).toLowerCase() as Address) : null;
    // Match on the payload, not the recipient — relayed swaps never name the
    // pool as `to`. See decodeSwapFromCalldata.
    const swap =
      this.pool && typeof tx.input === "string"
        ? decodeSwapFromCalldata(tx.input, this.pool)
        : undefined;

    const sighting: Sighting = {
      hash,
      firstSeenAt: Date.now(),
      from: String(tx.from).toLowerCase() as Address,
      to,
      isPoolSwap: Boolean(swap),
    };
    this.sightings.set(hash, sighting);
    this.order.push(hash);
    if (this.order.length > this.maxSightings) {
      const evicted = this.order.shift();
      if (evicted) this.sightings.delete(evicted);
    }

    if (swap) this.onPoolSwap(swap, tx, sighting);
  }

  // ─── attacker ───────────────────────────────────────────────────────────

  /** Arm for a single sandwich; `handler` receives the outcome either way. */
  arm(handler: VictimHandler): void {
    this.handler = handler;
    this.armed = true;
  }

  disarm(): void {
    this.armed = false;
    this.handler = undefined;
  }

  private onPoolSwap(swap: DecodedSwap, tx: any, sighting: Sighting): void {
    if (!this.armed || this.attacking) return;
    // Never sandwich ourselves — our own front-run and back-run are pool swaps.
    if (this.account && sighting.from === this.account.address.toLowerCase()) return;
    this.attacking = true;
    this.armed = false;
    void this.sandwich(swap, tx, sighting).finally(() => {
      this.attacking = false;
    });
  }

  private async sandwich(swap: DecodedSwap, tx: any, sighting: Sighting): Promise<void> {
    const attempt: SandwichAttempt = {
      victimHash: sighting.hash,
      reactionMs: 0,
      landed: false,
    };
    try {
      if (!this.wallet || !this.account) throw new Error("searcher has no key — cannot attack");

      const { baseForQuote, amountIn, minAmountOut } = swap;

      // Size the attack the way a searcher does: take exactly the budget the
      // victim's own slippage tolerance concedes, capped by our inventory.
      const budget = (await this.publicClient.readContract({
        address: this.pool,
        abi: POOL_ABI,
        functionName: "maxExtractableFrontRun",
        args: [baseForQuote, amountIn, minAmountOut],
      })) as bigint;

      const [tokenIn, tokenOut] = (await Promise.all([
        this.publicClient.readContract({
          address: this.pool,
          abi: POOL_ABI,
          functionName: baseForQuote ? "base" : "quote",
        }),
        this.publicClient.readContract({
          address: this.pool,
          abi: POOL_ABI,
          functionName: baseForQuote ? "quote" : "base",
        }),
      ])) as [Address, Address];

      const balanceOf = (token: Address) =>
        this.publicClient.readContract({
          address: token,
          abi: TOKEN_ABI,
          functionName: "balanceOf",
          args: [this.account!.address],
        }) as Promise<bigint>;

      const inventory = await balanceOf(tokenIn);
      // Snapshot the far side *before* trading: the back-run must unwind only
      // what the front-run acquired. Selling the whole balance instead would
      // dump the searcher's entire standing inventory into the pool — which is
      // not a sandwich, it wrecks the price and reports a fictional profit.
      const outBefore = await balanceOf(tokenOut);

      const frontRunIn = budget < inventory ? budget : inventory;
      if (frontRunIn === 0n) {
        attempt.error =
          budget === 0n
            ? "victim's slippage limit left nothing to extract"
            : "searcher has no inventory to front-run with";
        this.handler?.(attempt);
        return;
      }

      // Outbid the victim for position. Real searchers win the ordering race on
      // priority fee; on Sepolia this costs a fraction of a cent.
      const victimPriority = BigInt(tx.maxPriorityFeePerGas ?? tx.gasPrice ?? 1_000_000n);
      const priority = victimPriority * BigInt(env.mev.searcherPriorityMultiple) + 1n;
      const block = await this.publicClient.getBlock();
      const baseFee = block.baseFeePerGas ?? 1_000_000_000n;
      const maxFee = baseFee * 2n + priority;

      // Check gas before signing. Bidding 25x priority drains a testnet wallet
      // over a run of duels, and the resulting failure is a page of viem revert
      // data that says "gas required exceeds allowance" — true, but it reads as
      // a bug in the lab rather than an empty wallet. Say which it is.
      const gasBudget = maxFee * 400_000n; // both legs, generously
      const gasBalance = await this.publicClient.getBalance({ address: this.account.address });
      if (gasBalance < gasBudget) {
        attempt.error =
          `searcher is out of gas (${formatEther(gasBalance)} ETH) — ` +
          `fund ${this.account.address} with Sepolia ETH to re-arm the attacker`;
        this.handler?.(attempt);
        return;
      }

      const balBefore = inventory;

      const frontHash = await this.wallet.writeContract({
        address: this.pool,
        abi: POOL_ABI,
        functionName: "swap",
        args: [baseForQuote, frontRunIn, 0n, this.account.address],
        account: this.account,
        chain: sepolia,
        maxPriorityFeePerGas: priority,
        maxFeePerGas: maxFee,
      });
      attempt.reactionMs = Date.now() - sighting.firstSeenAt;
      attempt.frontRun = { hash: frontHash, amountIn: frontRunIn.toString() };

      const frontReceipt = await this.publicClient.waitForTransactionReceipt({
        hash: frontHash,
        timeout: 120_000,
      });
      attempt.frontRun.block = Number(frontReceipt.blockNumber);

      // Wait for the victim so the back-run unwinds into their impact, not
      // merely our own.
      const victimReceipt = await this.publicClient
        .waitForTransactionReceipt({ hash: sighting.hash, timeout: 180_000 })
        .catch(() => undefined);
      attempt.victimBlock = victimReceipt ? Number(victimReceipt.blockNumber) : undefined;

      // Honest verdict on the race. Same block is a win only if we are ordered
      // ahead of the victim within it.
      if (victimReceipt) {
        const sameBlock = frontReceipt.blockNumber === victimReceipt.blockNumber;
        attempt.landed = sameBlock
          ? frontReceipt.transactionIndex < victimReceipt.transactionIndex
          : frontReceipt.blockNumber < victimReceipt.blockNumber;
      }

      // Unwind exactly the position the front-run opened — the balance delta,
      // not the whole balance.
      const acquired = (await balanceOf(tokenOut)) - outBefore;

      if (acquired > 0n) {
        const backHash = await this.wallet.writeContract({
          address: this.pool,
          abi: POOL_ABI,
          functionName: "swap",
          args: [!baseForQuote, acquired, 0n, this.account.address],
          account: this.account,
          chain: sepolia,
          maxPriorityFeePerGas: priority,
          maxFeePerGas: maxFee,
        });
        attempt.backRun = { hash: backHash, amountIn: acquired.toString() };
        const backReceipt = await this.publicClient.waitForTransactionReceipt({
          hash: backHash,
          timeout: 120_000,
        });
        attempt.backRun.block = Number(backReceipt.blockNumber);
      }

      attempt.profit = ((await balanceOf(tokenIn)) - balBefore).toString();
    } catch (e) {
      attempt.error = readableError(e);
    }
    this.handler?.(attempt);
  }
}
