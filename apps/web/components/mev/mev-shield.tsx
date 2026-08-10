"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PanelHeader } from "@/components/mev/panel-header";
import { useJob, useMevChains, useMevDuels, useMevLeaderboard, useMevStatus } from "@/hooks/use-operator";
import { mevApi } from "@/lib/operator";
import { cn } from "@/lib/core";
import { toast } from "sonner";
import { Loader2, Play, ShieldCheck, Swords, ExternalLink } from "lucide-react";
import { LaneCard } from "./lane-card";
import { MempoolFeed } from "./mempool-feed";
import { AgentPanel } from "./agent-panel";
import { ExtractionCurve } from "./extraction-curve";

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
  const { data: status, isError: statusError } = useMevStatus();
  const { data: board } = useMevLeaderboard();
  const { data: duels } = useMevDuels(25);
  const { data: chains } = useMevChains();
  const qc = useQueryClient();

  const [amountIn, setAmountIn] = useState("10");
  const [slippageBps, setSlippageBps] = useState("100");
  const [jobId, setJobId] = useState<string>();
  // Set the instant the button is pressed. `running` only becomes true once the
  // job id round-trips, and a double-click fits comfortably inside that gap —
  // the server rejects the duplicates with 409, but the user sees their own
  // impatience reported back as two red errors.
  const [starting, setStarting] = useState(false);
  // React state cannot guard re-entry: several clicks dispatched before the
  // next render all observe the old value. A ref updates synchronously, so the
  // second click of a double-click is refused inside the same tick.
  const inFlight = useRef(false);
  const { data: job } = useJob(jobId);

  // Trust the operator, not just this tab's job handle: a reload loses `jobId`
  // but the duel keeps running, and a re-enabled button would walk straight
  // into a 409 that reads like a broken app.
  const running = job?.status === "running" || Boolean(status?.duelRunning);
  const latest = duels?.[0];

  /**
   * Validate before submitting, mirroring the operator's own rules.
   *
   * The server is still the authority — it re-checks everything and owns the
   * pool-size limit, which the client cannot know. This exists so an obvious
   * typo is answered instantly and in place, instead of via a round-trip and a
   * toast that has vanished by the time you look up.
   */
  const size = Number(amountIn);
  const slip = Number(slippageBps);
  const maxSize = status ? Number(status.reserveBase) / 4 : undefined;
  const amountError =
    amountIn.trim() === "" || !Number.isFinite(size) || size <= 0
      ? "enter a positive amount"
      : maxSize !== undefined && size > maxSize
        ? `too large for this pool — keep it under ${maxSize.toFixed(0)} mETH`
        : undefined;
  const slippageError =
    !Number.isInteger(slip) || slip < 1 || slip > 5000
      ? "whole number, 1–5000"
      : undefined;
  const invalid = Boolean(amountError || slippageError);

  const start = async () => {
    if (invalid || inFlight.current || running) return;
    inFlight.current = true;
    setStarting(true);
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
      inFlight.current = false;
      setStarting(false);
    }
  };

  // Refresh the board the moment a duel finishes. In an effect, not in render:
  // invalidating during render re-enters the query cache mid-commit and loops.
  const finished = Boolean(jobId && job && job.status !== "running");
  useEffect(() => {
    if (!finished) return;
    inFlight.current = false;
    setStarting(false);
    qc.invalidateQueries({ queryKey: ["mev", "leaderboard"] });
    qc.invalidateQueries({ queryKey: ["mev", "duels", 25] });
  }, [finished, qc]);

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-4 overflow-x-hidden p-4 md:p-6">
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

      {/*
        Distinguish "the backend is down" from "no duels yet". Without this the
        page renders a fully-formed dashboard of zeros, which reads as "this
        project has no results" rather than "start the operator" — the worst
        possible misreading for someone evaluating it.
      */}
      {statusError && (
        <Card className="border-destructive/50">
          <CardContent className="space-y-1 py-3">
            <p className="text-xs font-medium text-destructive">Operator unreachable</p>
            <p className="text-[11px] text-muted-foreground">
              Nothing below is live. Start it with{" "}
              <code className="font-mono">bun run --cwd services/operator start</code>, then
              reload. The figures shown are placeholders, not measured results.
            </p>
          </CardContent>
        </Card>
      )}

      {/*
        A broke searcher cannot attack, so the public lane reports $0 lost and
        the private lane appears to win by default. That is the most flattering
        way this lab can be wrong, so say it out loud.
      */}
      {status?.configured && status.searcherFunded === false && (
        <Card className="border-warning/50">
          <CardContent className="space-y-1 py-3">
            <p className="text-xs font-medium text-warning">Searcher is out of gas</p>
            <p className="text-[11px] text-muted-foreground">
              The attacker pays for its own transactions and has{" "}
              {status.searcherGasEth?.toFixed(5) ?? "0"} ETH left, so it cannot land a sandwich.
              Until it is funded, a $0 public-lane result means the attack never ran — not that
              the trade was safe.
            </p>
          </CardContent>
        </Card>
      )}

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
                aria-invalid={Boolean(amountError)}
                className={cn("h-9 w-28 font-mono text-xs", amountError && "border-destructive")}
                inputMode="decimal"
              />
              {amountError && (
                <span className="block text-[10px] text-destructive">{amountError}</span>
              )}
            </label>
            <label className="space-y-1">
              <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                Slippage (bps)
              </span>
              <Input
                value={slippageBps}
                onChange={(e) => setSlippageBps(e.target.value)}
                aria-invalid={Boolean(slippageError)}
                className={cn("h-9 w-28 font-mono text-xs", slippageError && "border-destructive")}
                inputMode="numeric"
              />
              {slippageError && (
                <span className="block text-[10px] text-destructive">{slippageError}</span>
              )}
            </label>
            <Button
              onClick={start}
              disabled={running || starting || invalid || !status?.configured}
              className="h-9 gap-2"
            >
              {running || starting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {running || starting ? "Running…" : "Run the duel"}
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

      <ExtractionCurve amountIn={amountIn} slippageBps={slippageBps} />

      {/* ─── the A/B ───────────────────────────────────────────────────── */}
      <div className="grid gap-3 md:grid-cols-2">
        <LaneCard which="public" lane={latest?.public} pending={running} />
        <LaneCard which="private" lane={latest?.private} pending={running} />
      </div>

      <MempoolFeed />

      <AgentPanel />

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
          <div className="min-w-0 overflow-x-auto">
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
            {(
              [
                ["Pool", status.pool, true],
                ["mETH", status.baseToken, true],
                ["mUSD", status.quoteToken, true],
                ["Trader (KeeperHub)", status.trader ?? "—", true],
                ["Searcher (adversary)", status.searcher ?? "—", true],
                // Not an address — must not be linked to /address/.
                [
                  "Reserves",
                  `${Number(status.reserveBase).toFixed(2)} mETH / ${Number(status.reserveQuote).toLocaleString()} mUSD`,
                  false,
                ],
              ] as Array<[string, string, boolean]>
            ).map(([label, value, isAddress]) => (
              <div key={label} className="flex items-baseline justify-between gap-2">
                <span className="uppercase tracking-wider text-muted-foreground">{label}</span>
                {isAddress && value.startsWith("0x") ? (
                  <a
                    href={`${status.explorer}/address/${value}`}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate font-mono text-muted-foreground hover:text-foreground"
                  >
                    {value}
                  </a>
                ) : (
                  <span className="truncate font-mono text-muted-foreground">{value}</span>
                )}
              </div>
            ))}
            {chains?.privateCapable?.length ? (
              <p className="col-span-full mt-2 text-muted-foreground">
                KeeperHub offers private routing on {chains.privateCapable.length} of{" "}
                {chains.chains.length} supported chains — {chains.privateCapable.join(", ")}. Sepolia
                being one of them is why this runs where it does: the feature under test genuinely
                exists here, rather than being approximated on a testnet that lacks it.
              </p>
            ) : null}
            <p className="col-span-full mt-2 text-muted-foreground">{status.note}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
