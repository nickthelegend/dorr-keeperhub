"use client";

import type { ReactNode } from "react";
import TradingNavbar from "@/components/trading/navbar";

/**
 * The chrome every page shares.
 *
 * `/mev` used to render bare — no brand, no status chips, no way back — which
 * made two sections of one app look like two separate products. Same origin,
 * same operator, same wallet, but nothing on screen said so. Wrapping both
 * routes in the same shell is what makes them read as one thing.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <TradingNavbar />
      {children}
    </div>
  );
}
