/**
 * Headless KeeperHub onboarding.
 *
 * Signs in with the Ethereum deployer key over SIWE (no browser, no Turnstile),
 * mints an organisation API key, and reports the ORGANISATION wallet — which is
 * a different address from the signing key and is the one that actually needs
 * funding.
 *
 *   bun run src/scripts/keeperhub-onboard.ts
 *
 * Writes nothing; prints the key once so it can be pasted into .env.
 */
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../env.js";

const BASE = process.env.KEEPERHUB_BASE_URL || "https://app.keeperhub.com";
const ORIGIN = BASE;

let cookie = "";

interface Res<T = any> {
  status: number;
  body: T;
}

async function api<T = any>(path: string, init: RequestInit = {}): Promise<Res<T>> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      ...(cookie ? { cookie } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  // Capture the session cookie SIWE hands back.
  const set = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  if (set.length) {
    cookie = set.map((c) => c.split(";")[0]).join("; ");
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 300);
  }
  return { status: res.status, body: body as T };
}

function siweMessage(p: {
  domain: string;
  address: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
}) {
  return [
    `${p.domain} wants you to sign in with your Ethereum account:`,
    p.address,
    "",
    "Sign in to KeeperHub",
    "",
    `URI: ${p.uri}`,
    "Version: 1",
    `Chain ID: ${p.chainId}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${p.issuedAt}`,
  ].join("\n");
}

async function main() {
  const pk = env.eth.deployerKey;
  if (!pk) throw new Error("ETH_DEPLOYER_KEY missing in .env");
  const account = privateKeyToAccount(pk as `0x${string}`);
  const address = account.address;

  console.log("═".repeat(68));
  console.log("KeeperHub headless onboarding");
  console.log("═".repeat(68));
  console.log(`signing wallet: ${address}`);
  console.log(`base:           ${BASE}`);

  // 1. nonce
  console.log("\n[1] request SIWE nonce");
  const nonceRes = await api<{ nonce?: string; message?: string }>("/api/auth/siwe/nonce", {
    method: "POST",
    body: JSON.stringify({ walletAddress: address, chainId: 1 }),
  });
  console.log(`   ${nonceRes.status} ${JSON.stringify(nonceRes.body).slice(0, 220)}`);
  if (nonceRes.status !== 200) throw new Error("nonce request failed");

  const nonce = (nonceRes.body as any).nonce ?? (nonceRes.body as any).data?.nonce;
  if (!nonce) throw new Error(`no nonce in response: ${JSON.stringify(nonceRes.body).slice(0, 200)}`);

  // 2. sign + verify. If the server handed us a full message, sign that verbatim.
  console.log("\n[2] sign + verify");
  const domain = new URL(BASE).host;
  const message =
    (nonceRes.body as any).message ??
    siweMessage({
      domain,
      address,
      uri: BASE,
      chainId: 1,
      nonce,
      issuedAt: new Date().toISOString(),
    });
  const signature = await account.signMessage({ message });

  const verify = await api<any>("/api/auth/siwe/verify", {
    method: "POST",
    body: JSON.stringify({ message, signature, walletAddress: address, chainId: 1 }),
  });
  console.log(`   ${verify.status} ${JSON.stringify(verify.body).slice(0, 220)}`);
  if (verify.status !== 200) throw new Error("SIWE verify failed");
  console.log(`   session cookie: ${cookie ? "acquired" : "MISSING"}`);

  // 3. mint an org API key (step-up: first call 401s with a challenge to sign)
  console.log("\n[3] mint organisation API key");
  let keyRes = await api<any>("/api/keys", {
    method: "POST",
    body: JSON.stringify({ name: "dorr-mev-shield" }),
  });
  console.log(`   ${keyRes.status} ${JSON.stringify(keyRes.body).slice(0, 220)}`);

  if (keyRes.status === 401) {
    const challenge =
      keyRes.body?.challenge ?? keyRes.body?.data?.challenge ?? keyRes.body?.error?.challenge;
    if (!challenge) {
      throw new Error(
        `401 without a challenge — not a step-up. Body: ${JSON.stringify(keyRes.body).slice(0, 300)}`,
      );
    }
    console.log("   signing step-up challenge…");
    const challengeSig = await account.signMessage({ message: String(challenge) });
    keyRes = await api<any>("/api/keys", {
      method: "POST",
      body: JSON.stringify({ name: "dorr-mev-shield", signature: challengeSig }),
    });
    console.log(`   ${keyRes.status} ${JSON.stringify(keyRes.body).slice(0, 220)}`);
  }

  const apiKey = keyRes.body?.key ?? keyRes.body?.data?.key ?? keyRes.body?.apiKey;
  if (!apiKey) throw new Error("no API key returned");

  // 4. the ORGANISATION wallet — the address that actually needs funding
  console.log("\n[4] organisation wallet");
  const bearer = { authorization: `Bearer ${apiKey}` };
  let orgWallet: string | undefined;
  for (let i = 0; i < 10; i++) {
    const u = await api<any>("/api/user", { headers: bearer });
    orgWallet = u.body?.walletAddress ?? u.body?.data?.walletAddress;
    if (orgWallet) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log("\n" + "═".repeat(68));
  console.log("✓ ONBOARDED");
  console.log(`  KEEPERHUB_API_KEY="${apiKey}"`);
  console.log(`  org wallet (FUND THIS, not the signer): ${orgWallet ?? "still provisioning"}`);
  console.log("═".repeat(68));
  console.log("\nPaste the key into .env, then run: bun run src/scripts/keeperhub-smoke.ts");
}

main().catch((e) => {
  console.error("\n✗ onboarding failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
