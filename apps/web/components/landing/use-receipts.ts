"use client";

import { useEffect, useState } from "react";

const OPERATOR = process.env.NEXT_PUBLIC_OPERATOR_URL || "http://localhost:8790";

export interface Receipts {
  duels: number;
  lostUsd: number;
  landed: number;
  rows: Array<{ size: string; pub: string; sandwich: boolean }>;
  /** false while showing the compiled-in snapshot, true once the board answers. */
  live: boolean;
}

/**
 * The snapshot this page ships with.
 *
 * Read from services/operator/data/mev.sqlite on 2026-08-11 and correct at that
 * moment. It exists so the section renders with real figures when the operator
 * is unreachable — a marketing page must not depend on a service being up — and
 * it is labelled as of that date rather than presented as current.
 */
export const SNAPSHOT: Receipts = {
  duels: 23,
  lostUsd: 2771.87,
  landed: 15,
  rows: [
    { size: "25.00 mETH", pub: "$972.73", sandwich: true },
    { size: "12.00 mETH", pub: "$235.01", sandwich: true },
    { size: "10.00 mETH", pub: "$197.62", sandwich: true },
    { size: "8.00 mETH", pub: "$119.06", sandwich: true },
    { size: "10.00 mETH", pub: "$0.00", sandwich: false },
  ],
  live: false,
};

export const SNAPSHOT_DATE = "11 August 2026";

const fmtUsd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Live receipts, with the snapshot as the opening frame.
 *
 * These numbers are the section's entire claim, and a scheduled KeeperHub agent
 * runs a fresh duel every fifteen minutes — so a figure typed into the markup is
 * wrong within the hour. It was: the page said "22 duels" while the board had
 * already moved to 23. Anything asserted as a receipt has to come from the thing
 * issuing the receipts.
 */
export function useReceipts(): Receipts {
  const [data, setData] = useState<Receipts>(SNAPSHOT);

  useEffect(() => {
    const ctrl = new AbortController();

    (async () => {
      try {
        const [boardRes, duelsRes] = await Promise.all([
          fetch(`${OPERATOR}/mev/leaderboard`, { signal: ctrl.signal, cache: "no-store" }),
          fetch(`${OPERATOR}/mev/duels`, { signal: ctrl.signal, cache: "no-store" }),
        ]);
        if (!boardRes.ok || !duelsRes.ok) return;

        const board = await boardRes.json();
        const duelsBody = await duelsRes.json();
        const duels: any[] = Array.isArray(duelsBody) ? duelsBody : (duelsBody.duels ?? []);

        // The caption's claim, computed rather than asserted: the four costliest
        // runs, then one the searcher missed entirely.
        const clean = duels.filter((d) => d.public && !d.public.error);
        const byCost = [...clean].sort(
          (a, b) => Number(b.public?.shortfallUsd ?? 0) - Number(a.public?.shortfallUsd ?? 0),
        );
        const costliest = byCost.slice(0, 4);
        const missed = byCost.find((d) => !d.public?.sandwich?.landed);

        const row = (d: any) => ({
          size: `${(Number(BigInt(d.amountIn)) / 1e18).toFixed(2)} mETH`,
          pub: fmtUsd(Number(d.public?.shortfallUsd ?? 0)),
          sandwich: Boolean(d.public?.sandwich?.landed),
        });

        const rows = [...costliest, ...(missed ? [missed] : [])].map(row);
        if (!rows.length) return;

        setData({
          duels: Number(board.duels ?? SNAPSHOT.duels),
          lostUsd: Number(board.totalLostUsd ?? SNAPSHOT.lostUsd),
          landed: Number(board.sandwichesLanded ?? SNAPSHOT.landed),
          rows,
          live: true,
        });
      } catch {
        // Operator unreachable — the snapshot stands, labelled as of its date.
      }
    })();

    return () => ctrl.abort();
  }, []);

  return data;
}

export const formatUsd = fmtUsd;
