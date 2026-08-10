# dorr — runbook

Perps and MEV Shield, both on Ethereum Sepolia through KeeperHub. Everything
runs locally except the chain and KeeperHub itself.

---

## Ports

| What | Where |
|---|---|
| Operator (Hono, Bun) | `:8790` — override with `OPERATOR_PORT` |
| Web app (Next.js) | `:3000` — override with `--port` |

The operator refuses to start if something is already serving its port. Bun sets
`SO_REUSEPORT`, so a second instance would otherwise bind successfully and both
would answer requests round-robin from different in-memory observers — which
produces bizarre symptoms rather than an obvious error.

---

## Start

```bash
bun install
```

```bash
bun run --cwd services/operator start
```

```bash
bun run --cwd apps/web dev
```

A healthy boot prints, in order: persisted duel count, the Chainlink feed for
every market with its current price, the seeded vAMM pools, and the listening
line. If a feed can't be read, that market is **disabled** rather than quoted
from a stale number — you'll see it say so.

---

## First-time setup

You need a KeeperHub org key, a Sepolia-funded deployer, and about 0.05 SepoliaETH.

```bash
cp .env.example .env
```

Fill in `ETH_DEPLOYER_KEY`, `KEEPERHUB_API_KEY`, `KEEPERHUB_ORG_WALLET`, and
`KEEPERHUB_INTEGRATION_ID` (from `GET /api/integrations` — the wallet that signs
write nodes; without it every write fails as "exceeded max retries", which
points nowhere near the actual cause).

Deploy the MEV lab — pool, both faucet tokens, and the searcher's funding:

```bash
cd services/operator && bun run src/scripts/mev-deploy.ts
```

Wire perps settlement. This capitalises the insurance fund by having KeeperHub
sign its own deposit, then hands it the vault's settlement authority:

```bash
cd services/operator && bun run src/scripts/provision-settlement.ts 50000
```

Write the addresses each script prints back into `.env`.

---

## Verify it's actually working

```bash
cd services/operator && bun run src/scripts/prove-deposit.ts 500
```

Mints mUSD, deposits it into the vault, then asserts the operator's reported
balance moved to match the vault's. **It fails loudly if the two halves come
apart** — which is the point of running it.

```bash
curl -s localhost:8790/ops/solvency | jq
```

Reserves, liabilities and solvency read live from `DorrVault`. The operator does
not get a say.

---

## Routine operations

**Run a duel from the CLI** instead of the UI:

```bash
curl -sX POST localhost:8790/mev/duel -H 'content-type: application/json' -d '{"amountIn":"10","slippageBps":100}'
```

**Rebalance the pool.** Every duel leaves it slightly off its target price —
the searcher's two legs don't cancel against the 30bp fee:

```bash
cd services/operator && bun run src/scripts/mev-rebalance.ts
```

**Stand up the autonomous agent** (cron is UTC):

```bash
cd services/operator && bun run src/scripts/mev-schedule.ts "0 * * * *" 2 100
```

**Settle perps PnL now** rather than waiting for the five-minute keeper:

```bash
curl -sX POST localhost:8790/settlement/run | jq
```

---

## When something breaks

**A KeeperHub write fails with "exceeded max retries."** That string covers at
least three unrelated causes. Check in this order: the node is missing
`integrationId`; the ABI isn't in Foundry's shape (`internalType` included — the
terser viem-style entry is rejected); or poll the execution status directly,
because the real error often only appears there.

**"Wallet is saturated: could not acquire the nonce lock."** KeeperHub sends one
transaction at a time per wallet, and private routing holds that lock for the
whole inclusion wait — 12s to 233s measured here. Settlement backs off and
retries on its own. The structural fix is a second wallet.

**A market is disabled.** Its Chainlink feed couldn't be read or its last update
is older than the staleness bound. `GET /markets` reports `disabled: true`. This
is deliberate: a perp priced off a guess is worse than one that refuses to quote.

**The public lane reports $0 and no sandwich.** Either the searcher lost the race
for block position — legitimate, and recorded as-is — or it's out of gas. Check
`GET /mev/status` for `searcherFunded`; the UI warns when it can no longer attack.

**The mempool feed is stuck at zero.** The WebSocket didn't connect, so nothing
is witnessing the privacy claim. Check `ETH_WS_URL`; runs mined while the
observer was down are reported as *unobserved*, never as private.

**Settlement says "insurance fund holds X but owes Y."** The fund is
undercapitalised for the batch. Re-run `provision-settlement.ts` with a larger
amount.

---

## Reset

```bash
curl -sX POST localhost:8790/demo/reset
```

Clears orders, positions, jobs and the feed. It does **not** clear collateral or
settled PnL, and cannot: those live in the vault on Sepolia. Wiping the
operator's database and watching balances survive is a reasonable thing to
demonstrate on purpose.

Duel history lives in SQLite at `services/operator/data/mev.db` and survives
restarts independently.
