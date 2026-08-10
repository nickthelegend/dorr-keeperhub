"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PanelHeader } from "@/components/trading/panel-header";
import { cn } from "@/lib/core";
import { OPERATOR_URL } from "@/lib/operator";
import { Radio } from "lucide-react";

interface FeedEvent {
  type: "sighting" | "pool-swap" | "status" | "hello";
  at?: number;
  hash?: string;
  from?: string;
  seen?: number;
  connected?: boolean;
  note?: string;
}

interface Row {
  key: string;
  kind: "sighting" | "pool-swap" | "status";
  hash?: string;
  from?: string;
  note?: string;
  at: number;
}

const MAX_ROWS = 40;

/**
 * Sepolia's public mempool, live.
 *
 * This panel exists because the product's central claim is about something
 * *not* happening, and an absence is only convincing next to a presence. A
 * judge watching this sees hundreds of unrelated pending transactions stream
 * past, sees the public lane's own hash appear among them before it is mined,
 * and then sees the private lane execute while the same stream carries on
 * without it. That is the entire argument, rendered rather than asserted.
 *
 * It is the searcher's own observation feed — the same data the attacker acts
 * on, not a summary produced for display.
 */
export function MempoolFeed() {
  const [rows, setRows] = useState<Row[]>([]);
  const [seen, setSeen] = useState(0);
  const [connected, setConnected] = useState(false);
  const [poolHits, setPoolHits] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const es = new EventSource(`${OPERATOR_URL}/mev/stream`);

    es.onmessage = (ev) => {
      let e: FeedEvent;
      try {
        e = JSON.parse(ev.data) as FeedEvent;
      } catch {
        return;
      }
      if (typeof e.seen === "number") setSeen(e.seen);
      if (typeof e.connected === "boolean") setConnected(e.connected);
      if (e.type === "hello") return;
      if (e.type === "pool-swap") setPoolHits((n) => n + 1);

      setRows((prev) =>
        [
          {
            key: `${e.at ?? Date.now()}-${seq.current++}`,
            kind: e.type as Row["kind"],
            hash: e.hash,
            from: e.from,
            note: e.note,
            at: e.at ?? Date.now(),
          },
          ...prev,
        ].slice(0, MAX_ROWS),
      );
    };

    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  return (
    <Card>
      <PanelHeader
        title="Sepolia mempool · live"
        bullet={connected ? "success" : "destructive"}
        icon={<Radio className={cn("h-3.5 w-3.5", connected && "animate-pulse")} />}
        action={
          <div className="flex items-center gap-2">
            {poolHits > 0 && (
              <Badge variant="destructive" className="text-[10px]">
                {poolHits} on our pool
              </Badge>
            )}
            <Badge variant="secondary" className="font-mono text-[10px]">
              {seen.toLocaleString()} seen
            </Badge>
          </div>
        }
      />
      <CardContent className="p-0">
        <p className="px-4 pb-2 text-[10px] text-muted-foreground">
          Every pending transaction the searcher can see, as it sees it. A public-lane trade shows up
          here before it is mined. A private-lane trade never does — while this keeps scrolling.
        </p>
        <div className="h-56 overflow-y-auto border-t border-border/60 font-mono text-[10px]">
          {rows.length === 0 && (
            <div className="px-4 py-8 text-center text-muted-foreground">
              {connected ? "waiting for the next pending transaction…" : "connecting to the feed…"}
            </div>
          )}
          {rows.map((r) => (
            <div
              key={r.key}
              className={cn(
                "flex items-baseline gap-2 border-b border-border/30 px-4 py-1 last:border-0",
                r.kind === "pool-swap" && "bg-destructive/10",
                r.kind === "status" && "bg-warning/10",
              )}
            >
              <span className="shrink-0 text-muted-foreground/60">
                {new Date(r.at).toLocaleTimeString([], { hour12: false })}
              </span>
              {r.kind === "status" ? (
                <span className="text-warning">▸ {r.note}</span>
              ) : (
                <>
                  <span
                    className={cn(
                      "shrink-0 uppercase tracking-wider",
                      r.kind === "pool-swap" ? "font-semibold text-destructive" : "text-muted-foreground/50",
                    )}
                  >
                    {r.kind === "pool-swap" ? "spotted" : "pending"}
                  </span>
                  <a
                    href={`https://sepolia.etherscan.io/tx/${r.hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-muted-foreground hover:text-foreground"
                  >
                    {r.hash?.slice(0, 22)}…
                  </a>
                  {r.kind === "pool-swap" && (
                    <span className="ml-auto shrink-0 text-destructive">swap on our pool</span>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
