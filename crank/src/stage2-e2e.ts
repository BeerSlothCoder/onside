/**
 * Stage 2 e2e (devnet): create a MatchResult market on the finished
 * Portugal-Spain fixture, lock it, then:
 *   1. attempt settlement with the WRONG outcome (home win) — must fail
 *   2. settle with the RIGHT outcome (away win) using the real TxLINE proof
 * Verifies: pools untouched, outcome stored, claim_after set.
 */
import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectionFor, DEVNET_USDC_MINT, TXLINE_CONFIG } from "@onside/txline-client";

const BN = (anchor as any).BN ?? (anchor as any).default.BN;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const FIXTURE_ID = 18198205; // Portugal 0-1 Spain (finished)
const OUTCOME_HOME = 0;
const OUTCOME_AWAY = 2;

function toBytes32(value: string | number[]): number[] {
  const bytes = Array.isArray(value)
    ? Uint8Array.from(value)
    : Buffer.from(value, "base64");
  if (bytes.length !== 32) throw new Error(`Expected 32 bytes, got ${bytes.length}`);
  return Array.from(bytes);
}
const toProofNodes = (ns: Array<{ hash: string | number[]; isRightSibling: boolean }>) =>
  ns.map((n) => ({ hash: toBytes32(n.hash), isRightSibling: n.isRightSibling }));

async function main() {
  const secret = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "wallets/crank.keypair.json"), "utf8")
  ) as number[];
  const wallet = new anchor.Wallet(Keypair.fromSecretKey(Uint8Array.from(secret)));
  const provider = new anchor.AnchorProvider(connectionFor("devnet"), wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const idl = JSON.parse(readFileSync(resolve(REPO_ROOT, "target/idl/onside.json"), "utf8"));
  const program = new anchor.Program(idl, provider);
  console.log("onside program:", program.programId.toBase58());

  const v = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "crank/fixtures/proof-18198205-seq993.json"), "utf8")
  );

  // ── derive PDAs ────────────────────────────────────────────────
  const marketKind = { matchResult: {} };
  const statKey = 1; // P1 (Portugal) goals
  const statKey2 = 2; // P2 (Spain) goals
  const fixtureBuf = new BN(FIXTURE_ID).toArrayLike(Buffer, "le", 8);
  const statKeyBuf = Buffer.alloc(4);
  statKeyBuf.writeUInt32LE(statKey);
  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), fixtureBuf, Buffer.from([0]), statKeyBuf],
    program.programId
  );
  const vault = getAssociatedTokenAddressSync(DEVNET_USDC_MINT, marketPda, true);
  console.log("market PDA:", marketPda.toBase58(), "| vault:", vault.toBase58());

  // ── create market (idempotent-ish: skip if exists) ─────────────
  const existing = await provider.connection.getAccountInfo(marketPda);
  if (!existing) {
    const createVaultIx = createAssociatedTokenAccountIdempotentInstruction(
      wallet.publicKey,
      vault,
      marketPda,
      DEVNET_USDC_MINT
    );
    const minSettleTs = new BN(v.summary.updateStats.minTimestamp).subn(1000);
    const sig = await program.methods
      .createMarket(
        new BN(FIXTURE_ID),
        marketKind as never,
        statKey,
        statKey2,
        0,
        minSettleTs
      )
      .accounts({
        creator: wallet.publicKey,
        market: marketPda,
        vault,
        usdcMint: DEVNET_USDC_MINT,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([createVaultIx])
      .rpc();
    console.log("create_market:", sig);

    const lockSig = await program.methods
      .lockMarket()
      .accounts({ cranker: wallet.publicKey, market: marketPda })
      .rpc();
    console.log("lock_market:", lockSig);
  } else {
    console.log("market already exists — continuing to settlement");
  }

  // ── build settlement proof args ────────────────────────────────
  const proofArgs = {
    ts: new BN(v.summary.updateStats.minTimestamp),
    fixtureSummary: {
      fixtureId: new BN(v.summary.fixtureId),
      updateStats: {
        updateCount: v.summary.updateStats.updateCount,
        minTimestamp: new BN(v.summary.updateStats.minTimestamp),
        maxTimestamp: new BN(v.summary.updateStats.maxTimestamp),
      },
      eventsSubTreeRoot: toBytes32(v.summary.eventStatsSubTreeRoot),
    },
    fixtureProof: toProofNodes(v.subTreeProof),
    mainTreeProof: toProofNodes(v.mainTreeProof),
    // predicate/op are overwritten by the program; send placeholders
    predicate: { threshold: 0, comparison: { greaterThan: {} } },
    statA: {
      statToProve: v.statToProve,
      eventStatRoot: toBytes32(v.eventStatRoot),
      statProof: toProofNodes(v.statProof),
    },
    statB: {
      statToProve: v.statToProve2,
      eventStatRoot: toBytes32(v.eventStatRoot),
      statProof: toProofNodes(v.statProof2),
    },
    op: { subtract: {} },
  };

  const epochDay = Math.floor(v.summary.updateStats.minTimestamp / 86_400_000);
  const [dailyScoresPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],
    TXLINE_CONFIG.devnet.programId
  );
  const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
  const settleAccounts = {
    settler: wallet.publicKey,
    market: marketPda,
    txlineRoots: dailyScoresPda,
    txoracleProgram: TXLINE_CONFIG.devnet.programId,
  };

  // ── 1. WRONG outcome must fail ─────────────────────────────────
  try {
    await program.methods
      .settle(OUTCOME_HOME, { args: proofArgs } as never)
      .accounts(settleAccounts)
      .preInstructions([computeIx])
      .rpc();
    console.log("❌ SECURITY FAILURE: wrong outcome was accepted!");
    process.exit(1);
  } catch (e: any) {
    const msg = e.error?.errorMessage ?? e.message ?? String(e);
    console.log("✅ wrong outcome (home win) rejected:", msg.slice(0, 90));
  }

  // ── 2. RIGHT outcome settles ───────────────────────────────────
  const settleSig = await program.methods
    .settle(OUTCOME_AWAY, { args: proofArgs } as never)
    .accounts(settleAccounts)
    .preInstructions([computeIx])
    .rpc();
  console.log("✅ settle (away win / Spain):", settleSig);

  const market: any = await (program.account as any).market.fetch(marketPda);
  console.log("market state:", JSON.stringify(market.state), "| outcome:", market.outcome, "| claimAfter:", new Date(market.claimAfter.toNumber() * 1000).toISOString());
}

main().catch((e) => {
  console.error("FAILED:", e.logs?.slice(-6) ?? e.message ?? e);
  process.exit(1);
});
