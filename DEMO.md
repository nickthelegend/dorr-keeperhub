# dorr — demo script (≈4 min)

**The one line:** what you reveal before a trade lands is what it costs you — and
we priced it, on chain, in dollars.

Two halves, one idea. **MEV Shield** (`/mev`) proves it for a swap. **The perps
terminal** (`/`) builds a venue where you don't have to reveal it at all.

---

## Pre-flight (before you're in front of anyone)

```bash
bun run --cwd services/operator start    # terminal A → :8790
```

```bash
bun run --cwd apps/web dev               # terminal B → :3000
```

Check three things and you will not be surprised on stage:

- `/mev/status` reports `searcherFunded: true`. A broke searcher can't attack, the
  public lane reports $0, and the private lane appears to win by default — the
  most flattering way this lab can be wrong. Top up with `mev-deploy.ts`.
- The mempool panel on `/mev` is counting upward. If it's stuck, the WebSocket
  didn't connect and the "never public" claim has no witness behind it.
- `/ops/solvency` returns `solvent: true`.

**Run one duel before you present.** Not to fake anything — the results are
persisted and the page shows the latest one on load, so you open with a real
measured result on screen instead of an empty card. Then run a fresh one live.

---

## Beat 1 — the claim, already proven (45s)

Open `/mev`. The top row is cumulative across every duel ever run.

> "Everyone says private routing stops MEV. Nobody shows you the invoice. Same
> swap, same pool, same wallet, same relayer, twice — differing in exactly one
> boolean: whether it touched the public mempool."

Point at the two lane cards. Public: quoted vs actually received, the gap in
dollars, `SANDWICH LANDED`, and how many milliseconds the searcher took to
react. Private: quoted equals received, `$0.00`.

Click one of the transaction links. **It's a real Sepolia transaction.** So are
the attacker's front-run and back-run.

---

## Beat 2 — the mempool, live (30s)

Scroll to `SEPOLIA MEMPOOL · LIVE`. It is streaming every pending transaction
the searcher can see, right now.

> "This is the searcher's view. A public-lane trade appears here before it's
> mined — that's the whole attack. A private-lane trade never appears at all,
> while this keeps scrolling."

The `seen in the mempool` counter in the top row is that same witness, tallied:
public lane seen almost every time, private lane essentially never.

---

## Beat 3 — run one live (2–5 min, talk through it)

Set a size and a slippage tolerance. Hit **Run the duel**.

**Say the duration out loud before you click**: two on-chain lanes across
several Sepolia blocks, and private routing does not broadcast — it offers the
transaction to builders and waits for inclusion, which we've measured between
12s and 233s. The progress stepper shows which lane is where.

Fill the wait with the argument, because the wait *is* part of the argument:

> "Your slippage tolerance is not protection. It's the amount you've published
> your willingness to lose, and a rational searcher takes exactly that much —
> no more, because they want your trade to clear. The pool exposes
> `maxExtractableFrontRun`, which solves for precisely that trade. Our searcher
> calls it."

Point at the extraction curve while it runs: every tolerance priced against
live reserves. Raise the tolerance, watch the loss grow.

---

## Beat 4 — the perps, and the part that's actually novel (60s)

Open `/`. No wallet needed for any of this.

- **Order flow** shows live orders as 32-byte commitments. Side, size, leverage,
  price — none of it public.
- **Settled on chain** is the vault's own `PnlApplied` log. Click through to
  Etherscan.

Then land the point that makes this more than a private orderbook:

> "The engine matches off chain — that's what makes the privacy possible, and it
> means the operator alone knows what everyone is owed. So the operator is not
> allowed to pay it. `applyPnl` on the vault is gated on KeeperHub's wallet, not
> ours, and the contract rejects any batch that doesn't sum to zero. We can
> compute what you're owed. We cannot credit it, cannot mint it, and cannot pay
> ourselves — and that's enforced by the contract, not by our good intentions."

The collateral panel shows the split on every refresh: **settled on chain**
versus **awaiting settlement**. One number is the vault's word, one is ours.

---

## The honest footnote — say it, it's a strength

> "The searcher is ours and the pool is ours, because no independent searcher
> fleet hunts a bespoke pool on a testnet. Its attacks are real signed
> transactions paid for with its own ETH, racing on priority fee — but this is
> not evidence about how crowded mainnet MEV is. And the matching engine is
> trusted: it sees the book, because that's what makes matching possible. What
> it provably cannot do is touch your collateral or credit your PnL."

---

## If something goes wrong

**The duel is taking too long.** Fine — it's two lanes across real blocks, and
private routing is genuinely variable. The persisted history below is right
there; walk it while you wait. Don't cancel and re-run, you'll just queue behind
your own transaction.

**"Wallet is saturated."** KeeperHub sends one transaction at a time per wallet
and private routing holds that lock through inclusion. Settlement backs off and
retries on its own. Say what it is — it's a real constraint of the platform and
you documented it.

**The searcher didn't land the sandwich.** It lost the race for block position.
The duel records `$0.00` and the history table keeps it. That's the honest
number and the table is full of them; don't hide it.
