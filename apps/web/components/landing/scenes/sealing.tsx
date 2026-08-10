"use client";

import gsap from "gsap";
import { Eye, EyeOff } from "lucide-react";
import { SCENE, useScene } from "../use-scene";

const ORDER: Array<[string, string]> = [
  ["side", "LONG"],
  ["size", "5.33 ETH"],
  ["leverage", "10×"],
  ["limit", "1,876.59"],
  ["trader", "0x38bE…8214"],
];

const HASH = "c82e45c4093936ec7f4b1a9d0e2f6a8c3d5b7e91a0c4f28d6b13e75904af2c88";
const HEX = "0123456789abcdef";

/**
 * The same order, twice: once on a venue that publishes it, once on dorr.
 *
 * The two panels are the argument, and they are both fully rendered in HTML —
 * the animation only stages *how* each one is read. On the left a searcher's
 * scan line walks the rows and tags each field as it harvests it, because the
 * point is not that the order is visible in the abstract but that every field
 * a searcher needs is sitting there in order. On the right the same 32 bytes
 * settle out of noise, because that is the entire published record.
 *
 * The scramble resolves left to right at a fixed character rate rather than
 * randomising the whole string each frame: it reads as a value being revealed,
 * which is what a commitment opening looks like, instead of as a slot machine.
 */
export function SealingScene() {
  const ref = useScene(({ q, timeline }) => {
    const rows = q("[data-row]");
    const tags = q("[data-tag]");
    const scan = q("[data-scan]")[0];
    const hash = q<HTMLElement>("[data-hash]")[0];
    const lock = q("[data-lock]")[0];
    const verdicts = q("[data-verdict]");

    // ── Left: a searcher walking the order ────────────────────────────────
    gsap.set(scan, { opacity: 0, top: 0 });
    gsap.set(tags, { opacity: 0, x: -4 });
    gsap.set(verdicts, { opacity: 0, y: 6 });

    const left = timeline();
    left
      .to(scan, { opacity: 1, duration: 0.2 })
      .to(scan, { top: "100%", duration: rows.length * 0.16, ease: "none" }, "<");

    rows.forEach((row, i) => {
      left
        .to(row, { color: SCENE.danger, duration: 0.18 }, 0.2 + i * 0.16)
        .to(tags[i], { opacity: 1, x: 0, duration: 0.22 }, 0.2 + i * 0.16);
    });

    left
      .to(scan, { opacity: 0, duration: 0.25 })
      .to(verdicts[0], { opacity: 1, y: 0, duration: 0.4 }, "-=0.1");

    // ── Right: the commitment resolving out of noise ──────────────────────
    if (hash) {
      const proxy = { n: 0 };
      const scramble = timeline({
        scrollTrigger: { trigger: hash, start: "top 78%", once: true },
      });

      scramble
        .to(
          proxy,
          {
            n: HASH.length,
            duration: 1.15,
            ease: "power1.inOut",
            onUpdate: () => {
              const settled = Math.floor(proxy.n);
              let out = HASH.slice(0, settled);
              for (let i = settled; i < HASH.length; i++) {
                out += HEX[(Math.random() * HEX.length) | 0];
              }
              hash.textContent = out;
            },
            onComplete: () => {
              hash.textContent = HASH;
            },
          },
          0,
        )
        .from(lock, { opacity: 0, scale: 0.7, duration: 0.4 }, 0.25)
        .to(verdicts[1], { opacity: 1, y: 0, duration: 0.4 }, ">-0.2");
    }
  });

  return (
    <div ref={ref} className="grid gap-4 sm:grid-cols-2">
      {/* ── the transparent venue ─────────────────────────────────────── */}
      <figure className="liquid-glass relative flex flex-col overflow-hidden rounded-xl p-5">
        <figcaption className="flex items-center gap-2">
          <Eye className="size-3.5 text-red-400" />
          <span className="font-mono text-[11px] uppercase tracking-wider text-red-400">
            Transparent venue
          </span>
        </figcaption>

        <div className="relative mb-5 mt-5">
          {/* the searcher's read head */}
          <div
            data-scan
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-red-400 to-transparent shadow-[0_0_12px_2px_rgba(248,113,113,0.55)]"
          />
          <dl className="space-y-2.5 font-mono text-[13px]">
            {ORDER.map(([k, v]) => (
              <div key={k} data-row className="flex items-center justify-between gap-3 text-white/85">
                <dt className="text-white/35">{k}</dt>
                <dd className="flex items-center gap-2">
                  <span
                    data-tag
                    aria-hidden="true"
                    className="rounded-sm border border-red-400/40 px-1 py-px text-[9px] uppercase tracking-wider text-red-400/90"
                  >
                    read
                  </span>
                  <span className="text-current">{v}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <p
          data-verdict
          className="mt-auto border-t border-white/10 pt-4 text-[12px] leading-[1.55] text-white/45"
        >
          Five fields, and every one of them is a price input. A searcher knows
          your position, your leverage and your limit before you are filled.
        </p>
      </figure>

      {/* ── dorr ──────────────────────────────────────────────────────── */}
      <figure className="liquid-glass flex flex-col overflow-hidden rounded-xl p-5">
        <figcaption className="flex items-center gap-2">
          <EyeOff data-lock className="size-3.5 text-emerald-400" />
          <span className="font-mono text-[11px] uppercase tracking-wider text-emerald-400">
            dorr
          </span>
        </figcaption>

        <p
          data-hash
          className="mb-5 mt-5 break-all font-mono text-[13px] leading-[1.7] text-white/85"
        >
          {HASH}
        </p>

        <p
          data-verdict
          className="mt-auto border-t border-white/10 pt-4 text-[12px] leading-[1.55] text-white/45"
        >
          The same order. Thirty-two bytes, and nothing in them to price — until
          it has already cleared.
        </p>
      </figure>
    </div>
  );
}
