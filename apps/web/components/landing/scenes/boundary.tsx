"use client";

import gsap from "gsap";
import { Ban, Check, Cpu, KeyRound, Landmark } from "lucide-react";
import { useScene } from "../use-scene";

/**
 * Where the operator's authority stops.
 *
 * The honest version of the trust story is not "trust nobody" — the matching
 * engine sees the book, because seeing the book is what lets it match. It is
 * that the engine's output is a *number*, and the number cannot move money on
 * its own. This draws that: the operator works out what is owed, reaches for
 * the vault and is refused by `onlySettlement`, and the batch only lands once
 * KeeperHub's wallet signs it and the contract has checked it sums to zero.
 *
 * The refused arrow is the whole scene, so it is the one thing that gets a
 * hard, fast recoil rather than an ease-out — a bounce off a wall should feel
 * like being stopped, not like arriving.
 */
export function BoundaryScene() {
  const ref = useScene(({ q, timeline }) => {
    const nodes = q("[data-node]");
    const pnl = q("[data-pnl]")[0];
    const blocked = q("[data-blocked]")[0];
    const blockedLabel = q("[data-blocked-label]")[0];
    const allowed = q("[data-allowed]")[0];
    const stamp = q("[data-stamp]")[0];

    gsap.set(nodes, { opacity: 0, y: 10 });
    gsap.set(pnl, { opacity: 0, y: 6 });
    gsap.set(blocked, { scaleX: 0, transformOrigin: "left center" });
    gsap.set(blockedLabel, { opacity: 0, scale: 0.8 });
    gsap.set(allowed, { scaleX: 0, transformOrigin: "left center" });
    gsap.set(stamp, { opacity: 0, scale: 0.85 });

    timeline()
      .to(nodes, { opacity: 1, y: 0, duration: 0.45, stagger: 0.1 })
      .to(pnl, { opacity: 1, y: 0, duration: 0.35 }, "-=0.15")
      // reach for the vault …
      .to(blocked, { scaleX: 1, duration: 0.4, ease: "power2.in" }, "+=0.15")
      // … and get stopped
      .to(blocked, { scaleX: 0.82, duration: 0.14, ease: "power4.out" })
      .to(blockedLabel, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2.2)" }, "-=0.05")
      // the route that does work
      .to(allowed, { scaleX: 1, duration: 0.55, ease: "power2.out" }, "+=0.35")
      .to(stamp, { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(1.8)" }, "-=0.1");
  });

  return (
    <div ref={ref} className="liquid-glass rounded-xl p-5 sm:p-6">
      <div className="grid gap-6 sm:grid-cols-3 sm:gap-4">
        <Node
          icon={<Cpu className="size-3.5" />}
          label="Operator"
          note="Sees the book. Works out the PnL."
          tone="neutral"
        >
          <span
            data-pnl
            className="mt-2 inline-block rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-white/80"
          >
            +0.031852 mUSD
          </span>
        </Node>

        <Node
          icon={<KeyRound className="size-3.5" />}
          label="KeeperHub"
          note="Holds the only key applyPnl will accept."
          tone="seal"
        />

        <Node
          icon={<Landmark className="size-3.5" />}
          label="DorrVault"
          note="Checks the batch sums to zero, on chain."
          tone="safe"
        >
          <span
            data-stamp
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-400/5 px-2 py-1 font-mono text-[11px] text-emerald-400"
          >
            <Check className="size-3" />
            Σ = 0
          </span>
        </Node>
      </div>

      {/* the two routes out of the operator */}
      <div className="mt-7 space-y-4">
        <Route
          label="Operator → vault"
          rail={<span data-blocked className="absolute inset-y-0 left-0 w-full bg-red-400/50" />}
          badge={
            <span
              data-blocked-label
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border border-red-400/40 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-red-400"
            >
              <Ban className="size-2.5" />
              NotSettlement()
            </span>
          }
        />
        <Route
          label="Operator → KeeperHub → vault"
          rail={<span data-allowed className="absolute inset-y-0 left-0 w-full bg-emerald-400/50" />}
          badge={
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border border-emerald-400/30 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-emerald-400">
              <Check className="size-2.5" />
              settled
            </span>
          }
        />
      </div>

      <p className="mt-6 text-[12px] leading-[1.6] text-white/40">
        The operator can compute what you are owed and can do nothing with it.
        <code className="mx-1 rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[11px] text-white/60">
          applyPnl
        </code>
        is <span className="text-white/60">onlySettlement</span>, and a batch
        that does not sum to zero reverts.
      </p>
    </div>
  );
}

function Node({
  icon,
  label,
  note,
  tone,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  note: string;
  tone: "neutral" | "seal" | "safe";
  children?: React.ReactNode;
}) {
  const toneClass =
    tone === "seal" ? "text-sky-300" : tone === "safe" ? "text-emerald-400" : "text-white/70";
  return (
    <div data-node className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3.5">
      <div className={`flex items-center gap-2 ${toneClass}`}>
        {icon}
        <span className="font-mono text-[11px] uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-2 text-[12px] leading-[1.5] text-white/45">{note}</p>
      {children}
    </div>
  );
}

function Route({
  label,
  rail,
  badge,
}: {
  label: string;
  rail: React.ReactNode;
  badge: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      {/* whitespace-nowrap: these are route names, and a route that wraps
          mid-arrow stops reading as a route. */}
      <span className="shrink-0 whitespace-nowrap font-mono text-[10px] uppercase tracking-wider text-white/35 sm:w-64">
        {label}
      </span>
      {/*
        Rail and badge stay on one row at every width. Stacked, the rail became
        a zero-height line of its own and the badge stretched to fill the
        column — which lost the one thing the scene is drawing, a reach that
        stops short of the far end.
      */}
      <div className="flex flex-1 items-center gap-3">
        <span className="relative h-px flex-1 overflow-hidden bg-white/[0.07]">{rail}</span>
        <span className="shrink-0">{badge}</span>
      </div>
    </div>
  );
}
