/**
 * Headless KeeperHub *session* auth, as opposed to org-key auth.
 *
 * KeeperHub has three separate credentials and they are not interchangeable —
 * this tripped up every step of building the private lane, so it is written
 * down here rather than rediscovered:
 *
 *   kh_*   org API key    -> /api/execute/*, /mcp, and reading workflows
 *   wfb_*  webhook key    -> POST /api/workflows/{id}/webhook (firing one)
 *   cookie browser session -> minting keys, /api/api-keys, account settings
 *
 * The webhook key can only be minted with the cookie, and the cookie can only
 * be obtained by signing in. Doing that through a browser would make the whole
 * pipeline un-automatable, so this signs in over SIWE with the deployer key —
 * the same thing the web app does, minus the browser.
 */
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { env } from "../env.js";

const BASE = env.keeperhub.baseUrl;

export interface Session {
  cookie: string;
  address: Hex;
  sign(message: string): Promise<Hex>;
}

function siweMessage(p: {
  domain: string;
  address: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
}): string {
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

/** Sign in over SIWE and return a live browser-equivalent session. */
export async function siweLogin(): Promise<Session> {
  const pk = env.eth.deployerKey;
  if (!pk) throw new Error("ETH_DEPLOYER_KEY missing — cannot sign in to KeeperHub");
  const account = privateKeyToAccount(pk as Hex);

  let cookie = "";
  const request = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(BASE + path, {
      ...init,
      headers: {
        "content-type": "application/json",
        origin: BASE,
        ...(cookie ? { cookie } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    const set = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 300) };
    }
    return { status: res.status, body };
  };

  const nonceRes = await request("/api/auth/siwe/nonce", {
    method: "POST",
    body: JSON.stringify({ walletAddress: account.address, chainId: 1 }),
  });
  const nonce = nonceRes.body?.nonce ?? nonceRes.body?.data?.nonce;
  if (!nonce) throw new Error(`SIWE nonce failed (HTTP ${nonceRes.status})`);

  const message =
    nonceRes.body?.message ??
    siweMessage({
      domain: new URL(BASE).host,
      address: account.address,
      uri: BASE,
      chainId: 1,
      nonce,
      issuedAt: new Date().toISOString(),
    });
  const signature = await account.signMessage({ message });

  const verify = await request("/api/auth/siwe/verify", {
    method: "POST",
    body: JSON.stringify({ message, signature, walletAddress: account.address, chainId: 1 }),
  });
  if (verify.status !== 200 || !cookie) {
    throw new Error(`SIWE verify failed (HTTP ${verify.status})`);
  }

  return {
    cookie,
    address: account.address,
    sign: (m: string) => account.signMessage({ message: m }),
  };
}

/**
 * Mint a webhook key (`wfb_*`), the only credential that can fire a workflow.
 *
 * Sensitive endpoints answer the first attempt with 401 plus a challenge to
 * sign — a step-up, not a failure. Signing it and retrying is the intended
 * flow, so that round-trip is handled here.
 */
export async function mintWebhookKey(session: Session, name: string): Promise<string> {
  const post = async (body: Record<string, unknown>) => {
    const res = await fetch(`${BASE}/api/api-keys`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, cookie: session.cookie },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text.slice(0, 300) };
    }
    return { status: res.status, body: parsed };
  };

  let res = await post({ name, type: "webhook" });
  if (res.status === 401) {
    const challenge = res.body?.challenge ?? res.body?.data?.challenge ?? res.body?.error?.challenge;
    if (challenge) {
      res = await post({ name, type: "webhook", signature: await session.sign(String(challenge)) });
    }
  }

  const key = res.body?.key ?? res.body?.apiKey ?? res.body?.data?.key;
  if (!key) {
    throw new Error(
      `could not mint a webhook key (HTTP ${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`,
    );
  }
  return String(key);
}
