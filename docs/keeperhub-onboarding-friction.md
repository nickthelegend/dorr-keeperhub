# KeeperHub onboarding: a friction log

Submitted for the **Best Onboarding UX Improvement** bounty.

This is the log of an actual first-time integration, written as it happened while building
[MEV Shield](../README.md). Everything below cost real time, is reproducible against the live
API, and comes with a proposed fix. Nothing here is hypothetical.

Context: headless integration from a TypeScript backend, no browser, starting from zero —
no account, no key, no wallet. Total elapsed: roughly four hours, of which about three were
spent on the six issues below rather than on the product.

---

## 1. Silently-ignored flags are worse than errors

**Severity: high — this one produces a wrong answer rather than a failure.**

`POST /api/execute/contract-call` accepts `usePrivateMempool: true`, returns `200`, and
broadcasts to the public mempool anyway. Private routing is only available on workflow write
nodes.

We only caught it because this project independently watches the mempool: the supposedly
private transaction showed up in our own observer 1.0 seconds before inclusion. A team
without that instrumentation ships believing their transactions are private.

```jsonc
// accepted, 200, and completely without effect
{ "chainId": 11155111, "contractAddress": "0x…", "usePrivateMempool": true }
```

**Fix:** reject unknown or unsupported fields with `400`. If direct execution will never
support private routing, say so in the error:

```jsonc
{
  "error": "unsupported_option",
  "field": "usePrivateMempool",
  "detail": "Private routing is only available on workflow write nodes. See <link>.",
  "hint": "Create a workflow with a web3/write-contract node and set usePrivateMempool on it."
}
```

A silent no-op on a *security* feature is the highest-stakes version of this bug class.

---

## 2. `abi` and `functionArgs` must be JSON strings, and the failure blames the wrong thing

**Severity: high — the error message points away from the cause.**

Both fields are JSON-encoded strings, not arrays. Passing arrays is accepted, then fails
downstream in two different misleading ways:

| What you send | What you get | What it actually means |
|---|---|---|
| `abi: [...]` (array) | `ABI is required. Could not auto-fetch ABI: … Contract may not be verified.` | your ABI was dropped; it fell back to explorer lookup |
| `args: [...]` | `Failed to encode call: types/values length mismatch (count=0, expectedCount=2)` | wrong field name — `functionArgs` is the right one, and it wants a string |

The first message is actively misleading: it says an ABI is required *immediately after you
supplied one*, and sends you off to verify your contract on Etherscan. We did exactly that
before realising the ABI had been ignored. The second reads like a malformed ABI, so you go
inspect the ABI — which is fine.

**Fix:** accept both arrays and JSON strings (a two-line coercion). Failing that, validate
shape up front:

```jsonc
{ "error": "invalid_type", "field": "abi",
  "detail": "abi must be a JSON string. Received array — did you mean JSON.stringify(abi)?" }
```

And never say "ABI is required" when an `abi` field was present but unusable — say
"abi was provided but could not be parsed."

---

## 3. `go-live` returns 200 and does not go live

**Severity: medium.**

```
PUT /api/workflows/{id}/go-live  →  200 OK
GET /api/workflows/{id}          →  { "enabled": false }
POST /api/workflows/{id}/webhook →  410 { "error": "Workflow is disabled" }
```

The endpoint whose name is "go live" is not the one that enables a workflow;
`PATCH /api/workflows/{id}` with `{enabled: true}` is. An earlier attempt with a partial body
returned `400 Name is required`, which suggests `go-live` is a full-replace update that
happens not to carry `enabled` — so it silently drops the one field its name promises.

**Fix:** either make `go-live` enable the workflow, or return `409` explaining what else is
required. A 200 that doesn't do the thing is indistinguishable from success.

---

## 4. Three credential types, discovered one 401 at a time

**Severity: medium — the eventual error message is genuinely excellent.**

There are three credentials and they are not interchangeable:

| Credential | Can do | Cannot do |
|---|---|---|
| `kh_*` org key | `/api/execute/*`, `/mcp`, read + create workflows | fire a workflow, mint keys |
| `wfb_*` webhook key | fire a workflow | everything else |
| browser session cookie | mint keys, `/api/api-keys`, settings | — |

Credit where due — this is the single best error message in the API:

> `Wrong API key type. This endpoint requires a user webhook key (wfb_*). The kh_* prefix is
> an org API key for /api/execute/* and /mcp. Generate a webhook key from the user menu > API
> Keys > Webhook tab, then pass it as Authorization: Bearer wfb_...`

It names the expected type, what the one you sent is for, and exactly where to get the right
one. Every 401 in the API should look like this — but `GET /api/api-keys` just returns
`{"error":"Unauthorized"}` when called with a `kh_` key, when it could say "this endpoint
requires a browser session."

**Fix:** apply the webhook-key error's template to every auth failure. Also consider letting
an org key mint a webhook key — requiring a browser session to obtain the credential that
fires workflows is what forces backend integrations into SIWE gymnastics (see §6).

---

## 5. Private routing silently costs you gas sponsorship

**Severity: medium — a documentation gap, not a bug.**

The sponsored REST path pays your gas. The private workflow path does not:

```
Insufficient ETH balance. Have: 0.0, Need: 0.000046160843904.
Fund 0x330c… with at least 0.000046160843904 ETH on this chain and retry.
```

This error is very good — exact amount, exact address, clear action. The problem is that
nothing before it hinted the two features were mutually exclusive, and the natural mental
model ("KeeperHub sponsors gas") makes the failure surprising at exactly the wrong moment:
after you have built the whole workflow path.

**Fix:** surface it at design time. In the chain picker, the "(Flashbots)" private variants
could carry a note — *"private routing executes from your wallet; gas is not sponsored."*
One line in the UI where the choice is made saves the whole discovery loop.

---

## 6. There is no headless path to a first key

**Severity: medium — structural.**

Every credential ultimately requires a browser session, and there is no documented
machine-to-machine bootstrap. For a backend integration that is a real wall.

It *is* possible — we wrote [`keeperhub-onboard.ts`](../services/operator/src/scripts/keeperhub-onboard.ts)
and [`kh-session.ts`](../services/operator/src/mev/kh-session.ts), which sign in over SIWE
with an existing key, no browser:

1. `POST /api/auth/siwe/nonce` `{walletAddress, chainId}`
2. build the EIP-4361 message, sign, `POST /api/auth/siwe/verify` → session cookie
3. `POST /api/keys {name}` → `401` with a challenge → sign it → retry → `kh_…`
4. `POST /api/api-keys {name, type:"webhook"}` → `wfb_…`

Two things made this harder than it needed to be. The step-up challenge on `/api/keys`
returns `401`, which reads as "you are not authorised" rather than "sign this and try again" —
a `403` with an explicit `"action": "sign_challenge"` would be unambiguous. And the
organisation wallet returned by `/api/user` is a *different address from the signer*, which is
correct but surprising: we funded the signer first and watched executions keep failing.

**Fix:** document the SIWE flow as the supported headless path (it already works), and label
the wallet in `/api/user` — `organizationWallet` rather than `walletAddress` — so nobody
funds the wrong address.

---

## Summary

The API is capable and several of its error messages are best-in-class. The friction is
concentrated in one pattern: **requests that are accepted and then quietly do something other
than what was asked.** The private-mempool flag, the dropped `abi` array, and `go-live` are
all the same failure mode, and it is the most expensive kind to debug because there is nothing
to search for.

Ranked by value of fixing:

1. Reject unknown/unsupported fields instead of ignoring them (§1, §2)
2. Make `go-live` enable, or explain why it didn't (§3)
3. Warn about the sponsorship trade-off where the choice is made (§5)
4. Apply the webhook-key error's quality bar to every 401 (§4)
5. Document SIWE as the supported headless bootstrap; rename `walletAddress` (§6)

Every finding here is reproducible with the scripts in this repository.
