# dorr — design notes

> The one reason this exists: **what you reveal before a trade lands is what it
> costs you.** MEV Shield prices that in dollars. The perps build a venue where
> you don't have to reveal it.

This is the reasoning behind the build — the decisions that were load-bearing
and the ones that turned out to be wrong. For what it *does*, see
[docs/FEATURES.md](docs/FEATURES.md); for how it fits together,
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 1. Decisions ledger

| Decision | Why |
|---|---|
| Two lanes differing in one boolean | Any other difference and the comparison proves nothing. Same pool, same wallet, same relayer, same tolerance. |
| The searcher is a real adversary, not a script | A simulated attacker proves the simulation. This one has its own key, pays its own gas, and loses races. |
| An observer that doesn't send either lane | "Never public" has to be checkable by something other than the sender, or it's just an assertion. |
| Our own AMM and our own searcher | No independent searcher fleet hunts a bespoke testnet pool. Owning both is what makes the counterfactual clean — and is stated as a limitation, not hidden. |
| mUSD as an 18dp dollar stand-in | A base→quote shortfall is then already in dollars, with no oracle in the trust path. The headline number doesn't depend on a price feed being right. |
| One faucet token for both halves | A judge who can fund one experiment can fund the other. |
| Chainlink read on chain, per market | A feed that can't be read disables its market. A perp priced off a guess is worse than one that refuses to quote. |
| Off-chain matching | It's the only way sealed orders and hidden stops work at all. It is also the trust assumption, and it's named as one. |
| **Settlement authority is KeeperHub's, not ours** | The single most important decision here. See below. |
| Settled PnL read from vault events, not tracked locally | Idempotency from arithmetic rather than from remembering correctly. |
| Duels in SQLite | The leaderboard should be a history, not a session. |

## 2. The trust model, and the one decision that carries it

Off-chain matching means the operator alone knows what everyone is owed. The
usual answer is "trust us, we're honest." The better answer is to make it
structurally impossible to matter.

`DorrVault.applyPnl` is `onlySettlement`. `settlement` is **KeeperHub's wallet**,
not ours. Every batch must sum to **zero**, checked on chain. So:

- the operator can compute what you're owed → **and cannot credit it**
- it cannot mint balance, because the batch must balance
- it cannot pay itself, for the same reason
- it cannot over-credit against reserves — `applyPnl` reverts on shortfall

None of that depends on the operator's code being correct. It's the contract.

What remains trusted is the matching itself: fill prices against the vAMM. A
dishonest operator could mis-price a fill. Making that verifiable needs a proof
system this doesn't have, and [SECURITY.md](docs/SECURITY.md) says so plainly.

## 3. Things that were wrong, and what they cost

**Settlement double-paid.** The first design decremented a local counter when a
batch landed. Then a batch landed that the operator didn't observe, and the
vault paid −1.0002 mUSD against −0.5001 owed. The fix was to stop remembering:
what's been paid is read from `PnlApplied` events, what's owed is the
difference. The next run proposed the correction; the one after proposed
nothing. **Idempotency should come from the arithmetic, not from bookkeeping.**

**The vAMM seeded on a timer.** Pools were seeded on the first tick *after* the
port opened, so for two seconds a commit would succeed and its execute would
fail — stranding margin behind an order that could never fill. Seeding now
happens before the server listens. **A readiness window is a bug, not a
detail.**

**The private lane's flag was silently ignored.** `POST /api/execute/contract-call`
accepts `usePrivateMempool`, returns 200, and publishes to the public mempool
anyway — we measured the "private" transaction in our own observer 1.0s before
inclusion. Private routing lives on workflow write-nodes only. **A flag that is
accepted and ignored is worse than one that errors.**

**The Attack Lab had a fake clock.** Its steps carried millisecond offsets (0,
320, 640…) that were spacing for an animation and read as measurements. The
economics were real — solved against the live vAMM curve — but a number that
looks measured and isn't costs more than the animation was worth. Now it's
ordered stages, labelled as a model, pointing at the measured version.

## 4. Trade lifecycle

1. **Commit** — margin locks, `SHA-256(fields ‖ nonce)` publishes, nothing else does.
2. **Execute** — the operator reveals against its stored preimage, verifies the
   commitment recomputes, and fills on the vAMM.
3. **Close** — PnL realises against the account off chain.
4. **Settle** — every five minutes the keeper batches unsettled PnL, checks it
   sums to zero, and asks KeeperHub to apply it. The vault enforces the
   invariant regardless.

Sealed orders insert a step before (1): encrypted to a future drand round,
unreadable by anyone including us, cleared at a uniform price when the round
lands.

## 5. Scope — real vs cut

**Real:** deployed contracts, live Chainlink prices, real signed transactions,
a real adversary, a real mempool witness, persisted history, on-chain settlement.

**Modelled and labelled:** the Attack Lab, the A/B foil, the batch and sealed
demos. Solved from live market state, sent to no chain, and the UI says so.

**Cut:** cross-margin, an order book, fraud proofs for the matching engine, and
publishing the sealed-bid membership root on chain.

## 6. Known risks

| Risk | Mitigation |
|---|---|
| Searcher runs out of gas → public lane falsely reports $0 | `/mev/status` reports its balance; the UI warns when it can't attack |
| Observer disconnects → privacy claim unwitnessed | Those runs report *unobserved*, never *private* |
| KeeperHub nonce contention between the two subsystems | Settlement backs off and retries; the real fix is a second wallet |
| Insurance fund undercapitalised for a batch | Checked before sending; reported as a refusal with the numbers, not a revert |
| Chainlink feed stale or unreadable | The market disables itself rather than quoting |
