"use client";

import Link from "next/link";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { useState } from "react";
import DorrMark from "@/components/icons/dorr-mark";
import { ProductShot } from "./product-shot";
import { BoundaryScene } from "./scenes/boundary";
import { LanesScene } from "./scenes/lanes";
import { SealingScene } from "./scenes/sealing";
import {
  NoiseFilter,
  PrimaryCta,
  SecondaryCta,
  SectionHero,
  gradientStyle,
} from "./primitives";

/**
 * Section anchors.
 *
 * One list drives the nav, the mobile sheet, and the `id` on each section, so a
 * link can never point at an anchor that does not exist.
 */
const SECTIONS = [
  { id: "terminal", label: "The terminal" },
  { id: "sealed", label: "How it hides" },
  { id: "receipts", label: "Receipts" },
  { id: "trust", label: "Trust model" },
] as const;

export function Landing() {
  return (
    /*
      overflow-x-CLIP, not hidden. `hidden` on one axis forces the other axis to
      compute as `auto`, which turned this wrapper into a scroll container that
      has nothing to scroll — and because the app sets `overscroll-none`
      globally, the browser refused to chain the wheel past it to <html>. The
      page simply did not scroll. `clip` does the same visual job without ever
      creating a scroll container, so the wheel reaches the document.
    */
    <div className="landing-root relative min-h-screen overflow-x-clip bg-[#0c0c0c] text-white">
      <NoiseFilter />
      <Backdrop />

      <div className="relative z-10">
        <Header />
        <main>
          <Hero />
          <Terminal />
          <Sealed />
          <Receipts />
          <Trust />
          <Close />
        </main>
        <Footer />
      </div>
    </div>
  );
}

/**
 * The ambient layer.
 *
 * Two scrims over the clip, because one is not enough: it is a moving light
 * source, and on its bright frames a single flat overlay leaves body copy
 * unreadable. Legibility must not depend on which frame happens to be playing.
 *
 * A full-bleed loop is also the exact thing `prefers-reduced-motion` exists to
 * stop, so it holds on its first frame for anyone who asked for that. The page
 * is designed to work without it either way — the codec is not guaranteed, and
 * the base colour underneath is the same #0c0c0c.
 */
function Backdrop() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
      <video
        autoPlay={!reduceMotion}
        loop={!reduceMotion}
        muted
        playsInline
        preload="auto"
        className="h-full w-full object-cover opacity-40"
        src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260508_064122_c4750c0e-7476-4b44-94a2-a85a65c63bf2.mp4"
      />
      <div className="absolute inset-0 bg-[#0c0c0c]/80" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#0c0c0c] via-[#0c0c0c]/60 to-[#0c0c0c]" />
    </div>
  );
}

/**
 * One header.
 *
 * There used to be two — this bar plus a decorative macOS menu strip beneath
 * it — and at a glance they read as a broken duplicate rather than as chrome
 * plus ornament. The "this is a desktop app" job now belongs to the window
 * frame around the product shot, which is the one place it is actually true.
 */
function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#0c0c0c]/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-6">
        <Link
          href="/"
          aria-label="dorr — home"
          className="flex shrink-0 items-center gap-2.5 transition-opacity hover:opacity-70"
        >
          <DorrMark className="size-6 text-white" />
          <span className="text-[15px] font-semibold tracking-tight">dorr</span>
        </Link>

        <nav aria-label="Sections" className="ml-2 hidden items-center gap-1 md:flex">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded-md px-3 py-2 text-sm text-white/60 transition-colors hover:bg-white/5 hover:text-white"
            >
              {s.label}
            </a>
          ))}
          {/*
            Link, not a bare anchor: the section links above are in-page
            fragments, but this one is a route, and an <a> would throw away the
            client-side transition and reload the whole app. No trailing arrow
            either — that glyph reads as "leaves the site", and /mev does not.
          */}
          <Link
            href="/mev"
            className="ml-1 rounded-md px-3 py-2 text-sm text-white/60 transition-colors hover:bg-white/5 hover:text-white"
          >
            MEV Shield
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden sm:block">
            <PrimaryCta label="Open the terminal" />
          </div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="grid size-10 place-items-center rounded-full border border-white/10 bg-white/5 md:hidden"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {open && (
        <nav
          id="mobile-nav"
          aria-label="Sections"
          className="border-t border-white/[0.06] bg-[#0c0c0c]/95 px-6 py-3 md:hidden"
        >
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={() => setOpen(false)}
              className="block rounded-md px-2 py-2.5 text-sm text-white/70 hover:bg-white/5 hover:text-white"
            >
              {s.label}
            </a>
          ))}
          <Link
            href="/mev"
            onClick={() => setOpen(false)}
            className="block rounded-md px-2 py-2.5 text-sm text-white/70 hover:bg-white/5 hover:text-white"
          >
            MEV Shield
          </Link>
          <div className="px-2 pb-1 pt-3 sm:hidden">
            <PrimaryCta label="Open the terminal" full />
          </div>
        </nav>
      )}
    </header>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-6 pb-14 pt-20 text-center md:pb-20 md:pt-32">
      {/*
        No entrance on the headline. The one authored moment on this page is the
        terminal rising into place below it; a fade on every element competes
        with that and delays the sentence that has to land first.
      */}
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
        Perpetual futures · Ethereum Sepolia
      </p>

      <h1 className="mx-auto mt-6 max-w-4xl text-[2.6rem] font-semibold leading-[0.95] tracking-[-0.035em] md:text-[5.25rem]">
        Your order is
        <br />
        <span className="animate-shiny" style={gradientStyle}>
          nobody&apos;s business
        </span>
      </h1>

      <p className="mx-auto mt-7 max-w-xl text-pretty text-[17px] leading-[1.6] text-white/60">
        Every public order book tells a searcher what you are about to do and
        exactly what it is worth to beat you there. dorr publishes a 32-byte
        hash instead — and settles your PnL on chain through KeeperHub, so the
        venue that hides your order still cannot touch it.
      </p>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <PrimaryCta label="Open the terminal" />
        <SecondaryCta label="See what the mempool costs" href="/mev" />
      </div>

      <p className="mt-5 font-mono text-[11px] text-white/35">
        live on testnet · no signup · no wallet needed to look
      </p>
    </section>
  );
}

function Terminal() {
  return (
    <section id="terminal" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-10 md:py-16">
      {/*
        A heading here, because "The terminal" is a nav destination and landing
        on a bare screenshot tells a deep-linked reader nothing about where they
        are. Centred, since the shot below it is centred and symmetrical.
      */}
      <SectionHero
        index="01"
        eyebrow="The terminal"
        title="It is already running."
        lede="Live on Sepolia against Chainlink marks, with real collateral in a real vault. No signup, and no wallet needed to watch."
        align="center"
      />
      <div className="mt-12">
        <ProductShot />
      </div>
    </section>
  );
}

function Sealed() {
  return (
    <section id="sealed" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-20 md:py-28">
      <SectionHero
        index="02"
        eyebrow="How it hides"
        title={
          <>
            There is nothing
            <br />
            to front-run.
          </>
        }
        lede="Matching happens off chain, so an order never sits in a mempool waiting to be read. What gets published is a commitment — the hash of your side, size, price, leverage and a 128-bit nonce."
      />

      <div className="mt-14">
        <SealingScene />
      </div>

      <dl className="mt-12 grid gap-8 border-t border-white/10 pt-10 sm:grid-cols-3">
        {[
          ["Stops", "Never published. A stop you can see is a stop you can hunt."],
          ["Epochs", "Sealed bids clear at one uniform price, so cutting the queue buys nothing."],
          ["Disclosure", "Open a past order to an auditor of your choosing, and to nobody else."],
        ].map(([term, def]) => (
          <div key={term}>
            <dt className="font-mono text-[11px] uppercase tracking-wider text-white/40">{term}</dt>
            <dd className="mt-2.5 text-[13px] leading-[1.6] text-white/55">{def}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-10 max-w-xl text-[13px] leading-[1.6] text-white/40">
        Seal it to a future drand round and not even we can open it early.
      </p>
    </section>
  );
}

/**
 * The measured results, as a ledger.
 *
 * Deliberately not four stat cards with an accent colour — that shape reads as
 * marketing furniture and invites a skim past the numbers that are the whole
 * point. These are rows: each one a run that happened, with what each lane gave
 * up and a hash to check it against. Including the run our own searcher lost.
 *
 * Every figure here is read out of services/operator/data/mev.sqlite and agrees
 * with what /mev computes from the same table — 22 duels, 15 landed sandwiches,
 * $2,771.87 out of the public lane, nothing out of the private one. An earlier
 * draft of this section quoted a duel count that was off by one and printed the
 * public-lane total twice under two different headings; both are the kind of
 * thing a reader checks first, so they are pinned to the database now.
 */
function Receipts() {
  const rows = [
    { size: "25.00 mETH", pub: "$972.73", sandwich: true },
    { size: "12.00 mETH", pub: "$235.01", sandwich: true },
    { size: "10.00 mETH", pub: "$197.62", sandwich: true },
    { size: "8.00 mETH", pub: "$119.06", sandwich: true },
    { size: "10.00 mETH", pub: "$0.00", sandwich: false },
  ];

  return (
    <section
      id="receipts"
      className="mx-auto max-w-6xl scroll-mt-24 border-t border-white/10 px-6 py-20 md:py-28"
    >
      <SectionHero
        index="03"
        eyebrow="Receipts"
        title={
          <>
            We put a price
            <br />
            on the mempool.
          </>
        }
        lede={
          <>
            The same swap, run twice — once through the public mempool, once
            through KeeperHub&apos;s private routing — with a real searcher bot
            hunting it on its own key and its own gas. The gap between the two
            is the invoice.
          </>
        }
      />

      <div className="mt-14">
        <LanesScene />
      </div>

      {/*
        The totals read across the full measure and the ledger runs full width
        beneath them. As a two-column split the prose ran out after four lines
        and left most of a screen of empty column beside a table that had room
        to spare — the diagram above now carries the visual weight this layout
        was trying to balance.
      */}
      <div className="mt-16 flex flex-wrap items-baseline justify-between gap-x-10 gap-y-4">
        <p className="max-w-xl text-[15px] leading-[1.65] text-white/60">
          Across 22 duels the public lane gave up{" "}
          <strong className="font-semibold text-white">$2,771.87</strong> —
          fifteen sandwiches landed on it. The private lane was never sandwiched
          once.
        </p>
        <Link
          href="/mev"
          className="inline-flex shrink-0 items-center gap-1.5 text-sm text-white/75 underline-offset-4 transition-colors hover:text-white hover:underline"
        >
          Run one yourself
          <ArrowUpRight className="size-3.5" />
        </Link>
      </div>

      <div className="mt-10">
        {/*
          min-w-0 stays even now the table is full width: any flex or grid item
          defaults to min-width:auto, so the table's own minimum could still
          push the section wider than a phone, and the page clips rather than
          scrolls. Letting this box shrink below its content keeps the overflow
          where it belongs.
        */}
        <div className="min-w-0">
          {/*
            Three columns on a phone, four from sm up. The point of this table
            is the second money column sitting at zero next to the first, so it
            has to survive a 390px screen — a four-column table only fits there
            by scrolling, and the column that scrolls out of sight is precisely
            the one carrying the argument. The searcher's result moves into the
            trade cell at that size instead; exactly one of the two is in the
            accessibility tree at any width, because the other is display:none.
          */}
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Recent duels: what the public lane gave up to a sandwich, what the
              private lane gave up, and whether our searcher landed the attack
            </caption>
            <thead>
              <tr className="border-b border-white/10">
                <th
                  scope="col"
                  className="pb-3 font-mono text-[10px] font-normal uppercase tracking-wider text-white/35"
                >
                  Trade
                </th>
                <th
                  scope="col"
                  className="pb-3 text-right font-mono text-[10px] font-normal uppercase tracking-wider text-white/35"
                >
                  Public<span className="hidden sm:inline"> lane</span>
                </th>
                <th
                  scope="col"
                  className="pb-3 text-right font-mono text-[10px] font-normal uppercase tracking-wider text-white/35"
                >
                  Private<span className="hidden sm:inline"> lane</span>
                </th>
                <th
                  scope="col"
                  className="hidden pb-3 text-right font-mono text-[10px] font-normal uppercase tracking-wider text-white/35 sm:table-cell"
                >
                  Searcher
                </th>
              </tr>
            </thead>
            <tbody className="font-mono text-[13px]">
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-white/[0.06] last:border-0">
                  <th scope="row" className="py-3.5 pr-3 text-left font-normal text-white/70">
                    {r.size}
                    <span
                      className={`ml-2 text-[10px] uppercase tracking-wider sm:hidden ${
                        r.sandwich ? "text-white/45" : "text-white/25"
                      }`}
                    >
                      {r.sandwich ? "landed" : "missed"}
                    </span>
                  </th>
                  <td
                    className={`py-3.5 text-right tabular-nums ${
                      r.sandwich ? "text-red-400" : "text-white/35"
                    }`}
                  >
                    {r.pub}
                  </td>
                  {/* The column that never moves. That is the entire finding. */}
                  <td className="py-3.5 pl-3 text-right tabular-nums text-emerald-400/90">
                    $0.00
                  </td>
                  <td className="hidden py-3.5 pl-3 text-right text-[11px] uppercase tracking-wider sm:table-cell">
                    {r.sandwich ? (
                      <span className="text-white/60">landed</span>
                    ) : (
                      <span className="text-white/30">missed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-5 text-[12px] leading-[1.6] text-white/40">
            The four costliest runs, and one the searcher never got to — it
            missed seven of the twenty-two, and those stay in the total. One
            private-lane transaction did surface in the mempool; nothing was
            taken off it. Both hashes for every duel are on the{" "}
            <Link
              href="/mev"
              className="text-white/60 underline underline-offset-2 hover:text-white"
            >
              live leaderboard
            </Link>
            .
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * The trust boundary.
 *
 * A table, because the content is a mapping — claim, who holds it, what stops
 * us — and a mapping wants columns rather than three reassuring cards.
 */
function Trust() {
  const rows: Array<[string, string, string]> = [
    [
      "Your collateral",
      "DorrVault on Sepolia",
      "Only the depositor can withdraw. The contract has no token-moving admin function.",
    ],
    ["Your balance", "The vault", "The operator reads accountOf. It has no way to write it."],
    [
      "Your PnL",
      "KeeperHub's wallet",
      "applyPnl is onlySettlement, and every batch must sum to zero — checked on chain.",
    ],
    [
      "Your order",
      "You, until it clears",
      "Sealed to a future drand round. The operator cannot read it early either.",
    ],
  ];

  return (
    <section
      id="trust"
      className="mx-auto max-w-6xl scroll-mt-24 border-t border-white/10 px-6 py-20 md:py-28"
    >
      <SectionHero
        index="04"
        eyebrow="Trust model"
        title={
          <>
            We can work out what you are owed.
            <span className="text-white/40"> We cannot pay it.</span>
          </>
        }
        lede="Off-chain matching is what makes the privacy possible, and it means the operator alone knows the book. That is precisely why the contracts give it nothing to act on."
      />

      <div className="mt-14">
        <BoundaryScene />
      </div>

      <dl className="mt-16 border-t border-white/10">
        {rows.map(([claim, who, guard]) => (
          <div
            key={claim}
            className="grid gap-2 border-b border-white/10 py-6 md:grid-cols-12 md:items-baseline md:gap-8"
          >
            <dt className="text-[15px] font-semibold text-white md:col-span-3">{claim}</dt>
            <dd className="font-mono text-[13px] text-white/60 md:col-span-3">{who}</dd>
            <dd className="text-[13px] leading-[1.6] text-white/50 md:col-span-6">{guard}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-8 max-w-xl text-[13px] leading-[1.6] text-white/40">
        The matching engine itself is trusted — it sees the book, because that is
        what lets it match. We say so plainly rather than claiming a
        trustlessness the code does not have.
      </p>
    </section>
  );
}

function Close() {
  return (
    <section className="mx-auto max-w-6xl px-6 pb-24 pt-10 md:pb-32">
      <div className="liquid-glass relative overflow-hidden rounded-2xl px-8 py-16 text-center md:py-24">
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            background:
              "radial-gradient(600px circle at 50% 0%, rgba(255,255,255,0.14), transparent 70%)",
          }}
        />
        <div className="relative">
          <h2 className="mx-auto max-w-2xl text-pretty text-[2.25rem] font-semibold leading-[1.05] tracking-[-0.03em] md:text-[3.25rem]">
            Stop announcing your trades.
          </h2>
          <p className="mx-auto mt-6 max-w-md text-[15px] leading-[1.6] text-white/60">
            Open the terminal, place an order, and watch the public feed while
            you do it. A hash is all it will ever show.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <PrimaryCta label="Open the terminal" />
            <SecondaryCta
              label="Read the architecture"
              href="https://github.com/nickthelegend/dorr-keeperhub"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
        <div className="flex items-center gap-2.5">
          <DorrMark className="size-4 text-white/50" />
          <span className="text-[12px] text-white/35">
            Testnet software. mUSD is a faucet token and is not worth anything.
          </span>
        </div>
        <nav aria-label="Footer" className="flex items-center gap-5 text-[12px] text-white/50">
          <Link href="/trade" className="hover:text-white">
            Terminal
          </Link>
          <Link href="/mev" className="hover:text-white">
            MEV Shield
          </Link>
          <a
            href="https://github.com/nickthelegend/dorr-keeperhub"
            target="_blank"
            rel="noreferrer"
            className="hover:text-white"
          >
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
