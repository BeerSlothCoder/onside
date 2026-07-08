/**
 * Stage 2b e2e (devnet): the full money loop on a real finished fixture.
 *
 *   1. read final score of Mexico–England (fixture 18192996) from TxLINE
 *   2. fetch the Merkle stat-validation proof for the final update
 *   3. create a MatchResult market (30 s finality window for the test)
 *   4. crank bets 10 tUSDC on the TRUE outcome;
 *      a second funded burner bets 5 tUSDC on a WRONG outcome
 *   5. lock → settle with the proof → wait out the finality window
 *   6. winner claims (pro-rata share of the whole pot);
 *      loser's claim must fail
 */
import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  createMintToInstruction,
} from "@solana/spl-token";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  connectionFor,
  credentialsFromEnv,
  DEVNET_USDC_MINT,
  TxlineDataClient,
  TXLINE_CONFIG,
} from "@onside/txline-client";

const BN = (anchor as any).BN ?? (anchor as any).default.BN;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const FIXTURE_ID = 18192996; // Mexico vs England (finished)
const USDC = (n: number) => new BN(Math.round(n * 1e6));

function toBytes32(value: string | number[]): number[] {
  const bytes = Array.isArray(value) ? Uint8Array.from(value) : Buffer.from(value, "base64");
  if (bytes.length !== 32) throw new Error(`Expected 32 bytes, got ${bytes.length}`);
  return Array.from(bytes);
}
const toProofNodes = (ns: Array<{ hash: string | number[]; isRightSibling: boolean }>) =>
  ns.map((n) => ({ hash: toBytes32(n.hash), isRightSibling: n.isRightSibling }));

async function main() {
  const connection = connectionFor("devnet");
  const crank = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(resolve(REPO_ROOT, "wallets/crank.keypair.json"), "utf8")))
  );
  const wallet = new anchor.Wallet(crank);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const idl = JSON.parse(readFileSync(resolve(REPO_ROOT, "target/idl/onside.json"), "utf8"));
  const program = new anchor.Program(idl, provider);

  // ── 1. final score from TxLINE ─────────────────────────────────
  const creds = credentialsFromEnv(process.env as never);
  if (!creds) throw new Error("TxLINE credentials missing in .env");
  const txline = new TxlineDataClient(creds);
  const updates = await txline.scoresHistorical(FIXTURE_ID);
  const last = updates.at(-1) as any;
  const finalSeq = last.Seq as number;
  const stats = last.Stats as Record<string, number>;
  const [home, away] = [stats["1"] ?? 0, stats["2"] ?? 0];
  const trueOutcome = home > away ? 0 : home < away ? 2 : 1;
  const wrongOutcome = (trueOutcome + 1) % 3;
  console.log(`Mexico ${home}–${away} England | final seq ${finalSeq} | true outcome side ${trueOutcome}`);

  // ── 2. Merkle proof for the final update ───────────────────────
  const v = await txline.statValidation({ fixtureId: FIXTURE_ID, seq: finalSeq, statKey: 1, statKey2: 2 });
  const proofArgs = {
    ts: new BN(v.summary.updateStats.minTimestamp),
    fixtureSummary: {
      fixtureId: new BN(v.summary.fixtureId),
      updateStats: {
        updateCount: v.summary.updateStats.updateCount,
        minTimestamp: new BN(v.summary.updateStats.minTimestamp),
        maxTimestamp: new BN(v.summary.updateStats.maxTimestamp),
      },
      eventsSubTreeRoot: toBytes32(v.summary.eventStatsSubTreeRoot as never),
    },
    fixtureProof: toProofNodes(v.subTreeProof as never),
    mainTreeProof: toProofNodes(v.mainTreeProof as never),
    predicate: { threshold: 0, comparison: { greaterThan: {} } }, // overwritten on-chain
    statA: {
      statToProve: v.statToProve,
      eventStatRoot: toBytes32(v.eventStatRoot as never),
      statProof: toProofNodes(v.statProof as never),
    },
    statB: {
      statToProve: v.statToProve2,
      eventStatRoot: toBytes32(v.eventStatRoot as never),
      statProof: toProofNodes(v.statProof2 as never),
    },
    op: { subtract: {} },
  };
  console.log("proof fetched: stats", JSON.stringify(v.statToProve), JSON.stringify(v.statToProve2));

  // ── 3. market ──────────────────────────────────────────────────
  const statKeyBuf = Buffer.alloc(4);
  statKeyBuf.writeUInt32LE(1);
  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), new BN(FIXTURE_ID).toArrayLike(Buffer, "le", 8), Buffer.from([0]), statKeyBuf],
    program.programId
  );
  const vault = getAssociatedTokenAddressSync(DEVNET_USDC_MINT, marketPda, true);
  console.log("market:", marketPda.toBase58());

  if (!(await connection.getAccountInfo(marketPda))) {
    const createVaultIx = createAssociatedTokenAccountIdempotentInstruction(
      crank.publicKey, vault, marketPda, DEVNET_USDC_MINT
    );
    await program.methods
      .createMarket(
        new BN(FIXTURE_ID), { matchResult: {} } as never, 1, 2, 0,
        new BN(v.summary.updateStats.minTimestamp).subn(1000),
        new BN(30) // 30 s finality window for the test
      )
      .accounts({
        creator: crank.publicKey, market: marketPda, vault,
        usdcMint: DEVNET_USDC_MINT, systemProgram: SystemProgram.programId,
      })
      .preInstructions([createVaultIx])
      .rpc();
    console.log("market created (finality 30s)");
  }

  // ── 4. two bettors ─────────────────────────────────────────────
  const loser = Keypair.generate();
  const crankAta = getAssociatedTokenAddressSync(DEVNET_USDC_MINT, crank.publicKey);
  const loserAta = getAssociatedTokenAddressSync(DEVNET_USDC_MINT, loser.publicKey);

  // fund burner: SOL for fees + tUSDC (we are the mint authority)
  const fundTx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: crank.publicKey, toPubkey: loser.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL }),
    createAssociatedTokenAccountIdempotentInstruction(crank.publicKey, loserAta, loser.publicKey, DEVNET_USDC_MINT),
    createMintToInstruction(DEVNET_USDC_MINT, loserAta, crank.publicKey, 5_000_000)
  );
  await provider.sendAndConfirm(fundTx, [crank]);
  console.log("burner funded: 0.05 SOL + 5 tUSDC");

  const betAccounts = (bettor: PublicKey, token: PublicKey) => {
    const [betPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bet"), marketPda.toBuffer(), bettor.toBuffer()],
      program.programId
    );
    return { betPda, accounts: {
      bettor, market: marketPda, bet: betPda, vault, bettorToken: token,
      tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      systemProgram: SystemProgram.programId,
    }};
  };

  const winnerBet = betAccounts(crank.publicKey, crankAta);
  await program.methods.placeBet(trueOutcome, USDC(10)).accounts(winnerBet.accounts).rpc();
  console.log(`crank bet 10 tUSDC on TRUE outcome (${trueOutcome})`);

  const loserBet = betAccounts(loser.publicKey, loserAta);
  await program.methods.placeBet(wrongOutcome, USDC(5)).accounts(loserBet.accounts).signers([loser]).rpc();
  console.log(`burner bet 5 tUSDC on WRONG outcome (${wrongOutcome})`);

  // ── 5. lock + settle ───────────────────────────────────────────
  await program.methods.lockMarket().accounts({ cranker: crank.publicKey, market: marketPda }).rpc();
  const epochDay = Math.floor(v.summary.updateStats.minTimestamp / 86_400_000);
  const [dailyScoresPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],
    TXLINE_CONFIG.devnet.programId
  );
  const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
  const settleSig = await program.methods
    .settle(trueOutcome, { args: proofArgs } as never)
    .accounts({
      settler: crank.publicKey, market: marketPda,
      txlineRoots: dailyScoresPda, txoracleProgram: TXLINE_CONFIG.devnet.programId,
    })
    .preInstructions([computeIx])
    .rpc();
  console.log("settled with Merkle proof:", settleSig.slice(0, 20) + "…");

  // ── 6. wait out finality, then claims ──────────────────────────
  console.log("waiting 35s for the finality window…");
  await new Promise((r) => setTimeout(r, 35_000));

  const before = (await getAccount(connection, crankAta)).amount;
  await program.methods.claim().accounts(winnerBet.accounts).rpc();
  const after = (await getAccount(connection, crankAta)).amount;
  console.log(`✅ winner claimed: +${(Number(after - before) / 1e6).toFixed(2)} tUSDC (stake 10, pot 15)`);

  try {
    await program.methods.claim().accounts(loserBet.accounts).signers([loser]).rpc();
    console.log("❌ SECURITY FAILURE: losing bet claimed!");
    process.exit(1);
  } catch (e: any) {
    console.log("✅ losing claim rejected:", (e.error?.errorMessage ?? e.message).slice(0, 60));
  }
}

main().catch((e) => {
  console.error("FAILED:", e.error?.errorMessage ?? e.logs?.slice(-5) ?? e.message ?? e);
  process.exit(1);
});
