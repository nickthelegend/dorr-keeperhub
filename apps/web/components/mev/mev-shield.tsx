"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PanelHeader } from "@/components/trading/panel-header";
import { useJob, useMevDuels, useMevLeaderboard, useMevStatus } from "@/hooks/use-operator";
import { mevApi } from "@/lib/operator";
import { cn } from "@/lib/core";
import { toast } from "sonner";
import { Loader2, Play, ShieldCheck, Swords, ExternalLink } from "lucide-react";
import { LaneCard } from "./lane-card";

const usd = (n: number) => `$${n.toFixed(2)}`;

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "loss" | "win" | "neutral";
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div
          className={cn(
            "mt-1 font-mono text-2xl tabular-nums",
            tone === "loss" && "text-destructive",
            tone === "win" && "text-success",
          )}
        >
          {value}
        </div>
        {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

/**
 * MEV Shield.
 *
 * The page makes one argument and tries hard not to overclaim it: the same
 * trade, run twice through the same relayer, differing only in whether it
 * touched the public mempool. The leaderboard aggregates only what actually
 * happened on Sepolia — no annualising, no extrapolation from a single sample.
 */
export function MevShield() {
  const { data: status } = useMevStatus();
  const { data: board } = useMevLeaderboard();
  const { data: duels } = useMevDuels(25);
  const qc = useQueryClient();

  const [amountIn, setAmountIn] = useState("10");
  const [slippageBps, setSlippageBps] = useState("100");
  const [jobId, setJobId] = useState<string>();
  const { data: job } = useJob(jobId);

  const running = job?.status === "running";
  const latest = duels?.[0];

  const start = async () => {
    try {
      const { jobId: id } = await mevApi.runDuel({
        amountIn,
        slippageBps: Number(slippageBps),
      });
      setJobId(id);
      toast.info("Duel running", {
        description: "Two lanes across several Sepolia blocks — this takes a minute.",
      });
    } catch (e) {
      toast.error("Could not start the duel", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  // Refresh the board the moment a duel finishes. In an effect, not in render:
  // invalidating during render re-enters the query cache mid-commit and loops.
  const finished = Boolean(jobId && job && job.status !== "running");
  useEffect(() => {
    if (!finished) return;
    qc.invalidateQueries({ queryKey: ["mev", "leaderboard"] });
    qc.invalidateQueries({ queryKey: ["mev", "duels", 25] });
  }, [finished, qc]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6">
      {/* ─── the claim ─────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <ShieldCheck className="h-5 w-5 text-success" />
          MEV Shield — the private lane, measured
        </h1>
        <p className="max-w-3xl text-xs text-muted-foreground">
          The same swap, executed twice through the same KeeperHub relayer and the same wallet,
          differing in one thing: whether it went through the public mempool. A live searcher bot
          watches Sepolia&apos;s pending-transaction feed and sandwiches whatever it can see. Every
          number below came off chain.
        </p>
      </div>

      {status && !status.configured && (
        <Card className="border-warning/50">
          <CardContent className="py-3 text-xs text-muted-foreground">
            {status.reason ?? "MEV lab is not configured on this operator."}
          </CardContent>
        </Card>
      )}

      {/* ─── the headline ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Lost to the public mempool"
          value={usd(board?.totalLostUsd ?? 0)}
          sub={`across ${board?.duels ?? 0} duel${board?.duels === 1 ? "" : "s"}`}
          tone="loss"
        />
        <Stat
          label="Saved by the private lane"
          value={usd(board?.totalSavedUsd ?? 0)}
          sub="only counted when both lanes completed"
          tone="win"
        />
        <Stat
          label="Sandwiches landed"
          value={String(board?.sandwichesLanded ?? 0)}
          sub={`worst single trade ${usd(board?.worstSingleLossUsd ?? 0)}`}
          tone="loss"
        />
        <Stat
          label="Seen in the mempool"
          value={`${board?.publicSeenInMempool ?? 0} / ${board?.privateSeenInMempool ?? 0}`}
          sub="public / private — the mechanism, not the story"
        />
      </div>

      {/* ─── run one ───────────────────────────────────────────────────── */}
      <Card>
        <PanelHeader
          title="Run a duel"
          bullet="warning"
          icon={<Swords className="h-3.5 w-3.5" />}
          action={
            status?.midPriceUsd ? (
              <Badge variant="secondary" className="font-mono text-[10px]">
                pool ${status.midPriceUsd.toFixed(2)} / mETH
              </Badge>
            ) : null
          }
        />
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                Sell (mETH)
              </span>
              <Input
                value={amountIn}
                onChange={(e) => setAmountIn(e.target.value)}
                className="h-9 w-28 font-mono text-xs"
                inputMode="decimal"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                Slippage (bps)
              </span>
              <Input
                value={slippageBps}
                onChange={(e) => setSlippageBps(e.target.value)}
                className="h-9 w-28 font-mono text-xs"
                inputMode="numeric"
              />
            </label>
            <Button onClick={start} disabled={running || !status?.configured} className="h-9 gap-2">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? "Running…" : "Run the duel"}
            </Button>
          </div>

          <p className="text-[10px] text-muted-foreground">
            Your slippage tolerance is the attacker&apos;s budget: a rational searcher front-runs by
            exactly the amount that leaves you one wei above your own limit. Raise it and watch the
            loss grow.
          </p>

          {job?.steps?.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px]">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  s.status === "running" && "animate-pulse bg-warning",
                  s.status === "complete" && "bg-success",
                  s.status === "error" && "bg-destructive",
                )}
              />
              <span className="text-muted-foreground">{s.label}</span>
              {s.detail && <span className="font-mono text-foreground">{s.detail}</span>}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ─── the A/B ───────────────────────────────────────────────────── */}
      <div className="grid gap-3 md:grid-cols-2">
        <LaneCard which="public" lane={latest?.public} pending={running} />
        <LaneCard which="private" lane={latest?.private} pending={running} />
      </div>

      {latest?.notes?.length ? (
        <Card>
          <CardContent className="space-y-1 py-3">
            {latest.notes.map((n, i) => (
              <p key={i} className="text-[10px] text-muted-foreground">
                · {n}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* ─── leaderboard ───────────────────────────────────────────────── */}
      <Card>
        <PanelHeader title="Every duel, persisted" bullet="default" />
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 text-left font-normal">When</th>
                  <th className="px-3 py-2 text-right font-normal">Size</th>
                  <th className="px-3 py-2 text-right font-normal">Public cost</th>
                  <th className="px-3 py-2 text-right font-normal">Saved</th>
                  <th className="px-3 py-2 text-center font-normal">Sandwich</th>
                  <th className="px-3 py-2 text-right font-normal">Proof</th>
                </tr>
              </thead>
              <tbody>
                {(board?.entries ?? []).map((e) => (
                  <tr key={e.id} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                      {new Date(e.at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {(Number(BigInt(e.amountIn)) / 1e18).toFixed(2)} mETH
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-destructive">
                      {usd(e.lostUsd)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-success">
                      {usd(e.savedUsd)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {e.sandwichLanded ? (
                        <Badge variant="destructive" className="text-[10px]">
                          landed
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
                        {e.publicTx && (
                          <a
                            href={e.publicTx}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-destructive"
                          >
                            public <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                        {e.privateTx && (
                          <a
                            href={e.privateTx}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-success"
                          >
                            private <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!board?.entries?.length && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">
                      no duels yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ─── the lab, addressable ──────────────────────────────────────── */}
      {status?.configured && (
        <Card>
          <PanelHeader title="The lab" bullet="default" />
          <CardContent className="grid gap-x-6 gap-y-1 text-[10px] sm:grid-cols-2">
            {[
              ["Pool", status.pool],
              ["mETH", status.baseToken],
              ["mUSD", status.quoteToken],
              ["Trader (KeeperHub)", status.trader ?? "—"],
              ["Searcher (adversary)", status.searcher ?? "—"],
              ["Reserves", `${Number(status.reserveBase).toFixed(2)} mETH / ${Number(status.reserveQuote).toLocaleString()} mUSD`],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-2">
                <span className="uppercase tracking-wider text-muted-foreground">{label}</span>
                <a
                  href={`${status.explorer}/address/${value}`}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate font-mono text-muted-foreground hover:text-foreground"
                >
                  {value}
                </a>
              </div>
            ))}
            <p className="col-span-full mt-2 text-muted-foreground">{status.note}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
