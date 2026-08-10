/**
 * Contract ABIs and bytecode, read from the Foundry build output.
 *
 * Deliberately loaded from `contracts/out/` rather than hand-transcribed: a
 * hand-written ABI silently drifts from the Solidity it claims to describe, and
 * a drifted `swap` selector would make the searcher blind to exactly the
 * transactions it exists to detect — the failure would look like "private
 * routing worked", which is the one wrong answer this project must never give.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Abi, Hex } from "viem";
import { DORR_ROOT } from "../env.js";

const OUT = resolve(DORR_ROOT, "contracts/out");

interface Artifact {
  abi: Abi;
  bytecode: { object: Hex };
}

function load(file: string, contract: string): Artifact {
  const path = resolve(OUT, file, `${contract}.json`);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Artifact;
  } catch {
    throw new Error(
      `missing artifact ${path} — run \`forge build\` in contracts/ before using the MEV lab`,
    );
  }
}

const poolArtifact = load("MevPool.sol", "MevPool");
const tokenArtifact = load("MevToken.sol", "MevToken");

export const POOL_ABI = poolArtifact.abi;
export const POOL_BYTECODE = poolArtifact.bytecode.object;
export const TOKEN_ABI = tokenArtifact.abi;
export const TOKEN_BYTECODE = tokenArtifact.bytecode.object;
