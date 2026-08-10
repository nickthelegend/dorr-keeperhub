"use client";

import Link from "next/link";
import { ArrowUpRight, Eye, Lock } from "lucide-react";
import { Reveal } from "./reveal";

/**
 * The product shot.
 *
 * Real 2×/3× captures of the running terminal, not a rebuilt facsimile — the
 * hashes, sizes, addresses and timestamps in them are the ones that were on
 * screen when they were taken. The window chrome is drawn here rather than
 * captured, so the shots stay pure product and the frame can carry the caption.
 *
 * Two of them, because one does not survive both ends of the range. The full
 * terminal is the right image on a laptop and unreadable on a phone: four dense
 * panels squeezed into 340px is texture, and a screenshot nobody can read is
 * decoration pretending to be evidence. Below sm the shot narrows to the single
 * panel that carries the argument — five sealed orders showing nothing but a
 * hash each, and one public order showing its side, size, leverage and the
 * address behind it, labelled FULLY VISIBLE — FRONTRUNNABLE.
 *
 * <picture> rather than two next/image elements: a hidden <img> is still
 * downloaded, so the toggle-with-CSS version would ship both files to everyone.
 * The aspect ratios are pinned per breakpoint so neither swap moves the page.
 */
export function ProductShot() {
  return (
    <Reveal y={28}>
      <figure className="relative">
        {/*
          The shot sits in its own light. Two lobes of the headline's own blue
          bleeding out from behind the frame, plus a hairline of it along the
          top edge where a screen would actually catch it — enough to lift the
          panel off a near-black page and tie it to the palette, and diffuse
          enough that it never competes with the screenshot for attention.
        */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-x-24 -bottom-16 -top-24"
        >
          <div
            className="absolute inset-0 blur-[70px]"
            style={{
              background:
                "radial-gradient(58% 62% at 26% 8%, rgba(0,210,255,0.38), transparent 68%), radial-gradient(52% 58% at 80% 16%, rgba(74,127,193,0.42), transparent 70%), radial-gradient(70% 45% at 50% 100%, rgba(56,189,248,0.28), transparent 72%)",
            }}
          />
        </div>

        <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[#0b0d11] shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9),0_0_0_1px_rgba(56,189,248,0.10),0_24px_90px_-30px_rgba(0,180,255,0.28)]">
          {/* the light catching the top bezel */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-sky-300/50 to-transparent"
          />
          {/* window chrome */}
          <div className="flex items-center gap-2 border-b border-white/[0.07] bg-white/[0.02] px-4 py-2.5">
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
            <span className="flex-1 text-center font-mono text-[11px] text-white/40">
              dorr — Terminal · Sepolia
            </span>
            <span className="hidden items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-emerald-400/90 sm:flex">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              live
            </span>
          </div>

          <picture>
            <source media="(min-width: 640px)" type="image/webp" srcSet="/shots/terminal.webp" />
            <source media="(min-width: 640px)" srcSet="/shots/terminal.png" />
            <source type="image/webp" srcSet="/shots/feed.webp" />
            <img
              src="/shots/feed.png"
              alt="The dorr order feed as an outsider sees it: five orders listed only as 32-byte hashes and marked private, and beneath them one public order showing its side, size, leverage and the trader's address, labelled fully visible and frontrunnable."
              width={1092}
              height={1482}
              fetchPriority="high"
              decoding="async"
              className="aspect-[1092/1482] w-full sm:aspect-[3840/1972]"
            />
          </picture>
        </div>

        <figcaption className="mt-5 flex flex-col items-center gap-y-2 text-xs text-white/45 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-6">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3 shrink-0 text-sky-300" />
            five sealed orders — a hash each
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Eye className="size-3 shrink-0 text-red-400" />
            one public foil — fully visible
          </span>
          <Link
            href="/trade"
            className="inline-flex items-center gap-1 text-white/70 underline-offset-4 transition-colors hover:text-white hover:underline"
          >
            open the real thing
            <ArrowUpRight className="size-3 shrink-0" />
          </Link>
        </figcaption>
      </figure>
    </Reveal>
  );
}
