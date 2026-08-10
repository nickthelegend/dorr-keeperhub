# API reference

The operator is a Hono server on `http://localhost:8790`. All JSON, CORS open
for the web app. Errors are `{ error: string }` with a real status code.

Set `DORR_AUTH=1` to require an EIP-191 signature on value-moving perps actions;
every such endpoint then takes an `auth` envelope and rejects a mismatched
signer.

---

## Chain state

Nothing here is the operator's word — every field is a contract read at request
time.

| | |
|---|---|
| `GET /chain/info` | network, vault address, collateral token, solvency, relayer balance, explorer links |
| `GET /chain/account/:address` | one trader's vault balance / locked / free, straight from `accountOf` |
| `POST /chain/sync/:address` | force a re-read past the cache — call after a deposit or withdrawal confirms |
| `GET /ops/solvency` | `reserves()`, `totalInternal()` and `isSolvent()` from `DorrVault` |

## Settlement

| | |
|---|---|
| `GET /settlement/pending` | what the operator currently owes and the zero-sum batch it would propose |
| `POST /settlement/run` | ask KeeperHub to apply that batch on chain |
| `GET /settlement/history?limit=` | every PnL the vault has actually paid, from its `PnlApplied` logs |

`pending` is the interesting one to read before `run`: the proposal is auditable
separately from the execution, and it's derived as *cumulative PnL minus what
the chain says was already paid* — so it self-corrects rather than double-paying.

## Markets and accounts

| | |
|---|---|
| `GET /health` | liveness and market count |
| `GET /markets` | symbol, index and mark price, vAMM reserves, `disabled` |
| `GET /config` | operator configuration a client needs |
| `GET /account/:address` | `deposited` (chain) and `pnl` / `settledPnl` / `unsettledPnl` (engine), kept apart on purpose |
| `GET /stats` | aggregate open interest, volume, insurance fund |

## Trading

| | |
|---|---|
| `POST /orders/commit` | lock margin, publish only the commitment hash |
| `POST /orders/:id/execute` | reveal, verify the commitment, fill on the vAMM |
| `POST /orders/:id/cancel` | release margin for a committed or resting order |
| `GET /orders/:id` · `GET /orders/resting/:address` | order state; resting limits are visible only to their owner |
| `GET /positions/:address` | positions with mark, uPnL and liquidation price |
| `POST /positions/:id/close` | close or partially close; realizes PnL off chain |
| `POST /positions/:id/margin` | add or remove margin |
| `POST /positions/:id/stops` | set hidden stop-loss / take-profit triggers |
| `GET /jobs/:id` | step-by-step progress for any of the above |

## Sealed-bid and batch

| | |
|---|---|
| `POST /orders/seal` | submit an order encrypted to a drand round — unreadable even to the operator |
| `GET /orders/sealed/:address` · `GET /batch/epoch` | your sealed orders; the current epoch and its countdown |
| `GET /batch/preview` · `POST /batch/settle` | uniform clearing price for the epoch, and settle it |

## Privacy

| | |
|---|---|
| `GET /feed` | the public view of order flow — hashes for private orders, everything for the public foil |
| `GET /events` | activity timeline, with Sepolia tx hashes where they exist |
| `POST /disclose` | open one of your orders to a chosen audience, signed |
| `POST /disclose/verify` | verify a disclosure handed to you — no auth, anyone can check |

## MEV Shield

| | |
|---|---|
| `GET /mev/status` | pool, searcher funding, observer connection |
| `POST /mev/duel` | run both lanes; returns when both have landed |
| `GET /mev/duels` · `GET /mev/duels/:id` | persisted duel history |
| `GET /mev/leaderboard` | cumulative lost / saved / sandwiches landed |
| `GET /mev/extraction?amountIn=` | what each slippage tolerance is worth to an attacker, priced off live reserves |
| `GET /mev/stream` | SSE — every pending Sepolia transaction the searcher can see |
| `GET /mev/observer` | observer connection state and how many transactions it has witnessed |
| `GET /mev/agent` | the autonomous agent's runs, each audited for mempool exposure |
| `GET /mev/chains` | chains KeeperHub reports it can execute on |

## Demos

`POST /demo/attack`, `/demo/ab`, `/demo/batch`, `/demo/sealed`.

**These are models, not measurements.** They are solved against live market
state — the real vAMM curve, the current Chainlink index, a real SHA-256
preimage search — but nothing is sent to a chain. The UI labels them as such.
For a measured sandwich with transaction hashes, use `POST /mev/duel`.

`POST /demo/reset` clears orders, positions, jobs and the feed. It cannot clear
collateral or settled PnL — those are on chain.
