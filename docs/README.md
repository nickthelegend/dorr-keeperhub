<div align="center">

# dorr docs

**Private trading, and the receipts.**

`Ethereum Sepolia` · `KeeperHub` · `Chainlink`

</div>

---

Start with the [project README](../README.md) — it carries the claim and the
transaction hashes behind it. These are the details underneath.

| | |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | how the two subsystems fit together, and what the operator can and cannot change |
| [FEATURES.md](FEATURES.md) | everything that's built, on both halves |
| [API.md](API.md) | every operator endpoint |
| [SECURITY.md](SECURITY.md) | the trust model, stated precisely — including where it *isn't* trustless |
| [TESTING.md](TESTING.md) | the 67 tests, and the scripts that check the live system rather than a mock |
| [WALLETS.md](WALLETS.md) | wallet setup, and what you can see without one |
| [keeperhub-onboarding-friction.md](keeperhub-onboarding-friction.md) | a friction log from building on KeeperHub |

---

## The shortest version

What you reveal before a trade lands is what it costs you.

**MEV Shield** (`/mev`) proves the cost. The same swap runs twice — once through
the public mempool, once through KeeperHub's private routing — and the gap
between quoted and received is the invoice, in dollars, with transaction hashes.

**The perps** (`/`) build a venue where you never enter the mempool. Orders are
commitments, stops are never published, and the matching is off chain.

That last part creates the obvious problem: if the operator alone knows what
everyone is owed, why believe it? Because the operator is not allowed to pay
you. `applyPnl` on the vault is gated on KeeperHub's wallet and every batch must
sum to zero — so it can compute what you're owed and provably cannot credit it,
mint it, or pay itself.

## Run it

```bash
bun install && bun run --cwd services/operator start
```

```bash
bun run --cwd apps/web dev
```

Full setup, including KeeperHub credentials and one-time provisioning, is in the
[RUNBOOK](../RUNBOOK.md). The demo script is in [DEMO.md](../DEMO.md).
