"use client";

import { useDorrWallet } from "@/hooks/use-dorr-wallet";
import { useConfig } from "@/hooks/use-operator";

/**
 * Whose account the terminal is showing.
 *
 * Connected, it is yours. Disconnected, it follows a real funded account
 * read-only rather than showing four empty "connect a wallet" panels.
 *
 * That distinction is the whole point of this hook: without it, anyone without
 * SepoliaETH — which is most people the first time they see this — gets a
 * terminal that appears to do nothing, and concludes the perps are unfinished
 * rather than that they personally have no gas. Spectating shows the engine
 * working on real positions with real on-chain settlement, and every panel says
 * plainly that you are watching someone else.
 *
 * `canAct` is the gate for anything that moves value. Spectating never does.
 */
export function useViewedAddress(): {
  address: string | undefined;
  isSpectator: boolean;
  canAct: boolean;
} {
  const { connected, address } = useDorrWallet();
  const { data: config } = useConfig();

  if (connected && address) {
    return { address, isSpectator: false, canAct: true };
  }
  return {
    address: config?.spectatorAddress ?? undefined,
    isSpectator: Boolean(config?.spectatorAddress),
    canAct: false,
  };
}
