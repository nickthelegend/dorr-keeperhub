"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Eye, EyeOff, Lock, Menu, Search, Shield } from "lucide-react";
import DorrMark from "@/components/icons/dorr-mark";
import { TerminalMockup } from "./terminal-mockup";
import { Reveal } from "./reveal";
import {
  NoiseFilter,
  PrimaryCta,
  SecondaryCta,
  SectionEyebrow,
  gradientStyle,
} from "./primitives";

const NAV_LINKS = [
  { label: "Terminal", href: "/trade" },
  { label: "MEV Shield", href: "/mev" },
  { label: "Architecture", href: "https://github.com/nickthelegend/dorr-keeperhub/blob/main/docs/ARCHITECTURE.md" },
  { label: "Security", href: "https://github.com/nickthelegend/dorr-keeperhub/blob/main/docs/SECURITY.md" },
];

const MENU_ITEMS = ["File", "Edit", "View", "Markets", "Window", "Help"];

const STACK = [
  "Ethereum Sepolia",
  "KeeperHub",
  "Chainlink",
  "Foundry",
  "viem",
  "drand",
  "Next.js",
  "Bun",
];

export function Landing() {
  return (
    <div className="landing-root relative min-h-screen overflow-x-hidden bg-[#0c0c0c] text-white">
      <NoiseFilter />

      {/* Ambient background. Decorative only — the page is fully legible if it
          never loads, and it is pinned behind everything and non-interactive. */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <video
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
          className="pointer-events-none h-full w-full object-cover opacity-40"
          src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260508_064122_c4750c0e-7476-4b44-94a2-a85a65c63bf2.mp4"
        />
        {/*
          Two scrims, because one is not enough. The clip is a moving light
          source: on its dark frames a single flat overlay is plenty, and on its
          bright frames the same overlay leaves body copy unreadable. Legibility
          cannot depend on which frame happens to be playing, so a flat base
          floors the whole thing and a vertical gradient adds extra weight
          behind the headline and the footer where text density is highest.
        */}
        <div className="absolute inset-0 bg-[#0c0c0c]/80" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0c0c0c] via-[#0c0c0c]/55 to-[#0c0c0c]" />
      </div>

      {/* Guide rails at the content edges. */}
      <div className="pointer-events-none fixed inset-y-0 left-1/2 z-[5] hidden w-px -translate-x-[calc(50%+36rem)] bg-white/10 md:block" />
      <div className="pointer-events-none fixed inset-y-0 left-1/2 z-[5] hidden w-px translate-x-[calc(-50%+36rem)] bg-white/10 md:block" />

      <div className="relative z-10">
        <Navbar />
        <Hero />
        <MenuBar />

        <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
          <TerminalMockup />
        </section>

        <SealedOrders />
        <StackCloud />
        <Receipts />
        <Disclosure />
        <FinalCta />
        <Footer />
      </div>
    </div>
  );
}

function Navbar() {
  return (
    <motion.nav
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="mx-auto max-w-6xl px-6 py-5"
    >
      <div className="flex items-center justify-between">
        <Link href="/" aria-label="dorr — home" className="transition-opacity hover:opacity-80">
          <DorrMark className="size-8 text-white" title="dorr" />
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((l, i) => (
            <motion.div
              key={l.label}
              initial={false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 + i * 0.05 }}
            >
              <Link
                href={l.href}
                className="text-sm font-medium text-white/70 transition-colors hover:text-white"
              >
                {l.label}
              </Link>
            </motion.div>
          ))}
        </div>

        <div className="hidden md:block">
          <PrimaryCta />
        </div>

        <Link
          href="/trade"
          aria-label="Open the terminal"
          className="grid size-10 place-items-center rounded-full border border-white/10 bg-white/5 md:hidden"
        >
          <Menu className="size-4" />
        </Link>
      </div>
    </motion.nav>
  );
}

function Hero() {
  return (
    <section className="flex flex-col items-center px-6 pb-20 pt-16 text-center md:pt-28">
      <motion.h1
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="text-4xl font-semibold leading-[0.9] tracking-tight md:text-7xl"
      >
        <span className="block">Your order.</span>
        <span className="animate-shiny mt-2 block" style={gradientStyle}>
          Invisible
        </span>
      </motion.h1>

      <motion.p
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="mt-8 max-w-md text-base leading-[1.5] text-white/60"
      >
        dorr is a perpetual futures venue where what you are about to do is not
        public. Orders are commitments, stops are never published, and PnL settles
        on chain through KeeperHub — not on our word.
      </motion.p>

      <motion.div
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="mt-10 flex flex-col items-center gap-3"
      >
        <div className="flex flex-wrap items-center justify-center gap-3">
          <PrimaryCta />
          <SecondaryCta label="See the cost, measured" href="/mev" />
        </div>
        <p className="text-xs text-white/40">
          Live on Ethereum Sepolia · no signup · no wallet needed to look
        </p>
      </motion.div>
    </section>
  );
}

function MenuBar() {
  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, delay: 0.9 }}
      className="h-10 border-y border-white/10 bg-black/40 backdrop-blur-md"
    >
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-6 text-xs">
        <div className="flex items-center gap-4">
          <DorrMark className="size-3.5 text-white" />
          <span className="font-bold text-white">dorr</span>
          {MENU_ITEMS.map((m, i) => (
            <span
              key={m}
              className={`text-white/60 ${i > 2 ? "hidden sm:inline" : ""} ${i > 3 ? "hidden md:inline" : ""}`}
            >
              {m}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 text-white/50">
          <Search className="size-3.5" />
          <span className="hidden sm:inline">Sepolia · Chainlink · KeeperHub</span>
        </div>
      </div>
    </motion.div>
  );
}

function SealedOrders() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20 md:py-28">
      <div className="grid items-start gap-10 md:grid-cols-2 md:gap-16">
        <Reveal y={20}
        >
          <SectionEyebrow label="Sealed orders" tag="commit–reveal" />
          <h2 className="mt-5 text-3xl font-semibold leading-[1.02] tracking-tight md:text-5xl">
            Nothing to front-run
            <br />
            if there is nothing to see.
          </h2>
          <p className="mt-6 max-w-md text-base leading-[1.6] text-white/60">
            A public order book tells every searcher what you are about to do and
            how much it is worth to beat you there. dorr publishes a 32-byte hash
            instead. Matching happens off chain, so there is no pending
            transaction to observe, reorder, or sandwich.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            {["Hidden stops", "Sealed to a drand round", "Uniform-price epochs", "Selective disclosure"].map(
              (c) => (
                <span
                  key={c}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/70"
                >
                  {c}
                </span>
              ),
            )}
          </div>
        </Reveal>

        <Reveal y={20} delay={0.1}
          className="liquid-glass rounded-2xl p-5"
        >
          <p className="text-xs text-white/50">The same order, two venues</p>

          <div className="mt-4 space-y-3">
            <div className="liquid-glass rounded-lg p-4">
              <div className="flex items-center gap-2">
                <Eye className="size-3.5 text-red-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-red-400">
                  Transparent venue
                </span>
              </div>
              <div className="mt-3 space-y-1 font-mono text-xs text-white/70">
                <div>side: LONG</div>
                <div>size: 5.33 ETH</div>
                <div>leverage: 10x</div>
                <div>trader: 0x38bE…8214</div>
              </div>
              <p className="mt-3 text-[11px] leading-snug text-white/45">
                Everything a searcher needs to price your trade before it lands.
              </p>
            </div>

            <div className="liquid-glass rounded-lg p-4">
              <div className="flex items-center gap-2">
                <EyeOff className="size-3.5 text-emerald-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  dorr
                </span>
              </div>
              <div className="mt-3 break-all font-mono text-xs text-white/70">
                c82e45c4093936ec7f4b1a9d0e2f6a8c3d5b7e91…
              </div>
              <p className="mt-3 text-[11px] leading-snug text-white/45">
                The entire public record. Side, size, leverage and price stay
                sealed until the order has already cleared.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function StackCloud() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-16 md:py-20">
      <p className="text-center text-xs uppercase tracking-widest text-white/40">
        Real contracts, real transactions, real credentials
      </p>
      <div className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-4 lg:grid-cols-8">
        {STACK.map((name, i) => (
          <Reveal
            key={name}
            y={0}
            delay={i * 0.05}
            className="text-center text-sm font-semibold tracking-tight text-white/50 transition-colors hover:text-white"
          >
            {name}
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/**
 * The measured results.
 *
 * This replaces the testimonial wall the reference design used. Quoting
 * invented people would undercut the one thing the project is actually
 * arguing, so the section carries numbers that came off chain instead — the
 * figures the leaderboard reports, and where to go and re-derive them.
 */
function Receipts() {
  const stats = [
    { value: "$2,771.87", label: "Lost to the public mempool", sub: "across 21 measured duels" },
    { value: "$2,442.45", label: "Saved by the private lane", sub: "counted only when both lanes landed" },
    { value: "15", label: "Sandwiches landed", sub: "worst single trade $972.73" },
    { value: "20 / 1", label: "Seen in the mempool", sub: "public lane / private lane" },
  ];

  return (
    <section className="mx-auto max-w-6xl border-t border-white/10 px-6 py-20 md:py-28">
      <div className="flex flex-col items-start gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <SectionEyebrow label="Receipts" tag="on chain" />
          <h2 className="mt-5 max-w-lg text-3xl font-semibold leading-[1.02] tracking-tight md:text-5xl">
            We priced the mempool.
          </h2>
        </div>
        <p className="max-w-sm text-sm leading-[1.6] text-white/60">
          The same swap, twice — once public, once through KeeperHub&apos;s private
          routing — with a live searcher hunting it. Every figure below has a
          Sepolia transaction hash behind it.
        </p>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s, i) => (
          <Reveal key={s.label} delay={i * 0.07} className="liquid-glass rounded-2xl p-6">
            <div className="font-mono text-3xl font-semibold tracking-tight text-white">
              {s.value}
            </div>
            <div className="mt-3 text-sm font-medium text-white/80">{s.label}</div>
            <div className="mt-1 text-xs text-white/45">{s.sub}</div>
          </Reveal>
        ))}
      </div>

      <p className="mt-8 text-xs text-white/40">
        Figures from the persisted duel history at the time of writing.{" "}
        <Link href="/mev" className="text-white/70 underline underline-offset-2 hover:text-white">
          The live leaderboard
        </Link>{" "}
        is the current version of this paragraph — and it counts the runs where our
        own searcher lost the race, too.
      </p>
    </section>
  );
}

/**
 * The trust argument, stated as a table.
 *
 * The reference design put a pricing grid here. dorr has nothing to sell, and
 * the more interesting thing to put in the most prominent slot on the page is
 * the precise boundary of what the operator can and cannot do.
 */
function Disclosure() {
  const rows = [
    {
      claim: "Your collateral",
      who: "DorrVault on Sepolia",
      guard: "Only the depositor can withdraw. There is deliberately no token-moving admin function.",
    },
    {
      claim: "Your balance",
      who: "The vault",
      guard: "The operator reads accountOf. It does not write it.",
    },
    {
      claim: "Your PnL",
      who: "KeeperHub's wallet",
      guard: "applyPnl is onlySettlement, and every batch must sum to zero — checked on chain.",
    },
    {
      claim: "Your order",
      who: "You, until it clears",
      guard: "Sealed to a future drand round. Not even the operator can read it early.",
    },
  ];

  return (
    <section className="mx-auto max-w-6xl px-6 py-20 md:py-28">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold leading-[1.02] tracking-tight md:text-5xl">
          The operator can decide
          <br />
          what you are owed.
        </h2>
        <p className="mt-6 text-base leading-[1.6] text-white/60">
          It cannot pay it. Off-chain matching is what makes the privacy work, and
          it means we alone know the book — which is exactly why the contracts do
          not let us act on it.
        </p>
      </div>

      <div className="liquid-glass mt-12 overflow-hidden rounded-2xl">
        {rows.map((r, i) => (
          <Reveal
            key={r.claim}
            y={0}
            delay={i * 0.06}
            className={`grid gap-2 px-6 py-5 md:grid-cols-12 md:items-center md:gap-6 ${
              i > 0 ? "border-t border-white/10" : ""
            }`}
          >
            <div className="flex items-center gap-2 md:col-span-3">
              <Lock className="size-3.5 shrink-0 text-white/40" />
              <span className="text-sm font-semibold text-white">{r.claim}</span>
            </div>
            <div className="text-sm text-white/70 md:col-span-3">{r.who}</div>
            <div className="text-xs leading-[1.6] text-white/50 md:col-span-6">{r.guard}</div>
          </Reveal>
        ))}
      </div>

      <p className="mt-6 flex items-center justify-center gap-2 text-xs text-white/40">
        <Shield className="size-3.5" />
        The matching engine is trusted and we say so plainly — see the security notes.
      </p>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20 md:py-32">
      <Reveal
        y={30}
        className="liquid-glass relative overflow-hidden rounded-3xl px-8 py-16 text-center md:py-24"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            background:
              "radial-gradient(600px circle at 50% 0%, rgba(255,255,255,0.15), transparent 70%)",
          }}
        />
        <div className="relative">
          <h2 className="text-4xl font-semibold leading-[1.02] tracking-tight md:text-6xl">
            Stop announcing
            <br />
            your trades.
          </h2>
          <p className="mx-auto mt-6 max-w-md text-sm leading-[1.6] text-white/60">
            Open the terminal and watch the public feed while you trade. A hash is
            all it will ever show.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <PrimaryCta />
            <SecondaryCta label="Read the architecture" href="https://github.com/nickthelegend/dorr-keeperhub" />
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mx-auto max-w-6xl border-t border-white/10 px-6 py-10">
      <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
        <div className="flex items-center gap-3">
          <DorrMark className="size-5 text-white/70" />
          <span className="text-xs text-white/40">
            Testnet software. mUSD is a faucet token with no value.
          </span>
        </div>
        <div className="flex items-center gap-5 text-xs text-white/50">
          <Link href="/trade" className="hover:text-white">
            Terminal
          </Link>
          <Link href="/mev" className="hover:text-white">
            MEV Shield
          </Link>
          <a
            href="https://github.com/nickthelegend/dorr-keeperhub"
            className="hover:text-white"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
