# Security, privacy & honest scope

Four questions. The first three have clean answers; the fourth is where the
honesty lives.

---

## 1. Can the public see my order? — No.

A private order publishes `SHA-256(pairId ‖ side ‖ price ‖ size ‖ leverage ‖
margin ‖ nonce)` and nothing else. The nonce is 128 bits, so the preimage space
is not searchable — the Attack Lab runs 25,000 real SHA-256 guesses against a
real commitment and finds zero, which demonstrates the shape of the problem
rather than its scale.

The public feed shows exactly what an observer gets: a hash, a market, a
timestamp. Flip an order to **public foil** and you can watch what the same
order would have leaked.

Stop-losses and take-profits are never published at all. A stop you can see is a
stop you can hunt.

## 2. Can the *operator* see or front-run my order? — Not if you seal it.

An ordinary private order is hidden from everyone except the operator, which has
to read it to match it. That is a real trust assumption and we don't paper over
it.

Sealed orders remove it for the window that matters: the order is encrypted to a
future **drand** round, so it is unreadable — by us, by anyone — until that
round's key is published. The epoch then clears at a **uniform price**, which
means inserting yourself ahead of a specific order buys you nothing, because
everyone in the epoch gets the same price.

## 3. Can someone trade as me? — No.

With `DORR_AUTH=1`, every value-moving action requires an EIP-191
`personal_sign` over the action and its parameters. The operator recovers the
signer and rejects anything that doesn't match the address in the request.
Deposits and withdrawals are signed by your wallet directly against the vault.

## 4. Is it trustless? — No, and here is exactly where.

**Trusted:** the matching engine. It sees the book — that is what makes matching
possible at all — and it decides fill prices against the vAMM. A dishonest
operator could mis-price a fill. Making that verifiable needs a proof system
this does not have.

**Not trusted, and provably so:**

| | Enforced by |
|---|---|
| Your collateral can only be withdrawn by you | `DorrVault.withdraw` checks the depositor; there is deliberately **no** token-moving admin function |
| The operator cannot credit you PnL | `applyPnl` is `onlySettlement`; `settlement` is KeeperHub's wallet |
| The operator cannot inflate total backing | every batch must sum to **zero**, checked on chain |
| The operator cannot over-credit against reserves | `applyPnl` reverts on `BackingShortfall` |
| The operator cannot double-pay | what's been settled is read from the vault's `PnlApplied` events, not from local state |

That last row is a real incident, not a hypothetical. During development the
vault paid −1.0002 mUSD against −0.5001 owed, because settlement decremented a
local counter and a batch landed that the operator didn't observe. The fix was
to stop remembering and start subtracting: the next run proposed the +0.5001
correction, and the run after proposed nothing.

**The upshot:** the operator can decide what you are owed. It cannot pay it,
cannot mint it, and cannot pay itself — regardless of what its code does.

---

## Key handling

`ETH_DEPLOYER_KEY` and `MEV_SEARCHER_KEY` are testnet keys held in `.env`, which
is gitignored. They control nothing of value: the searcher is an adversary
spending its own testnet ETH, and the deployer owns contracts whose only asset
is a permissionlessly-mintable faucet token.

The KeeperHub org key can create and fire workflows in your organisation. Treat
it like any API credential.

**Never point this at a network where the token is expected to hold value.**
`MevToken.mint` is open by design so a judge can fund themselves and reproduce
the experiment.

---

## Known limitations

- **The matching engine is trusted** (see above) and there is no fraud proof.
- **Sealed-bid clearing is not ZK-proven.** The membership root is recorded and
  auditable off-chain, but publishing it would need a settlement contract that
  re-checks the clearing price against Chainlink — which isn't deployed.
- **Settlement and the MEV lab share one KeeperHub wallet**, so they contend for
  its nonce lock. Settlement backs off and retries; the structural fix is a
  second wallet.
- **The insurance fund is testnet capital.** The zero-sum invariant is genuinely
  enforced on chain, but 50,000 mUSD is not a solvency argument for a real venue.
- **A trader who is owed more than the fund holds** cannot be settled. The
  operator reports that as a refusal with the numbers, rather than a revert.
- **No rate limiting.** The operator assumes a friendly caller.
