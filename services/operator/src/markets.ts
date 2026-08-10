/**
 * The markets dorr quotes, on Ethereum Sepolia.
 *
 * Markets are USD-denominated (matching the oracle) and collateralised in mUSD,
 * which is how a real perp works: you quote in dollars, you post margin in a
 * token.
 *
 * `feedId` is a Chainlink aggregator address on Sepolia. These are the real,
 * publicly documented feeds — nothing here is a stand-in, and a market whose
 * feed cannot be read is disabled rather than quoted from a guess.
 */
export interface MarketDef {
  /** dorr market id, e.g. "ETH-USD". */
  id: string;
  symbol: string;
  base: string;
  /** Chainlink AggregatorV3 address on Sepolia. */
  feedId: string;
  /** Virtual AMM depth: quote-side notional (USD) of the virtual pool. */
  vammDepthUsd: number;
  /** Recenter vAMM to the oracle when drift exceeds this many bps. */
  recenterBps: number;
  maxLeverage: number;
  /** Risk limit: max total open interest (notional, USD) across all traders. */
  maxOiUsd: number;
}

export const MARKETS: MarketDef[] = [
  {
    // The home market: the same asset the MEV lab's pool prices.
    id: "ETH-USD",
    symbol: "ETH/USD",
    base: "ETH",
    feedId: "0x694AA1769357215DE4FAC081bf1f309aDC325306",
    vammDepthUsd: 4_000_000,
    recenterBps: 5,
    maxLeverage: 20,
    maxOiUsd: 1_000_000,
  },
  {
    id: "BTC-USD",
    symbol: "BTC/USD",
    base: "BTC",
    feedId: "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43",
    vammDepthUsd: 4_000_000,
    recenterBps: 5,
    maxLeverage: 20,
    maxOiUsd: 1_000_000,
  },
  {
    id: "LINK-USD",
    symbol: "LINK/USD",
    base: "LINK",
    feedId: "0xc59E3633BAAC79493d908e63626716e204A45EdF",
    vammDepthUsd: 1_000_000,
    recenterBps: 8,
    maxLeverage: 10,
    maxOiUsd: 250_000,
  },
  {
    id: "DAI-USD",
    symbol: "DAI/USD",
    base: "DAI",
    feedId: "0x14866185B1962B63C3Ea9E03Bc1da838bab34C19",
    vammDepthUsd: 1_000_000,
    recenterBps: 10,
    maxLeverage: 5,
    maxOiUsd: 250_000,
  },
];

export function marketById(id: string): MarketDef | undefined {
  return MARKETS.find((m) => m.id === id);
}
