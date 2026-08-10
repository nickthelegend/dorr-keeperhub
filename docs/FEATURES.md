# Features

---

## MEV Shield

**The duel.** The same swap twice — same pool, same wallet, same relayer —
differing in exactly one boolean: whether it touched the public mempool. Both
lanes land real Sepolia transactions and the shortfall between quoted and
received is the number. Nothing is annualised or extrapolated.

**A real adversary.** The searcher runs on its own key and its own ETH, watching
a live pending-transaction feed and bidding priority fee for block position. It
calls the pool's `maxExtractableFrontRun` to size its attack — the same function
that makes "your slippage tolerance is the attacker's budget" checkable. It
sometimes loses the race, and when it does the duel records `$0.00`.

**An independent witness.** A mempool observer subscribes to pending
transactions and takes no part in sending either lane, so "this hash was never
public" is checkable by something other than the sender. Anything mined while it
was disconnected is reported as *unobserved*, never as private.

**The live feed.** Every pending Sepolia transaction the searcher can see,
streamed to the browser over SSE. A public-lane trade appears there before it is
mined; a private-lane trade never does, while the feed keeps scrolling.

**The extraction curve.** Eight slippage tolerances priced against the pool's
live reserves, each one an on-chain `maxExtractableFrontRun` call. It shows the
whole curve instantly, where a duel shows one point in minutes.

**An autonomous agent.** A KeeperHub Schedule workflow performs a real private
swap on a cron with no operator involvement, and each run is audited afterwards
against the observer's independent record.

**Persistence.** Every duel is in SQLite with both transaction hashes, so the
leaderboard is a history rather than a session.

---

## The perps

### Privacy

**Commitments.** A private order publishes `SHA-256(fields ‖ 128-bit nonce)` and
nothing else — no side, size, price or leverage.

**Public foil.** Flip one toggle and the same order leaks everything, so you can
see what you were being protected from instead of taking it on faith.

**Sealed-bid orders.** Encrypted to a future drand round, so not even the
operator can read them before the epoch clears. The epoch then clears at a
**uniform price**, which makes inserting yourself ahead of a specific order
worthless.

**Hidden stops.** Stop-loss and take-profit triggers are never published. A stop
you can see is a stop you can hunt.

**Selective disclosure.** Open one of your orders to a chosen auditor with a
signed preimage. They recompute the hash and check it against the published
commitment. Anyone can verify a disclosure handed to them; only you can issue one.

### Trading

Market and limit orders, up to 20× leverage, partial closes, margin add/remove,
hidden stops, and keeper-run liquidation at the maintenance ratio. Funding
accrues hourly. Per-market open-interest caps stop any one market over-levering
the vAMM.

Prices come from Chainlink aggregators read on chain. A feed that can't be read
**disables its market** rather than quoting a stale number.

### Custody and settlement

**Collateral is yours.** mUSD sits in `DorrVault` on Sepolia. Only the depositor
can withdraw, and the contract has deliberately no token-moving admin function.

**The operator cannot pay you.** It computes PnL and proposes a batch;
`applyPnl` is gated on KeeperHub's wallet and rejects anything that doesn't sum
to zero. Settlement is routed privately, because a settlement batch is a list of
who closed what and for how much.

**The split is always visible.** The collateral panel shows *settled on chain*
against *awaiting settlement* on every refresh. One number is the vault's word,
one is the operator's, and you never have to guess which.

**Proof of solvency.** Reserves, liabilities and solvency read live from the
vault on every request.

---

## Deliberately not built

Cross-margin, portfolio margining, an order book (the vAMM is the venue), and
fraud proofs for the matching engine. The last one is the honest gap: see
[SECURITY.md](SECURITY.md).
