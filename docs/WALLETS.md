# Wallets & test setup

## TL;DR

Any EVM wallet on **Ethereum Sepolia** (chain `11155111`). MetaMask, Rabby,
Frame — discovery is EIP-6963, so anything that announces itself works.

You need two things:

1. **SepoliaETH for gas.** From a public faucet — [sepoliafaucet.com](https://sepoliafaucet.com),
   [Alchemy's](https://sepoliafaucet.com), or [Google's](https://cloud.google.com/application/web3/faucet/ethereum/sepolia).
   This is the one part nobody can do for you.
2. **mUSD for margin.** Press **Get mUSD** in the collateral panel. That is a
   real transaction against a permissionless `mint` — you sign it, and you get
   10,000 mUSD.

Then **Deposit** into the vault and trade.

---

## No wallet? You can still see everything that matters

The whole read side is open, and it's most of the argument:

- **`/mev`** works with no wallet at all — including running a live duel, which
  executes from KeeperHub's own wallet.
- **`/`** shows live Chainlink prices, the public order flow as commitment
  hashes, on-chain settlements with Etherscan links, and vault solvency.
- **Spectator mode** on the terminal follows a real funded account, so you can
  watch positions and settlement without connecting anything.

---

## Wrong network

The app detects it and offers to switch. Accepting adds Sepolia with the right
chain ID, RPC and explorer if your wallet doesn't have it.

If you decline, value-moving actions stay disabled rather than failing halfway
through — a transaction sent to the wrong chain is worse than one not sent.

---

## What you'll be asked to sign

| Action | Signature | Costs gas |
|---|---|---|
| Get mUSD | `mint` on the token | yes |
| Deposit | `approve`, then `deposit` | yes, twice the first time |
| Withdraw | `withdraw` on the vault | yes |
| Commit / execute / close | EIP-191 `personal_sign` when `DORR_AUTH=1` | no |

Only the first three touch the chain. Trading itself is off-chain matching, so
it's a signature at most — no gas, no confirmation wait.

The approve is scoped to the amount you're depositing, not unlimited.

---

## Getting your collateral back

`withdraw` on `DorrVault`, signed by you. Only the depositor can withdraw, and
the vault has no admin function that can move tokens — so this works whether or
not the operator is running, and whether or not we cooperate.

If you have unsettled PnL, settle it first (the keeper does this every five
minutes on its own) so the vault balance reflects what you're actually owed.

---

## Troubleshooting

**"You rejected the request in your wallet."** You hit cancel. Nothing happened.

**Deposit fails with an allowance error.** The approve didn't land before the
deposit. Retry — the panel checks the current allowance and skips the approve if
it's already sufficient.

**Balance reads 0 after depositing.** The operator caches vault reads for a few
seconds. The panel forces a re-read after a confirmed deposit; if you're
impatient, `POST /chain/sync/:address`.

**The wallet connects but panels still say "connect a wallet."** Fixed — the app
shares one wallet context across every panel. If you see it, the page is stale;
reload.
