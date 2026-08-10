"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PanelHeader } from "@/components/mev/panel-header";
import { cn } from "@/lib/core";
import { mevApi } from "@/lib/operator";
import { Crosshair } from "lucide-react";

const usd = (n: number) => `$${n.toFixed(2)}`;
const tok = (raw: string) => (Number(BigInt(raw)) / 1e18).toFixed(2);

/**
 * What each slippage tolerance is worth to an attacker.
 *
 * A duel proves the loss is real but takes minutes and shows one point. This
 * shows the whole curve instantly, and it is the argument the project is
 * actually making: a slippage tolerance is not protection, it is the amount you
 * have published your willingness to lose, and a searcher will take precisely
 * that much.
 *
 * Every "attacker capital" figure is `maxExtractableFrontRun` read from the
 * deployed pool at live reserves — the contract's own answer to "how much am I
 * allowed to take", not an estimate.
 */
export function ExtractionCurve({
  amountIn,
  slippageBps,
}: {
  amountIn: string;
  slippageBps: string;
}) {
  const size = Number(amountIn);
  const valid = Number.isFinite(size) && size > 0;

  const { data, isError } = useQuery({
    queryKey: ["mev", "extraction", valid ? amountIn : "10"],
    queryFn: () => mevApi.extraction(valid ? amountIn : "10"),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    retry: false,
    placeholderData: (prev) => prev,
  });

  if (isError || !data) {
    return (
      <Card>
        <PanelHeader
          title="What your slippage tolerance is worth"
          bullet="default"
          icon={<Crosshair className="h-3.5 w-3.5" />}
        />
        <CardContent className="py-6 text-center text-[11px] text-muted-foreground">
          {isError ? "pool unreachable — cannot price the curve" : "pricing against live reserves…"}
        </CardContent>
      </Card>
    );
  }

  const current = Number(slippageBps);
  const maxTake = Math.max(...data.points.map((p) => p.attackerProfitUsd), 1);

  return (
    <Card>
      <PanelHeader
        title="What your slippage tolerance is worth"
        bullet="warning"
        icon={<Crosshair className="h-3.5 w-3.5" />}
        action={
          <Badge variant="secondary" className="font-mono text-[10px]">
            {valid ? size : 10} mETH · live reserves
          </Badge>
        }
      />
      <CardContent className="space-y-3">
        <p className="text-[10px] text-muted-foreground">
          Not a projection. For each tolerance the pool itself is asked{" "}
          <code className="font-mono">maxExtractableFrontRun</code> — the largest front-run that still
          lets you clear your own limit. That is the trade a rational searcher makes, so the answer is
          the budget you handed them.
        </p>

        <div className="min-w-0 overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-1 pr-2 text-left font-normal">Tolerance</th>
                <th className="px-2 py-1 text-right font-normal">Costs you</th>
                <th className="px-2 py-1 text-right font-normal">Attacker needs</th>
                <th className="px-2 py-1 text-right font-normal">Attacker takes</th>
                <th className="py-1 pl-2 text-left font-normal">Extraction</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {data.points.map((p) => {
                const isCurrent = p.slippageBps === current;
                return (
                  <tr
                    key={p.slippageBps}
                    className={cn(
                      "border-b border-border/30 last:border-0",
                      isCurrent && "bg-warning/10",
                    )}
                  >
                    <td className={cn("py-1 pr-2", isCurrent && "font-semibold text-warning")}>
                      {(p.slippageBps / 100).toFixed(2)}%
                      {isCurrent && <span className="ml-1 text-[9px] uppercase">yours</span>}
                    </td>
                    <td className="px-2 py-1 text-right text-destructive">{usd(p.maxLossUsd)}</td>
                    <td className="px-2 py-1 text-right text-muted-foreground">
                      {tok(p.attackerCapitalBase)} mETH
                    </td>
                    <td className="px-2 py-1 text-right text-destructive">
                      {usd(p.attackerProfitUsd)}
                    </td>
                    <td className="py-1 pl-2">
                      <div className="h-1.5 w-full max-w-[120px] overflow-hidden rounded-sm bg-border/40">
                        <div
                          className={cn("h-full rounded-sm", isCurrent ? "bg-warning" : "bg-destructive/60")}
                          style={{ width: `${Math.max(2, (p.attackerProfitUsd / maxTake) * 100)}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-[10px] text-muted-foreground">
          The gap between what it costs you and what the attacker keeps is the pool&apos;s 30bp fee on
          each of their two legs — value moved, not created. Routing privately removes the line
          entirely, which is what the duel above measures.
        </p>
      </CardContent>
    </Card>
  );
}
