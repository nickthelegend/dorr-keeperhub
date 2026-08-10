"use client";

import { useRef, useState } from "react";
import gsap from "gsap";
import { Eye, EyeOff, RotateCw } from "lucide-react";
import { SCENE, useScene } from "../use-scene";

/**
 * One swap, two routes — the duel the leaderboard measures, drawn.
 *
 * The public lane is the interesting half: the trade is visible in the mempool
 * long enough for a searcher to buy in front of it and sell behind it, and the
 * gap between the price it should have got and the price it did is what lands
 * in the table underneath. The private lane is deliberately boring, because
 * that is the finding — the same swap, nothing taken.
 *
 * Rendered complete: the sandwich is already in place, both amounts already
 * read, so the panel is a legible diagram before a single tween runs. The
 * timeline rewinds it and plays it back, which is why there is a replay
 * control — the sequence is an explanation, and an explanation you scrolled
 * past too fast is worth being able to ask for again.
 */
export function LanesScene() {
  const tl = useRef<gsap.core.Timeline | null>(null);
  const [replays, setReplays] = useState(0);

  const ref = useScene(
    ({ q, timeline }) => {
      const pub = {
        chip: q("[data-pub-chip]")[0],
        front: q("[data-front]")[0],
        back: q("[data-back]")[0],
        bite: q("[data-bite]")[0],
        amount: q<HTMLElement>("[data-pub-amount]")[0],
        eye: q("[data-pub-eye]")[0],
      };
      const priv = {
        chip: q("[data-priv-chip]")[0],
        amount: q<HTMLElement>("[data-priv-amount]")[0],
        eye: q("[data-priv-eye]")[0],
        miss: q("[data-priv-miss]")[0],
      };

      // Rewind the rendered diagram to its opening frame.
      gsap.set([pub.chip, priv.chip], { left: "0%", xPercent: 0 });
      gsap.set([pub.front, pub.back], { opacity: 0, scale: 0.6 });
      gsap.set(pub.bite, { scaleX: 0, transformOrigin: "left center" });
      gsap.set([pub.eye, priv.eye, priv.miss], { opacity: 0, y: -6 });
      gsap.set([pub.amount, priv.amount], { opacity: 0 });

      const money = { v: 0 };
      const t = timeline({ defaults: { ease: "power2.out", duration: 0.45 } });
      tl.current = t;

      // ── public lane ──────────────────────────────────────────────────
      t.to(pub.chip, { left: "38%", duration: 1.0, ease: "none" }, 0)
        .to(pub.eye, { opacity: 1, y: 0, duration: 0.3 }, 0.35)
        // the searcher gets in front, then closes the trap behind
        .to(pub.front, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2)" }, 0.75)
        .to(pub.back, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2)" }, 0.95)
        .to(pub.bite, { scaleX: 1, duration: 0.5 }, 0.95)
        .to(
          money,
          {
            v: 972.73,
            duration: 0.7,
            ease: "power2.out",
            onUpdate: () => {
              if (pub.amount) {
                pub.amount.textContent = `−$${money.v.toFixed(2)}`;
              }
            },
          },
          1.05,
        )
        .to(pub.amount, { opacity: 1, duration: 0.3 }, 1.05)
        .to(pub.chip, { left: "100%", xPercent: -100, duration: 0.8, ease: "none" }, 1.5)

        // ── private lane ───────────────────────────────────────────────
        .to(priv.chip, { left: "38%", duration: 1.0, ease: "none" }, 0.4)
        .to(priv.eye, { opacity: 1, y: 0, duration: 0.3 }, 0.75)
        .to(priv.miss, { opacity: 1, y: 0, duration: 0.35, ease: "back.out(2)" }, 1.25)
        .to(priv.chip, { left: "100%", xPercent: -100, duration: 0.8, ease: "none" }, 1.5)
        .to(priv.amount, { opacity: 1, duration: 0.35 }, 1.9);
    },
    [replays],
  );

  return (
    <div ref={ref} className="liquid-glass rounded-xl p-5 sm:p-6">
      {/*
        The replay control lives in a header row of its own. Floated into the
        panel corner it landed on top of the public lane's amount — which is
        the number the whole diagram exists to deliver.
      */}
      <div className="mb-6 flex items-center justify-between gap-4 border-b border-white/[0.07] pb-4">
        <span className="font-mono text-[10px] uppercase tracking-wider text-white/40">
          One swap, two routes
        </span>
        <button
          type="button"
          onClick={() => {
            if (tl.current) tl.current.restart();
            else setReplays((n) => n + 1);
          }}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-white/45 transition-colors hover:border-white/25 hover:text-white/80"
        >
          <RotateCw className="size-3" />
          replay
        </button>
      </div>

      <Lane
        label="Public mempool"
        tone="danger"
        amountSlot={
          <span data-pub-amount className="font-mono text-[13px] tabular-nums text-red-400">
            −$972.73
          </span>
        }
      >
        <span
          data-pub-eye
          className="absolute -top-6 left-[38%] inline-flex -translate-x-1/2 items-center gap-1 whitespace-nowrap font-mono text-[9px] uppercase tracking-wider text-red-400/90"
        >
          <Eye className="size-2.5" />
          seen
        </span>

        {/* the span of the trade the sandwich closes over */}
        <span
          data-bite
          aria-hidden="true"
          className="absolute inset-y-0 left-[30%] w-[22%] rounded-full bg-red-400/15"
        />
        <span
          data-front
          className="absolute left-[30%] top-1/2 size-2.5 -translate-y-1/2 rounded-[3px] bg-red-400"
          title="searcher buys in front"
        />
        <span
          data-back
          className="absolute left-[52%] top-1/2 size-2.5 -translate-y-1/2 rounded-[3px] bg-red-400"
          title="searcher sells behind"
        />
        <span
          data-pub-chip
          className="absolute left-full top-1/2 -translate-x-full -translate-y-1/2 rounded-full bg-white px-2.5 py-1 font-mono text-[10px] font-medium text-black shadow-[0_0_0_3px_rgba(248,113,113,0.25)]"
        >
          25 mETH
        </span>
      </Lane>

      <div className="my-5 h-px bg-white/[0.07]" />

      <Lane
        label="KeeperHub private"
        tone="safe"
        amountSlot={
          <span data-priv-amount className="font-mono text-[13px] tabular-nums text-emerald-400">
            $0.00
          </span>
        }
      >
        <span
          data-priv-eye
          className="absolute -top-6 left-[38%] inline-flex -translate-x-1/2 items-center gap-1 whitespace-nowrap font-mono text-[9px] uppercase tracking-wider text-white/35"
        >
          <EyeOff className="size-2.5" />
          not in the mempool
        </span>
        {/*
          Below the rail, not on it. Sitting at 62% of the track this badge ran
          straight under the chip once the chip reached the right-hand end — on
          a phone the two overlapped into an unreadable smear.
        */}
        <span
          data-priv-miss
          className="absolute -bottom-6 left-0 inline-flex items-center whitespace-nowrap rounded-sm border border-emerald-400/30 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-emerald-400/90"
        >
          nothing to front-run
        </span>
        <span
          data-priv-chip
          className="absolute left-full top-1/2 -translate-x-full -translate-y-1/2 rounded-full bg-white px-2.5 py-1 font-mono text-[10px] font-medium text-black shadow-[0_0_0_3px_rgba(52,211,153,0.25)]"
        >
          25 mETH
        </span>
      </Lane>
      {/* room for the badge that now hangs below the private rail */}
      <div className="h-6" />

      <p className="mt-5 text-[12px] leading-[1.6] text-white/40">
        One real duel, drawn to scale of the story rather than the clock: the
        same 25 mETH swap, sent twice, with a searcher watching both.
      </p>
    </div>
  );
}

function Lane({
  label,
  tone,
  amountSlot,
  children,
}: {
  label: string;
  tone: "danger" | "safe";
  amountSlot: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-7 flex items-baseline justify-between gap-3">
        <span
          className={`font-mono text-[10px] uppercase tracking-wider ${
            tone === "danger" ? "text-red-400/80" : "text-emerald-400/80"
          }`}
        >
          {label}
        </span>
        {amountSlot}
      </div>
      <div className="relative h-8">
        {/* the rail */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-white/5 via-white/15 to-white/5"
        />
        {children}
      </div>
    </div>
  );
}

/** Kept alongside the palette so the two lanes cannot drift out of sync. */
export const LANE_TONES = SCENE;
