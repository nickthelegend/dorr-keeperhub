"use client";

import { useSharedWallet } from "@/components/providers/wallet-provider";

/**
 * dorr's wallet handle.
 *
 * Backed by an EVM wallet on Flare Coston2 — dorr settles on Flare and margins
 * in FXRP (an ERC-20), so the acting identity has to be an EVM account.
 *
 * This used to instantiate `useEvmWallet()` directly, which gave every calling
 * component its own private copy of the connection state. It now reads the one
 * shared instance from `WalletProvider`; see there for what that was breaking.
 * The shape is unchanged, so consumers did not have to move.
 */
export function useDorrWallet() {
  const evm = useSharedWallet();

  return {
    walletName: evm.connected ? "evm" : undefined,
    connecting: evm.connecting,
    connected: evm.connected,
    /** The viem WalletClient — used for FXRP approve/deposit and signing. */
    wallet: evm.walletClient,
    connect: evm.connect,
    disconnect: evm.disconnect,
    error: evm.error,
    /** 0x address once connected (undefined while disconnected). */
    address: evm.address,
    // Flare-specific extras
    available: evm.available,
    chainId: evm.chainId,
    wrongNetwork: evm.wrongNetwork,
    switchToCoston2: evm.switchToCoston2,
  };
}
