"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LineChart, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/core";
import { WalletConnectButton } from "./wallet-connect-button";
import { DemoShowcase } from "./attack-lab";
import { Bullet } from "@/components/ui/bullet";
import { Badge } from "@/components/ui/badge";
import DorrMark from "@/components/icons/dorr-mark";
import { useHealth, useMarkets, useSolvency } from "@/hooks/use-operator";

/** One premium status pill: bullet + label + optional value. */
function Chip({
  label,
  value,
  variant = "default",
  pulse = false,
  title,
}: {
  label: string;
  value?: string | number;
  variant?: "default" | "success" | "warning" | "destructive";
  pulse?: boolean;
  title?: string;
}) {
  return (
    <div
      title={title}
      className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1"
    >
      <Bullet variant={variant} className={cn("rounded-full", pulse && "animate-pulse")} size="sm" />
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {value !== undefined && (
        <span className="font-mono text-[10px] text-foreground tabular-nums">{value}</span>
      )}
    </div>
  );
}

/**
 * Two signals, not five. A trader needs to know the venue is up and that their
 * collateral is backed; market count, chain readiness and anchor totals are
 * operator telemetry and live in the hover detail rather than on the chrome.
 */
function HealthChips() {
  const { data: health, isError } = useHealth();
  const { data: markets } = useMarkets();
  const { data: solvency } = useSolvency();
  const up = !!health?.ok && !isError;

  const detail = [
    `Operator ${up ? "live" : "offline"}`,
    `${markets?.length ?? health?.markets ?? 0} markets`,
    solvency
      ? `${solvency.reservesUsd.toFixed(0)} mUSD in the vault backing ${solvency.liabilitiesUsd.toFixed(0)} credited`
      : "vault unreachable",
  ].join(" · ");

  return (
    <div className="hidden md:flex items-center gap-1.5">
      <Chip
        label={up ? "live" : "offline"}
        variant={up ? "success" : "destructive"}
        pulse={!up}
        title={detail}
      />
      {solvency && (
        <Chip
          label="backed"
          value={
            solvency.solvent
              ? solvency.collateralizationRatio != null
                ? `${solvency.collateralizationRatio.toFixed(1)}x`
                : "ok"
              : "under"
          }
          variant={solvency.solvent ? "success" : "destructive"}
          title={`Collateral reserves ${solvency.solvent ? "fully back" : "do NOT cover"} all credited balances`}
        />
      )}
    </div>
  );
}

/**
 * One tab per section of the app.
 *
 * The two halves used to look like two products: `/mev` rendered with no shell
 * at all, so landing there gave you a different header, a different title and
 * no way back. Same origin, same app, but nothing on screen said so. These make
 * the relationship explicit and mark where you are.
 */
function SectionTabs() {
  const pathname = usePathname();
  const tabs = [
    { href: "/trade", label: "Terminal", icon: LineChart },
    { href: "/mev", label: "MEV Shield", icon: ShieldCheck },
  ];

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5">
      {tabs.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded px-2.5 py-1 text-[10px] uppercase tracking-wider transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        );
      })}
    </div>
  );
}

export default function TradingNavbar() {
  return (
    <nav className="w-full bg-background border-b border-border px-2 sm:px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        {/* Left: brand */}
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2 sm:gap-3 transition-opacity hover:opacity-80"
        >
          <div className="flex items-center justify-center rounded bg-primary size-8 shrink-0">
            <DorrMark className="size-4 text-primary-foreground" title="dorr" />
          </div>
          <div className="flex min-w-0 flex-col leading-none">
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 font-display text-lg leading-none lowercase sm:text-2xl">
                dorr
              </span>
              <Badge variant="outline" className="hidden lg:inline-flex text-[9px] h-4 px-1.5 uppercase tracking-wider">
                sepolia
              </Badge>
            </div>
            <span className="mt-1 hidden truncate text-[9px] uppercase tracking-[0.2em] text-muted-foreground xl:block">
              private trading · sepolia · keeperhub
            </span>
          </div>
        </Link>

        {/* Right: status + sections + demo + wallet */}
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
          <HealthChips />
          <SectionTabs />
          <DemoShowcase />
          <WalletConnectButton />
        </div>
      </div>
    </nav>
  );
}
