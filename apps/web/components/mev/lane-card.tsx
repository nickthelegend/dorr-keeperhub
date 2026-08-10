"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PanelHeader } from "@/components/trading/panel-header";
import { cn } from "@/lib/core";
import type { MevLane } from "@/lib/operator";
import { ExternalLink, Eye, EyeOff } from "lucide-react";

const usd = (n: number) => `$${n.toFixed(2)}`;

function tokens(raw?: string, dp = 2): string {
  if (!raw) return "—";
  try {
    const v = Number(BigInt(raw)) / 1e18;
    return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
  } catch {
    return "—";
  }
}

function Row({
  label,
  value,
  mono = true,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  emphasis?: "loss" | "clean";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-right tabular-nums",
          mono && "font-mono text-xs",
          emphasis === "loss" && "text-destructive font-semibold text-sm",
          emphasis === "clean" && "text-success font-semibold text-sm",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function TxLink({ label, href }: { label: string; href?: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
    >
      <ExternalLink className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </a>
  );
}

/**
 * One lane of the duel.
 *
 * The two facts that carry the argument are given the most weight: whether the
 * transaction was visible in the public mempool before it was mined, and how
 * far below its own quote it filled. Everything else is supporting evidence a
 * sceptic can click through to Etherscan.
 */
export function LaneCard({
  which,
  lane,
  pending,
}: {
  /** Which lane this slot represents — needed to label the empty state, which
   *  has no `lane` object to infer it from. */
  which: "public" | "private";
  lane?: MevLane;
  pending?: boolean;
}) {
  const isPublic = which === "public";
  const title = isPublic ? "Public mempool" : "Private lane · KeeperHub";

  if (pending && !lane) {
    return (
      <Card className="h-full">
        <PanelHeader title={title} bullet={isPublic ? "destructive" : "success"} />
        <CardContent className="py-8 text-center text-xs text-muted-foreground">
          waiting for Sepolia…
        </CardContent>
      </Card>
    );
  }

  if (!lane) {
    return (
      <Card className="h-full">
        <PanelHeader title={title} bullet="default" />
        <CardContent className="py-8 text-center text-xs text-muted-foreground">
          run a duel to populate this lane
        </CardContent>
      </Card>
    );
  }

  if (lane.error) {
    return (
      <Card className="h-full border-destructive/40">
        <PanelHeader title={title} bullet="warning" />
        <CardContent className="space-y-2">
          <p className="text-xs text-destructive break-words">{lane.error}</p>
          <p className="text-[10px] text-muted-foreground">
            This lane did not complete, so no saving is claimed for this duel.
          </p>
        </CardContent>
      </Card>
    );
  }

  const exposed = lane.seenInMempool;
  const landed = lane.sandwich?.landed;

  return (
    <Card className={cn("h-full", exposed ? "border-destructive/40" : "border-success/40")}>
      <PanelHeader
        title={title}
        bullet={exposed ? "destructive" : "success"}
        action={
          <Badge variant={exposed ? "destructive" : "secondary"} className="gap-1 text-[10px]">
            {exposed ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            {exposed ? "seen by searchers" : "never public"}
          </Badge>
        }
      />
      <CardContent className="space-y-0.5">
        <Row label="Quoted" value={`${tokens(lane.quotedOut)} mUSD`} />
        <Row label="Received" value={`${tokens(lane.actualOut)} mUSD`} />
        <Row
          label="Cost of this lane"
          value={usd(lane.shortfallUsd)}
          emphasis={lane.shortfallUsd > 0 ? "loss" : "clean"}
        />

        <div className="my-2 border-t border-border/60" />

        {lane.mempoolExposureMs !== undefined && (
          <Row label="Exposure window" value={`${(lane.mempoolExposureMs / 1000).toFixed(1)}s`} />
        )}
        {lane.blockNumber && <Row label="Block" value={lane.blockNumber.toLocaleString()} />}

        {lane.sandwich && (
          <>
            <div className="my-2 border-t border-border/60" />
            <Row
              label="Sandwich"
              value={
                <span className={landed ? "text-destructive" : "text-muted-foreground"}>
                  {landed ? "LANDED" : "attempted, lost the race"}
                </span>
              }
              mono={false}
            />
            {lane.sandwich.reactionMs !== undefined && lane.sandwich.reactionMs > 0 && (
              <Row label="Searcher reacted in" value={`${lane.sandwich.reactionMs} ms`} />
            )}
            {lane.sandwich.error && (
              <p className="py-1 text-[10px] text-muted-foreground">{lane.sandwich.error}</p>
            )}
          </>
        )}

        <div className="mt-3 space-y-1">
          <TxLink label="trade" href={lane.transactionLink} />
          {lane.sandwich?.frontRunHash && (
            <TxLink
              label="attacker front-run"
              href={`https://sepolia.etherscan.io/tx/${lane.sandwich.frontRunHash}`}
            />
          )}
          {lane.sandwich?.backRunHash && (
            <TxLink
              label="attacker back-run"
              href={`https://sepolia.etherscan.io/tx/${lane.sandwich.backRunHash}`}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
