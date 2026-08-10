"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/core";

/**
 * The gradient the headline word wears.
 *
 * Stops run dark → deep blue → pale cyan → cyan → back to dark, over a 200%
 * wide box, so the animation can slide a highlight across the text rather than
 * recolouring it. The noise filter breaks up the banding that a smooth
 * six-stop gradient shows on a wide glyph.
 */
export const gradientStyle: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(to right, #091020 0%, #0B2551 12.5%, #A4F4FD 32.5%, #00d2ff 50%, #0B2551 67.5%, #091020 87.5%, #091020 100%)",
  backgroundSize: "200% auto",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
  WebkitTextFillColor: "transparent",
  filter: "url(#c3-noise)",
};

/** The grain filter the headline and the watermark both reference. */
export function NoiseFilter() {
  return (
    <svg className="absolute h-0 w-0" aria-hidden="true">
      <filter id="c3-noise">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
        <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.35 0" />
        <feComposite in2="SourceGraphic" operator="in" result="noise" />
        <feBlend in="SourceGraphic" in2="noise" mode="multiply" />
      </filter>
    </svg>
  );
}

/**
 * The page's one call to action.
 *
 * It goes to the running terminal rather than a download, because there is
 * nothing to install — the thing being sold is a live venue.
 */
export function PrimaryCta({
  label = "Open the terminal",
  href = "/trade",
  full = false,
}: {
  label?: string;
  href?: string;
  full?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-black transition-all hover:bg-white/90 active:scale-[0.98]",
        full && "w-full",
      )}
    >
      {label}
      <ChevronRight className="size-4 transition-transform group-hover:translate-x-px" />
    </Link>
  );
}

export function SecondaryCta({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center justify-center gap-2 rounded-full border border-white/15 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-white/5"
    >
      {label}
      <ChevronRight className="size-4 transition-transform group-hover:translate-x-px" />
    </Link>
  );
}

export function SectionEyebrow({ label, tag }: { label: string; tag?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="size-1.5 rounded-full bg-white" />
      <span className="font-medium text-white/70">{label}</span>
      {tag && (
        <span className="rounded-full border border-white/10 px-2 py-0.5 text-white/50">{tag}</span>
      )}
    </div>
  );
}
