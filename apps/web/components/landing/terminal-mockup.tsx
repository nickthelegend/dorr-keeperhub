"use client";

import { Reveal } from "./reveal";
import { Lock, Search, Shield, Sparkles } from "lucide-react";

/**
 * The terminal, as a still life.
 *
 * Built from markup rather than a screenshot so it stays sharp on any display
 * and cannot drift out of date the way a PNG does — but it is deliberately
 * *static*. Nothing here is wired to the operator: this is the product shot,
 * and the real thing is one click away at /trade. Every number shown is copied
 * from a real session rather than invented, and the sealed rows show what the
 * public feed actually shows: a hash and nothing else.
 */

const ORDERS = [
  { market: "ETH-USD", hash: "3137245a7870ed0d42…8c6444af53ae310", time: "02:34:05" },
  { market: "BTC-USD", hash: "cc7c6028caf9ee14ed…0e0deb965649bd", time: "02:33:16" },
  { market: "ETH-USD", hash: "a6248635882d039ad7…d7a6d8ec03f6da", time: "02:34:55" },
  { market: "ETH-USD", hash: "c736fd1080d51875b…960e35c13f8d3a", time: "02:31:33" },
  { market: "LINK-USD", hash: "6d061bc1274ec2ea0f…87ee6ac9e961ec", time: "02:19:11" },
];

const POSITIONS = [
  {
    market: "ETH-USD",
    side: "LONG" as const,
    size: "0.1921",
    entry: "1,873.94",
    mark: "1,874.10",
    liq: "1,315.10",
    upnl: "+0.031",
    up: true,
    lev: "3x",
    margin: "120",
  },
  {
    market: "BTC-USD",
    side: "SHORT" as const,
    size: "0.002821",
    entry: "63,794.38",
    mark: "64,100.86",
    liq: "91,136.19",
    upnl: "−0.864",
    up: false,
    lev: "2x",
    margin: "90",
  },
];

export function TerminalMockup() {
  return (
    <Reveal
      y={40}
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0e1014]/90 backdrop-blur-2xl"
    >
      {/* title bar */}
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span className="size-3 rounded-full bg-[#ff5f57]" />
        <span className="size-3 rounded-full bg-[#febc2e]" />
        <span className="size-3 rounded-full bg-[#28c840]" />
        <span className="flex-1 text-center text-xs text-white/50">dorr — Terminal</span>
        <span className="hidden items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-400/80 sm:flex">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          live
        </span>
      </div>

      <div className="grid h-[440px] grid-cols-12 text-xs">
        {/* chart */}
        <div className="col-span-12 flex flex-col border-white/10 lg:col-span-7 lg:border-r">
          <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
            <span className="font-semibold text-white">ETH/USD</span>
            <span className="text-white/50">
              mark <span className="font-mono text-white">1,874.10</span>
            </span>
            <span className="hidden text-white/50 sm:inline">
              index <span className="font-mono text-white">1,874.10</span>
            </span>
            <span className="ml-auto rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/50">
              vAMM vs Chainlink
            </span>
          </div>
          <Candles />
        </div>

        {/* sealed order flow */}
        <div className="col-span-12 hidden flex-col border-white/10 lg:col-span-5 lg:flex">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
            <Search className="size-3.5 text-white/40" />
            <span className="text-white/70">What the public sees</span>
          </div>
          <div className="flex-1 space-y-1.5 overflow-hidden p-3">
            {ORDERS.map((o) => (
              <div
                key={o.hash}
                className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white/80">{o.market}</span>
                  <span className="inline-flex items-center gap-1 rounded border border-sky-400/30 bg-sky-400/10 px-1.5 py-px text-[9px] uppercase tracking-wider text-sky-300">
                    <Lock className="size-2.5" />
                    sealed
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-white/40">{o.time}</span>
                </div>
                <div className="mt-1 truncate font-mono text-[10px] text-white/35">{o.hash}</div>
              </div>
            ))}
            <p className="pt-1 text-[10px] leading-snug text-white/40">
              No side, no size, no leverage, no price. A 32-byte commitment is the entire public
              record until the order clears.
            </p>
          </div>
        </div>

        {/* positions */}
        <div className="col-span-12 border-t border-white/10">
          <div className="flex items-center gap-3 px-4 py-2.5 text-[10px] uppercase tracking-wider text-white/40">
            <span>Positions</span>
            <span className="rounded bg-white/5 px-1.5 py-px text-white/60">Open 2</span>
            <span className="ml-auto normal-case tracking-normal text-white/50">
              margin <span className="font-mono text-white">210</span>
            </span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-y border-white/10 text-[9px] uppercase tracking-wider text-white/35">
                <th className="px-4 py-1.5 text-left font-normal">Market</th>
                <th className="px-2 py-1.5 text-left font-normal">Side</th>
                <th className="px-2 py-1.5 text-right font-normal">Size</th>
                <th className="hidden px-2 py-1.5 text-right font-normal sm:table-cell">Entry</th>
                <th className="hidden px-2 py-1.5 text-right font-normal md:table-cell">Liq.</th>
                <th className="px-2 py-1.5 text-right font-normal">uPnL</th>
                <th className="px-4 py-1.5 text-right font-normal">Lev</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {POSITIONS.map((p) => (
                <tr key={p.market} className="border-b border-white/[0.06] last:border-0">
                  <td className="px-4 py-2 text-white/80">{p.market}</td>
                  <td className="px-2 py-2">
                    <span
                      className={
                        p.side === "LONG"
                          ? "rounded bg-emerald-500/15 px-1.5 py-px text-[9px] font-semibold text-emerald-400"
                          : "rounded bg-red-500/15 px-1.5 py-px text-[9px] font-semibold text-red-400"
                      }
                    >
                      {p.side}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right text-white/70">{p.size}</td>
                  <td className="hidden px-2 py-2 text-right text-white/70 sm:table-cell">
                    {p.entry}
                  </td>
                  <td className="hidden px-2 py-2 text-right text-amber-400/80 md:table-cell">
                    {p.liq}
                  </td>
                  <td
                    className={`px-2 py-2 text-right ${p.up ? "text-emerald-400" : "text-red-400"}`}
                  >
                    {p.upnl}
                  </td>
                  <td className="px-4 py-2 text-right text-white/60">{p.lev}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* settlement strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/10 bg-black/30 px-4 py-2.5 text-[10px]">
        <span className="inline-flex items-center gap-1.5 text-white/70">
          <Shield className="size-3 text-emerald-400" />
          Settled on chain by KeeperHub
        </span>
        <span className="font-mono text-white/40">0x7822e189…b4376519</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-white/50">
          <Sparkles className="size-3 text-sky-300" />
          private routing · never public
        </span>
      </div>
    </Reveal>
  );
}

/**
 * A candle field.
 *
 * Deterministic — the same shape renders on the server and the client, so it
 * does not flicker on hydration and does not pretend to be live market data.
 */
function Candles() {
  const bars = Array.from({ length: 56 }, (_, i) => {
    const wave = Math.sin(i / 4.2) * 26 + Math.sin(i / 1.7) * 9;
    const drift = i * 0.55;
    const mid = 110 - wave - drift * 0.4;
    const body = 6 + ((i * 37) % 17);
    const up = Math.sin(i / 2.3) > -0.15;
    return { x: i * 10 + 6, mid, body, up, wick: body + 8 + ((i * 13) % 11) };
  });

  return (
    <div className="relative flex-1 overflow-hidden">
      <svg viewBox="0 0 560 190" preserveAspectRatio="none" className="h-full w-full">
        {[38, 76, 114, 152].map((y) => (
          <line key={y} x1="0" y1={y} x2="560" y2={y} stroke="rgba(255,255,255,0.05)" />
        ))}
        {bars.map((b, i) => (
          <g key={i} stroke={b.up ? "#10b981" : "#ef4444"} fill={b.up ? "#10b981" : "#ef4444"}>
            <line x1={b.x + 3} y1={b.mid - b.wick / 2} x2={b.x + 3} y2={b.mid + b.wick / 2} />
            <rect x={b.x} y={b.mid - b.body / 2} width="6" height={b.body} />
          </g>
        ))}
        <line
          x1="0"
          y1="96"
          x2="560"
          y2="96"
          stroke="#22d3ee"
          strokeDasharray="4 4"
          strokeOpacity="0.7"
        />
      </svg>
      <span className="absolute right-2 top-[46%] rounded bg-[#22d3ee] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-black">
        1874.10
      </span>
    </div>
  );
}
