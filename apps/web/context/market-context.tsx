"use client";

import { createContext, useCallback, useEffect, useState, useContext, type ReactNode } from "react";

/**
 * Holds the selected dorr market id (e.g. "ETH-USD").
 *
 * Live market data — prices, leverage caps, whether a feed has gone stale —
 * comes from `useMarkets()` polling. This only tracks which one you are
 * looking at.
 */
export const DEFAULT_MARKET_ID = "ETH-USD";

const STORAGE_KEY = "dorr.selectedMarket";

interface MarketContextType {
  selectedMarketId: string;
  setSelectedMarketId: (id: string) => void;
  /**
   * Drop a selection that no longer corresponds to a live market.
   *
   * The default is written down here, and a persisted choice is even older
   * than that — either can name a market the operator has since stopped
   * quoting. Left unchecked the terminal shows a market that does not exist,
   * with no prices and no way to trade, and nothing says why. Callers that
   * know the live list hand it over and this falls back to the first one.
   */
  reconcile: (liveIds: string[]) => void;
}

const MarketContext = createContext<MarketContextType | undefined>(undefined);

export const MarketProvider = ({ children }: { children: ReactNode }) => {
  const [selectedMarketId, setSelected] = useState<string>(DEFAULT_MARKET_ID);

  // Restore after mount rather than in the initial state: reading storage
  // during render would differ between server and client and hydrate wrong.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setSelected(saved);
    } catch {
      /* storage can be unavailable (private mode, blocked cookies) — the
         in-memory default is a perfectly good fallback */
    }
  }, []);

  const setSelectedMarketId = useCallback((id: string) => {
    setSelected(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* selection still works for this session */
    }
  }, []);

  const reconcile = useCallback(
    (liveIds: string[]) => {
      if (liveIds.length === 0) return;
      setSelected((current) => {
        if (liveIds.includes(current)) return current;
        const next = liveIds.includes(DEFAULT_MARKET_ID) ? DEFAULT_MARKET_ID : liveIds[0];
        try {
          window.localStorage.setItem(STORAGE_KEY, next);
        } catch {
          /* no-op */
        }
        return next;
      });
    },
    [],
  );

  return (
    <MarketContext.Provider value={{ selectedMarketId, setSelectedMarketId, reconcile }}>
      {children}
    </MarketContext.Provider>
  );
};

export const useMarketSelection = () => {
  const context = useContext(MarketContext);
  if (context === undefined) {
    throw new Error("useMarketSelection must be used within a MarketProvider");
  }
  return context;
};
