"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createWalletClient, custom, type Address, type WalletClient } from "viem";
import { defineChain } from "viem";

/**
 * Flare Coston2 wallet connection over EIP-1193 (MetaMask, Rabby, Brave, …).
 *
 * dorr settles on Flare and margins in FXRP, an ERC-20 — so the wallet has to be
 * an EVM wallet. This replaces the previous Cardano CIP-30 (Mesh/Lace)
 * connection, which could neither hold FXRP nor sign a Flare transaction.
 */

export const COSTON2_CHAIN_ID = 114;

export const coston2 = defineChain({
  id: COSTON2_CHAIN_ID,
  name: "Flare Coston2",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://coston2-api.flare.network/ext/C/rpc"] },
  },
  blockExplorers: {
    default: { name: "Coston2 Explorer", url: "https://coston2-explorer.flare.network" },
  },
});

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: never[]) => void) => void;
  removeListener?: (event: string, handler: (...args: never[]) => void) => void;
};

function provider(): Eip1193 | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ethereum?: Eip1193 }).ethereum ?? null;
}

export interface EvmWallet {
  available: boolean;
  connecting: boolean;
  connected: boolean;
  address: Address | undefined;
  chainId: number | undefined;
  wrongNetwork: boolean;
  error: string | null;
  walletClient: WalletClient | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToCoston2: () => Promise<void>;
}

export function useEvmWallet(): EvmWallet {
  const [address, setAddress] = useState<Address | undefined>();
  const [chainId, setChainId] = useState<number | undefined>();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Injected providers are not always present at first paint: extensions inject
  // asynchronously, and a user can install or unlock one with the tab already
  // open. `available` is read during render, so without this the app decides
  // "no wallet" once and never reconsiders — and since the wallet lives in a
  // root-layout provider that never remounts, that verdict is permanent.
  const [providerTick, setProviderTick] = useState(0);
  useEffect(() => {
    if (provider()) return;
    // EIP-6963: the modern announcement channel.
    const onAnnounce = () => setProviderTick((n) => n + 1);
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    // Fallback for wallets that only set window.ethereum. Bounded, so a page
    // with no wallet at all does not poll forever.
    let tries = 0;
    const timer = setInterval(() => {
      if (provider()) {
        setProviderTick((n) => n + 1);
        clearInterval(timer);
      } else if (++tries > 20) {
        clearInterval(timer);
      }
    }, 500);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearInterval(timer);
    };
  }, [providerTick]);

  const available = typeof window !== "undefined" && !!provider();

  const readChain = useCallback(async () => {
    const p = provider();
    if (!p) return;
    try {
      const id = (await p.request({ method: "eth_chainId" })) as string;
      setChainId(parseInt(id, 16));
    } catch {
      /* provider not ready */
    }
  }, []);

  // Restore an already-authorised session without prompting.
  useEffect(() => {
    const p = provider();
    if (!p) return;
    void (async () => {
      try {
        const accounts = (await p.request({ method: "eth_accounts" })) as string[];
        if (accounts?.length) setAddress(accounts[0] as Address);
        await readChain();
      } catch {
        /* ignore */
      }
    })();

    const onAccounts = (...args: never[]) => {
      const accounts = args[0] as unknown as string[];
      setAddress(accounts?.length ? (accounts[0] as Address) : undefined);
    };
    const onChain = (...args: never[]) => setChainId(parseInt(args[0] as unknown as string, 16));

    p.on?.("accountsChanged", onAccounts);
    p.on?.("chainChanged", onChain);
    return () => {
      p.removeListener?.("accountsChanged", onAccounts);
      p.removeListener?.("chainChanged", onChain);
    };
  }, [readChain, providerTick]);

  const connect = useCallback(async () => {
    const p = provider();
    if (!p) {
      setError("No EVM wallet found. Install MetaMask or Rabby.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const accounts = (await p.request({ method: "eth_requestAccounts" })) as string[];
      setAddress(accounts?.[0] as Address);
      await readChain();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("rejected") ? "Connection rejected." : msg.slice(0, 140));
    } finally {
      setConnecting(false);
    }
  }, [readChain, providerTick]);

  const disconnect = useCallback(() => {
    setAddress(undefined);
    setError(null);
  }, []);

  /** Ask the wallet to move to Coston2, adding the network if it isn't known yet. */
  const switchToCoston2 = useCallback(async () => {
    const p = provider();
    if (!p) return;
    const hexId = "0x" + COSTON2_CHAIN_ID.toString(16);
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    } catch (e) {
      // 4902 = chain unknown to the wallet; add it, then it becomes current.
      const code = (e as { code?: number })?.code;
      if (code === 4902) {
        await p.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: hexId,
              chainName: "Flare Testnet Coston2",
              nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
              rpcUrls: ["https://coston2-api.flare.network/ext/C/rpc"],
              blockExplorerUrls: ["https://coston2-explorer.flare.network"],
            },
          ],
        });
      } else {
        throw e;
      }
    }
    await readChain();
  }, [readChain, providerTick]);

  const walletClient = useMemo(() => {
    const p = provider();
    if (!p || !address) return null;
    return createWalletClient({ account: address, chain: coston2, transport: custom(p) });
  }, [address]);

  return {
    available,
    connecting,
    connected: !!address,
    address,
    chainId,
    wrongNetwork: !!address && chainId !== undefined && chainId !== COSTON2_CHAIN_ID,
    error,
    walletClient,
    connect,
    disconnect,
    switchToCoston2,
  };
}
