# Testing

**67 automated tests, all green** — 19 Foundry, 48 Bun — plus scripts that
verify the live system against Sepolia rather than against a mock.

```bash
cd contracts && forge test -vv
```

```bash
bun test --cwd services/operator
```

```bash
bun run --cwd services/operator typecheck && bun run --cwd apps/web typecheck
```

---

## Contracts (19)

`MevPool.t.sol` pins the sandwich economics independently of any network: a
sandwich extracts value from the victim, works on buys as well as sells, a wider
tolerance means strictly more extraction, and the attacker's take plus the LPs'
fees equals the victim's loss — value moved, not created.

It also pins `maxExtractableFrontRun`, the view function that solves for the
largest front-run still leaving the victim one wei above their own limit. That
function is what makes "your slippage tolerance is the attacker's budget" a
claim about the contract rather than a slogan.

`DorrVault.t.sol` covers deposit and withdrawal, that only the depositor can
withdraw, margin locking, and the `applyPnl` invariants: zero-sum enforcement, a
trader's balance never going negative, and reverting on a backing shortfall.

## Operator (48)

**`settlement.test.ts`** is regression coverage for a bug that actually
happened. `buildBatch` is tested for the case where the chain has already paid
(the batch must be empty), where it has *over*paid (the batch must propose the
correction back), and for dust suppression. `toZeroSumUnits` is tested to sum to
exactly zero — including on values floats cannot represent, like `0.1 + 0.2 −
0.3`, where the residue has to land on the insurance fund rather than on the sum.

**`mev-searcher.test.ts`** pins `decodeSwapFromCalldata` against real relayed
transaction bytes. KeeperHub wraps calls in a relayer, so a searcher matching on
`tx.to == pool` sees nothing and every relayed trade would *look* private. This
test is what stops that becoming a silent false negative in our own favour.

**`mev-store.test.ts`** covers the savings rule — a duel only counts when both
lanes completed — and persistence across restarts.

**`auth.test.ts` / `auth-crypto.test.ts`** cover EIP-191 recovery, replay
rejection, and that a signature for one action can't be reused for another.

---

## Verifying against the live chain

Unit tests can't tell you the two halves of the system are actually joined. These
do, and they fail loudly when they aren't:

```bash
cd services/operator && bun run src/scripts/prove-deposit.ts 500
```

Mints mUSD, deposits it into the vault, then asserts the operator's reported
balance moved to match the vault's — and that the operator's number equals the
vault's `totalInternal`. If the operator ever credits its own number instead of
reading the chain's, this fails.

```bash
cd services/operator && bun run src/scripts/probe-keeperhub.ts
```

Varies one knob at a time against a known-good contract call. KeeperHub reports
several unrelated failures with the identical string "exceeded max retries", so
this is the only practical way to find which one you have.

---

## Manual checks worth doing before a demo

- `GET /mev/status` → `searcherFunded: true`. A broke searcher can't attack, so
  the public lane reports $0 and the private lane wins by default — the most
  flattering way this lab can be wrong.
- The mempool counter on `/mev` is climbing. If it's stuck, nothing is
  witnessing the privacy claim, and runs are correctly reported as *unobserved*
  rather than private.
- `GET /ops/solvency` → `solvent: true`.
- Hostile input into the duel form: negative size, a non-numeric tolerance. Both
  fields should flag and the button should disable.

## Out of scope

Load and concurrency testing, adversarial fuzzing of the matching engine, and
formal verification. This is a hackathon build and those are not done.
