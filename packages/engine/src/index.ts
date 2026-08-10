/**
 * @dorr/engine — the order-commitment primitive.
 *
 * This package began as a broad off-chain perps engine imported from the
 * ZKPerps research repo: matching, margin, funding, liquidation, and a Cardano
 * connector. MEV Shield uses exactly one piece of it — the order commitment —
 * and the rest was Cardano-era code that nothing here imported. It also carried
 * the last placeholders in the repository (a stand-in insurance-fund address, a
 * deterministic "ZK proof" for harness use, a placeholder Pedersen commitment),
 * which is a poor thing to leave lying around in a project whose whole argument
 * is that its numbers are real. Removed rather than explained away.
 */
export * from "./order/commitment.js";
