/**
 * Stage 1 proof-of-concept: validate a real World Cup result on-chain.
 * Uses the saved proof fixture (Portugal 0-1 Spain, fixture 18198205,
 * seq 993) and calls txoracle.validateStat via .view() on devnet.
 * Predicate: P1 goals - P2 goals < 0  →  away win (Spain).
 */
import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectionFor, TXLINE_CONFIG } from "@onside/txline-client";

const BN = (anchor as any).BN ?? (anchor as any).default.BN;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function toBytes32(value: string | number[]): number[] {
  const bytes = Array.isArray(value)
    ? Uint8Array.from(value)
    : value.startsWith("0x")
      ? Buffer.from(value.slice(2), "hex")
      : Buffer.from(value, "base64");
  if (bytes.length !== 32) throw new Error(`Expected 32 bytes, got ${bytes.length}`);
  return Array.from(bytes);
}

function toProofNodes(nodes: Array<{ hash: string | number[]; isRightSibling: boolean }>) {
  return nodes.map((n) => ({ hash: toBytes32(n.hash), isRightSibling: n.isRightSibling }));
}

async function main() {
  const secret = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "wallets/crank.keypair.json"), "utf8")
  ) as number[];
  const wallet = new anchor.Wallet(Keypair.fromSecretKey(Uint8Array.from(secret)));
  const provider = new anchor.AnchorProvider(connectionFor("devnet"), wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const idl = JSON.parse(readFileSync(resolve(REPO_ROOT, "crank/idl/txoracle.json"), "utf8"));
  const program = new anchor.Program(idl, provider);

  const v = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "crank/fixtures/proof-18198205-seq993.json"), "utf8")
  );

  const fixtureSummary = {
    fixtureId: new BN(v.summary.fixtureId),
    updateStats: {
      updateCount: v.summary.updateStats.updateCount,
      minTimestamp: new BN(v.summary.updateStats.minTimestamp),
      maxTimestamp: new BN(v.summary.updateStats.maxTimestamp),
    },
    eventsSubTreeRoot: toBytes32(v.summary.eventStatsSubTreeRoot),
  };

  const statA = {
    statToProve: v.statToProve,
    eventStatRoot: toBytes32(v.eventStatRoot),
    statProof: toProofNodes(v.statProof),
  };
  const statB = {
    statToProve: v.statToProve2,
    eventStatRoot: toBytes32(v.eventStatRoot),
    statProof: toProofNodes(v.statProof2),
  };

  // P1 - P2 < 0  →  Spain (away) won
  const predicate = { threshold: 0, comparison: { lessThan: {} } };
  const op = { subtract: {} };

  const targetTs = v.summary.updateStats.minTimestamp;
  const epochDay = Math.floor(targetTs / 86_400_000);
  const [dailyScoresPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],
    TXLINE_CONFIG.devnet.programId
  );
  console.log("fixture: Portugal vs Spain (18198205), final seq 993");
  console.log("epochDay:", epochDay, "| roots PDA:", dailyScoresPda.toBase58());

  const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

  const isValid = await program.methods
    .validateStat(
      new BN(targetTs),
      fixtureSummary,
      toProofNodes(v.subTreeProof) as never,
      toProofNodes(v.mainTreeProof) as never,
      predicate as never,
      statA as never,
      statB as never,
      op as never
    )
    .accounts({ dailyScoresMerkleRoots: dailyScoresPda })
    .preInstructions([computeIx])
    .view();

  console.log("ON-CHAIN VALIDATION — 'away win by goal difference':", isValid);

  // Negative control: claim home win (P1 - P2 > 0) — must be false/rejected.
  const wrongPredicate = { threshold: 0, comparison: { greaterThan: {} } };
  const isWrongValid = await program.methods
    .validateStat(
      new BN(targetTs),
      fixtureSummary,
      toProofNodes(v.subTreeProof) as never,
      toProofNodes(v.mainTreeProof) as never,
      wrongPredicate as never,
      statA as never,
      statB as never,
      op as never
    )
    .accounts({ dailyScoresMerkleRoots: dailyScoresPda })
    .preInstructions([computeIx])
    .view()
    .catch((e: Error) => `rejected (${e.message?.slice(0, 60)})`);
  console.log("NEGATIVE CONTROL — 'home win' claim:", isWrongValid);
}

main().catch((e) => {
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
});
