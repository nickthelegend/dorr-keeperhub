// Core utilities — pure helpers only (EVM config removed in the Cardano port).
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 1,234.56 style formatting with sane defaults for prices. */
export function formatUsd(value: number | null | undefined, digits?: number): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const d = digits ?? (Math.abs(value) >= 1 ? 2 : 6);
  return value.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

/** Truncate a bech32 (or any long) address: addr_test1qz…x0f2 */
export function truncateAddress(addr: string | null | undefined, head = 12, tail = 6): string {
  if (!addr) return "";
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/** Truncate a hex hash: 0f2a…9c1d */
export function truncateHash(hash: string | null | undefined, head = 10, tail = 8): string {
  if (!hash) return "";
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

export function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour12: false });
  } catch {
    return iso;
  }
}

/**
 * Turn a thrown value into something a person can read.
 *
 * Wallet and RPC libraries throw multi-paragraph errors with a `Details:` line,
 * a `Version: viem@x.y.z` footer, and sometimes the whole request. Surfaced
 * verbatim in a toast — which is what every call site used to do — a user who
 * simply clicked "reject" in their wallet was told:
 *
 *   "User rejected the request. Details: user rejected Version: viem@2.55.13"
 *
 * Declining is a normal action, not a failure, and the library version is not
 * the user's problem. This collapses the common wallet cases to plain language
 * and otherwise keeps just the first line.
 */
export function readableError(e: unknown): string {
  const raw =
    typeof e === "string"
      ? e
      : ((e as { shortMessage?: string })?.shortMessage ??
        (e as { message?: string })?.message ??
        String(e));
  const code = (e as { code?: number })?.code;

  if (code === 4001 || /user rejected|user denied|rejected the request/i.test(raw)) {
    return "You rejected the request in your wallet.";
  }
  if (code === 4900 || /disconnected/i.test(raw)) return "Your wallet is disconnected.";
  if (/insufficient funds/i.test(raw)) return "Not enough funds to cover this transaction and its gas.";
  if (/chain mismatch|chain id|wrong network/i.test(raw)) return "Your wallet is on the wrong network.";

  // Otherwise: first line only, without the library's version footer.
  return raw.split("\n").map((l) => l.trim()).filter(Boolean)[0]?.replace(/\s*Version:.*$/i, "").slice(0, 180) ?? "Something went wrong.";
}
