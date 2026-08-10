"use client";

import { useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { PanelHeader } from "./panel-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bullet } from "@/components/ui/bullet";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Loader2, Droplets, ArrowDownToLine, ArrowUpFromLine, ExternalLink, Vault } from "lucide-react";
import { cn, formatUsd, truncateHash, readableError } from "@/lib/core";
import { useDorrWallet } from "@/hooks/use-dorr-wallet";
import { useViewedAddress } from "@/hooks/use-viewed-address";
import { SpectatorNotice } from "./spectator-notice";
import { useAccount, useInvalidateTrading } from "@/hooks/use-operator";
import { operator } from "@/lib/operator";
import { createPublicClient, http, parseUnits, formatUnits, getAddress, type Address } from "viem";
import { sepolia } from "@/hooks/use-evm-wallet";



const ERC20_ABI = [
  { inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], name: "mint", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], name: "allowance", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "a", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

const VAULT_ABI = [
  { inputs: [{ name: "amount", type: "uint256" }], name: "deposit", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "amount", type: "uint256" }], name: "withdraw", outputs: [], stateMutability: "nonpayable", type: "function" },
] as const;

/** One faucet pull. Enough margin to trade at size without repeated round-trips. */
const FAUCET_MUSD = 10_000;

const readClient = () => createPublicClient({ chain: sepolia, transport: http() });

const explorerTx = (h: string) => `https://sepolia.etherscan.io/tx/${h}`;

export default function CollateralPanel() {
  const { connected, address: ownAddress, wallet } = useDorrWallet();
  // Spectating shows the same on-chain split for a real account; only the
  // buttons that move value are withheld.
  const { address, isSpectator, canAct } = useViewedAddress();
  const { data: account } = useAccount(address);
  const invalidate = useInvalidateTrading();

  const [depositAmt, setDepositAmt] = useState("100");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [fauceting, setFauceting] = useState(false);
  const [depositing, setDepositing] = useState(false);
  const [depositStage, setDepositStage] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const cancelled = useRef(false);

  /**
   * The faucet is a real transaction. mUSD's `mint` is permissionless by design
   * (see MevToken.sol) so a judge can fund themselves and reproduce everything
   * without asking anyone for testnet tokens. Gas is SepoliaETH, which they do
   * have to get from a public faucet — that part we cannot do for them.
   */
  const handleFaucet = async () => {
    if (!ownAddress || !wallet || !canAct) return;
    setFauceting(true);
    try {
      const info = await operator.chainInfo();
      const token = getAddress(info.collateral.address) as Address;
      const amount = parseUnits(String(FAUCET_MUSD), info.collateral.decimals);

      const txHash = await wallet.writeContract({
        address: token, abi: ERC20_ABI, functionName: "mint", args: [ownAddress as Address, amount],
        account: ownAddress as Address, chain: sepolia,
      });
      await readClient().waitForTransactionReceipt({ hash: txHash });

      setLastTx(txHash);
      toast.success(`Minted ${FAUCET_MUSD.toLocaleString()} mUSD`, {
        description: truncateHash(txHash),
      });
    } catch (e: any) {
      toast.error("Faucet failed", { description: readableError(e) });
    } finally {
      setFauceting(false);
    }
  };

  /** Real mUSD deposit on Sepolia: ERC-20 approve, then DorrVault.deposit(). */
  const handleDeposit = async () => {
    if (!ownAddress || !wallet || !canAct) return;
    const n = parseFloat(depositAmt);
    if (!(n > 0)) {
      toast.error("Enter an mUSD amount to deposit.");
      return;
    }
    setDepositing(true);
    cancelled.current = false;
    try {
      setDepositStage("reading vault");
      const info = await operator.chainInfo();
      const vault = getAddress(info.contracts.vault) as Address;
      const musd = getAddress(info.collateral.address) as Address;
      const dp = info.collateral.decimals;
      const amount = parseUnits(String(n), dp);

      const pc = readClient();
      const balance = (await pc.readContract({
        address: musd, abi: ERC20_ABI, functionName: "balanceOf", args: [ownAddress as Address],
      })) as bigint;
      if (balance < amount) {
        throw new Error(
          `wallet holds ${formatUnits(balance, dp)} mUSD — use the faucet first`,
        );
      }

      const allowance = (await pc.readContract({
        address: musd, abi: ERC20_ABI, functionName: "allowance", args: [ownAddress as Address, vault],
      })) as bigint;

      if (allowance < amount) {
        setDepositStage("approve mUSD (wallet)");
        const approveHash = await wallet.writeContract({
          address: musd, abi: ERC20_ABI, functionName: "approve", args: [vault, amount],
          account: ownAddress as Address, chain: sepolia,
        });
        setDepositStage("confirming approval");
        await pc.waitForTransactionReceipt({ hash: approveHash });
      }

      setDepositStage("deposit (wallet)");
      const txHash = await wallet.writeContract({
        address: vault, abi: VAULT_ABI, functionName: "deposit", args: [amount],
        account: ownAddress as Address, chain: sepolia,
      });
      setDepositStage("confirming deposit");
      await pc.waitForTransactionReceipt({ hash: txHash });

      setLastTx(txHash);
      // The operator caches vault reads; tell it to look again now.
      await operator.syncCollateral(ownAddress).catch(() => {});
      toast.success(`Deposited ${n} mUSD`, { description: truncateHash(txHash) });
      invalidate(ownAddress);
    } catch (e: any) {
      toast.error("Deposit failed", { description: readableError(e) });
    } finally {
      setDepositing(false);
      setDepositStage(null);
    }
  };

  /** Real mUSD withdrawal — signed by the depositor, the only account that can. */
  const handleWithdraw = async () => {
    if (!ownAddress || !wallet || !canAct) return;
    const n = parseFloat(withdrawAmt);
    if (!(n > 0)) {
      toast.error("Enter an mUSD amount to withdraw.");
      return;
    }
    setWithdrawing(true);
    try {
      const info = await operator.chainInfo();
      const vault = getAddress(info.contracts.vault) as Address;
      const amount = parseUnits(String(n), info.collateral.decimals);

      const txHash = await wallet.writeContract({
        address: vault, abi: VAULT_ABI, functionName: "withdraw", args: [amount],
        account: ownAddress as Address, chain: sepolia,
      });
      await readClient().waitForTransactionReceipt({ hash: txHash });

      setLastTx(txHash);
      await operator.syncCollateral(ownAddress).catch(() => {});
      toast.success(`Withdrew ${n} mUSD`, { description: truncateHash(txHash) });
      setWithdrawAmt("");
      invalidate(ownAddress);
    } catch (e: any) {
      toast.error("Withdraw failed", { description: readableError(e) });
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <Card>
      <PanelHeader title="Collateral · mUSD vault" icon={<Vault className="size-3" />} />
      <CardContent className="space-y-3">
        {/* balances */}
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["Free", account?.free, "success"],
              ["Locked", account?.locked, "warning"],
              ["Balance", account?.balance, "default"],
            ] as const
          ).map(([label, v, variant]) => (
            <div
              key={label}
              className="rounded-md border border-border/60 bg-muted/30 p-2 space-y-1"
            >
              <div className="flex items-center gap-1 text-[9px] text-muted-foreground uppercase tracking-wide">
                <Bullet variant={variant} size="sm" />
                {label}
              </div>
              <div
                className={cn(
                  "font-mono text-sm font-semibold tabular-nums",
                  label === "Free" && "text-success",
                  label === "Locked" && "text-warning",
                )}
              >
                {account ? formatUsd(v ?? 0, 0) : "—"}
              </div>
            </div>
          ))}
        </div>

        {/*
          The split is the point: one of these numbers is the chain's and one is
          still only the operator's. A judge should be able to tell them apart
          at a glance, and watch the second one drain into the first.
        */}
        {account && (
          <div className="rounded-md border border-border/60 bg-muted/20 p-2 space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">
                Settled on chain
                {account.collateralStale && (
                  <span className="ml-1 text-warning">· last known</span>
                )}
              </span>
              <span className="font-mono tabular-nums">{formatUsd(account.deposited ?? 0, 2)}</span>
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">Awaiting settlement</span>
              <span
                className={cn(
                  "font-mono tabular-nums",
                  (account.unsettledPnl ?? 0) > 0 && "text-success",
                  (account.unsettledPnl ?? 0) < 0 && "text-destructive",
                  !account.unsettledPnl && "text-muted-foreground",
                )}
              >
                {(account.unsettledPnl ?? 0) === 0
                  ? "—"
                  : `${(account.unsettledPnl ?? 0) > 0 ? "+" : "−"}${formatUsd(Math.abs(account.unsettledPnl ?? 0), 2)}`}
              </span>
            </div>
            <p className="pt-0.5 text-[9px] leading-snug text-muted-foreground">
              The first line is <code className="font-mono">DorrVault</code> on Sepolia — the operator
              cannot credit you what you did not earn or deposit. The second is PnL it has computed
              but not yet paid; KeeperHub applies it on chain, privately, and the vault rejects any
              batch that is not zero-sum. The operator can decide what you are owed and cannot pay it
              to you.
            </p>
          </div>
        )}

        {isSpectator && address && <SpectatorNotice address={address} />}

        {!connected ? (
          <p className="text-[11px] text-muted-foreground text-center py-1">
            {isSpectator
              ? "Connect a wallet to deposit and trade your own collateral."
              : "Connect a wallet to manage collateral."}
          </p>
        ) : (
          <>
            <Separator />
            {/* faucet */}
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={handleFaucet}
              disabled={fauceting || !address}
            >
              {fauceting ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Droplets className="w-3.5 h-3.5 mr-1.5" />
              )}
              Get mUSD
            </Button>

            {/* deposit */}
            <div className="flex gap-1.5">
              <Input
                value={depositAmt}
                onChange={(e) => setDepositAmt(e.target.value)}
                inputMode="numeric"
                className="h-8 text-xs font-mono"
                placeholder="mUSD"
                disabled={depositing}
              />
              <Button
                size="sm"
                className="h-8 text-xs shrink-0"
                onClick={handleDeposit}
                disabled={depositing || !address}
              >
                {depositing ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <ArrowDownToLine className="w-3.5 h-3.5 mr-1.5" />
                )}
                Deposit
              </Button>
            </div>
            {depositStage && (
              <div className="text-[10px] text-primary flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> {depositStage}…
              </div>
            )}

            {/* withdraw */}
            <div className="flex gap-1.5">
              <Input
                value={withdrawAmt}
                onChange={(e) => setWithdrawAmt(e.target.value)}
                inputMode="numeric"
                className="h-8 text-xs font-mono"
                placeholder="mUSD"
                disabled={withdrawing}
              />
              <Button
                size="sm"
                variant="secondary"
                className="h-8 text-xs shrink-0"
                onClick={handleWithdraw}
                disabled={withdrawing || !address}
              >
                {withdrawing ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <ArrowUpFromLine className="w-3.5 h-3.5 mr-1.5" />
                )}
                Withdraw
              </Button>
            </div>

            {lastTx && (
              <a
                href={explorerTx(lastTx)}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] font-mono text-primary underline inline-flex items-center gap-1"
              >
                last tx {truncateHash(lastTx)} <ExternalLink className="w-2.5 h-2.5" />
              </a>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
