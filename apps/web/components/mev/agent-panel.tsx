"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PanelHeader } from "@/components/trading/panel-header";
import { cn } from "@/lib/core";
import { mevApi } from "@/lib/operator";
import { Bot, ExternalLink } from "lucide-react";

/**
 * The autonomous agent, and its audit trail.
 *
 * A KeeperHub Schedule workflow performs a real private swap on a cron with no
 * operator involvement. This panel is the audit: for every run, our own mempool
 * observer says whether that transaction was ever publicly visible.
 *
 * "unobserved" is deliberately its own outcome and is never counted as a win.
 * If the operator was not connected when a swap was mined, we did not look, and
 * not looking is not evidence of privacy.
 */
export function AgentPanel() {
  const { data } = useQuery({
    queryKey: ["mev", "agent"],
    queryFn: mevApi.agent,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    retry: false,
  });

  if (!data?.configured) {
    return (
      <Card>
        <PanelHeader title="Autonomous agent" bullet="default" icon={<Bot className="h-3.5 w-3.5" />} />
        <CardContent className="py-4 text-[11px] text-muted-foreground">
          {data?.reason ?? "Not configured on this operator."}
        </CardContent>
      </Card>
    );
  }

  const runs = data.runs ?? [];
  const succeeded = runs.filter((r) => r.status === "success").length;

  return (
    <Card>
      <PanelHeader
        title="Autonomous agent · KeeperHub schedule"
        bullet={data.everSeenInMempool ? "destructive" : "success"}
        icon={<Bot className="h-3.5 w-3.5" />}
        action={
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">
              {succeeded} executed
            </Badge>
            <Badge
              variant={data.everSeenInMempool ? "destructive" : "secondary"}
              className="text-[10px]"
            >
              {data.audited} audited · {data.everSeenInMempool} exposed
            </Badge>
          </div>
        }
      />
      <CardContent className="space-y-2">
        <p className="text-[10px] text-muted-foreground">
          A KeeperHub Schedule workflow swaps through private routing every hour, unattended — no
          operator involvement. Each run is then checked against our own mempool observer. Runs mined
          while the observer was offline are marked unobserved, not counted as private.
        </p>
        <div className="max-h-44 overflow-y-auto font-mono text-[10px]">
          {runs.length === 0 && (
            <div className="py-4 text-center text-muted-foreground">no runs yet</div>
          )}
          {runs.map((r) => (
            <div
              key={r.executionId}
              className="flex items-center gap-2 border-b border-border/30 py-1 last:border-0"
            >
              <span className="shrink-0 text-muted-foreground/60">
                {r.startedAt ? new Date(r.startedAt).toLocaleTimeString([], { hour12: false }) : "—"}
              </span>
              <span
                className={cn(
                  "shrink-0 uppercase tracking-wider",
                  r.status === "success" && "text-success",
                  r.status === "error" && "text-destructive",
                  r.status !== "success" && r.status !== "error" && "text-muted-foreground",
                )}
              >
                {r.status}
              </span>
              {r.transactionHash ? (
                <a
                  href={`https://sepolia.etherscan.io/tx/${r.transactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  <span className="truncate">{r.transactionHash.slice(0, 18)}…</span>
                  <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                </a>
              ) : (
                <span className="text-muted-foreground/50">—</span>
              )}
              <span
                className={cn(
                  "ml-auto shrink-0",
                  r.seenInMempool === null && "text-muted-foreground/60",
                  r.seenInMempool === false && "text-success",
                  r.seenInMempool === true && "text-destructive",
                )}
              >
                {r.seenInMempool === null
                  ? "unobserved"
                  : r.seenInMempool
                    ? "seen in mempool"
                    : "never public"}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
