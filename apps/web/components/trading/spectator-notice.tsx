"use client";

import { Eye } from "lucide-react";
import { truncateAddress } from "@/lib/core";

/**
 * Says whose account you are looking at.
 *
 * Spectating is only defensible if it is obvious. Every panel that follows the
 * fallback account carries this, so nobody can mistake someone else's positions
 * for their own — and so the read-only state reads as a deliberate choice
 * rather than as the app failing to notice their wallet.
 */
export function SpectatorNotice({ address }: { address?: string }) {
  return (
    <div className="flex items-start gap-1.5 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
      <Eye className="mt-px size-3 shrink-0 text-muted-foreground" />
      <p className="text-[10px] leading-snug text-muted-foreground">
        Watching a live account
        {address && <span className="ml-1 font-mono">{truncateAddress(address)}</span>} — real
        collateral, real positions, settled on chain. Connect a wallet to trade your own.
      </p>
    </div>
  );
}
