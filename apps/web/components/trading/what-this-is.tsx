"use client";

import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { useConfig } from "@/hooks/use-operator";

/**
 * One line saying what this app is, and how its two halves relate.
 *
 * The project ships two products under one name, and someone landing on the
 * terminal with no context has no way to tell whether `/mev` is a different
 * project, a sub-feature, or a stray page. Worse, the argument only lands when
 * you see both: MEV Shield prices what the mempool costs you, and the perps are
 * the venue you'd want given that price. Said in one sentence, that's a thesis;
 * left unsaid, it's two half-explained demos.
 *
 * Dismissible, because it is for first-time visitors and nobody should have to
 * scroll past it twice.
 */
export function WhatThisIs() {
  const { data: config } = useConfig();

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
      <span className="text-[11px] text-muted-foreground">
        <strong className="text-foreground">What you reveal before a trade lands is what it
        costs you.</strong>{" "}
        This is the venue that never reveals it — orders are commitments, stops are never
        published, and PnL settles on chain through KeeperHub rather than on our word.
      </span>
      <Link
        href="/mev"
        className="inline-flex items-center gap-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
      >
        <ShieldCheck className="size-3" />
        See the cost measured in dollars
        <ArrowRight className="size-3" />
      </Link>
      {config && (
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {config.chain} · {config.oracle} · {config.relayer}
        </span>
      )}
    </div>
  );
}
