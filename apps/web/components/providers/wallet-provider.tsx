"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { setWalletSigner, evmSigner } from "@/lib/operator";
import { useEvmWallet, type EvmWallet } from "@/hooks/use-evm-wallet";

/**
 * One wallet, shared by the whole app.
 *
 * Every panel used to call `useEvmWallet()` for itself, which meant six
 * independent copies of the wallet state. Connecting from the navbar updated
 * only the navbar's copy: the address appeared in the header while Positions
 * and Collateral carried on saying "connect a wallet", because their own copies
 * had already resolved to "no account" and nothing told them otherwise. Wallets
 * do not reliably emit `accountsChanged` when a site is granted access for the
 * first time, so there was no event to fall back on.
 *
 * It also meant six `eth_accounts` + `eth_chainId` round trips on mount and six
 * sets of provider listeners.
 *
 * One instance here, read through context, fixes both.
 */
const WalletContext = createContext<EvmWallet | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallet = useEvmWallet();

  // Register the request signer once, centrally, rather than in every consumer.
  useEffect(() => {
    if (wallet.connected && wallet.address && wallet.walletClient) {
      setWalletSigner(evmSigner(wallet.walletClient, wallet.address));
    } else {
      setWalletSigner(null);
    }
    return () => setWalletSigner(null);
  }, [wallet.connected, wallet.address, wallet.walletClient]);

  return <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>;
}

/**
 * The shared wallet. Throws outside the provider rather than silently handing
 * back a second, disconnected instance — that failure mode is what this exists
 * to prevent.
 */
export function useSharedWallet(): EvmWallet {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useSharedWallet must be used inside <WalletProvider>");
  return ctx;
}
