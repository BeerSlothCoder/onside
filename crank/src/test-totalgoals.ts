// End-to-end test for the total-goals (sum-of-two-stats, Add op) market on a
// FINISHED fixture — before creating any tonight. Creates the market with a
// past min_settle_ts, bets Over, locks, settles with a real TxLINE proof, and
// verifies the on-chain outcome matches home+away goals vs the line.
// Usage: npx tsx crank/src/test-totalgoals.ts [fixtureId] [line=2]
import dotenv from "dotenv";
import * as anchor from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
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
dotenv.config({ path: resolve(REPO_ROOT, ".env") });

const FIXTURE = Number(process.argv[2] ?? 18213979); // NOR-ENG (finished) → total goals
const LINE = Number(process.argv[3] ?? 2); // over 2.5

const toBytes32 = (v: string | number[]) =>
  Array.from(Array.isArray(v) ? Uint8Array.from(v) : Buffer.from(v, "base64"));
const toProofNodes = (ns: Array<{ hash: string | number[]; isRightSibling: boolean }>) =>
  ns.map((n) => ({ hash: toBytes32(n.hash), isRightSibling: n.isRightSibling }));

async function main() {
  const connection = connectionFor("devnet");
  const crank = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(resolve(REPO_ROOT, "wallets/crank.keypair.json"), "utf8")))
  );
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(crank), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const idl = JSON.parse(readFileSync(resolve(REPO_ROOT, "target/idl/onside.json"), "utf8"));
  const program = new anchor.Program(idl, provider);
  const txline = new TxlineDataClient(credentialsFromEnv(process.env as never)!);

  // 1. create the total-goals market (statOver, statKey 1, statKey2 2), past settle time
  const skBuf = Buffer.alloc(4);
  skBuf.writeUInt32LE(1);
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), new BN(FIXTURE).toArrayLike(Buffer, "le", 8), Buffer.from([1]), skBuf],
    program.programId
  );
  const vault = getAssociatedTokenAddressSync(DEVNET_USDC_MINT, market, true);
  if (!(await connection.getAccountInfo(market))) {
    const minSettleTs = 1_600_000_000_000; // Sept 2020 — safely before any 2026 match
    await program.methods
      .createMarket(new BN(FIXTURE), { statOver: {} } as never, 1, 2, LINE, new BN(minSettleTs), new BN(300))
      .accounts({
        creator: crank.publicKey,
        market,
        vault,
        usdcMint: DEVNET_USDC_MINT,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([
        createAssociatedTokenAccountIdempotentInstruction(crank.publicKey, vault, market, DEVNET_USDC_MINT),
      ])
      .rpc();
    console.log(`created total-goals market ${market.toBase58()} (over ${LINE}.5)`);
  } else {
    console.log(`market exists ${market.toBase58()}`);
  }

  // 2. throwaway bettor: fund + faucet + bet OVER (side 0)
  const bettor = Keypair.generate();
  await anchor.web3.sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.transfer({ fromPubkey: crank.publicKey, toPubkey: bettor.publicKey, lamports: 60_000_000 })
    ),
    [crank]
  );
  const bp = new anchor.AnchorProvider(connection, new anchor.Wallet(bettor), { commitment: "confirmed" });
  const bpProgram = new anchor.Program(idl, bp);
  const bettorToken = getAssociatedTokenAddressSync(DEVNET_USDC_MINT, bettor.publicKey);
  const [faucetAuth] = PublicKey.findProgramAddressSync([Buffer.from("faucet_auth")], program.programId);
  await bpProgram.methods
    .faucet(new BN(5_000_000))
    .accounts({
      user: bettor.publicKey,
      usdcMint: DEVNET_USDC_MINT,
      userToken: bettorToken,
      faucetAuthority: faucetAuth,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  const [betPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bet"), market.toBuffer(), bettor.publicKey.toBuffer()],
    program.programId
  );
  await bpProgram.methods
    .placeBet(0, new BN(2_000_000))
    .accounts({
      bettor: bettor.publicKey,
      market,
      bet: betPda,
      vault,
      bettorToken,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log("bet 2 tUSDC on OVER ✅");

  // 3. lock (idempotent — may already be open→locked)
  try {
    await program.methods.lockMarket().accounts({ cranker: crank.publicKey, market }).rpc();
    console.log("locked ✅");
  } catch (e: any) {
    console.log("lock skipped:", (e.error?.errorMessage ?? e.message ?? "").slice(0, 60));
  }

  // 4. settle with a real proof (statKey 1 + statKey2 2 → sum)
  const snap = (await txline.scoresSnapshot(FIXTURE)) as any[];
  const bySeq = (els: any[]) => els.sort((a, b) => (a.Seq ?? 0) - (b.Seq ?? 0));
  const statsEl = bySeq(snap.filter((u) => u.Stats)).at(-1);
  const seq = statsEl.Seq;
  const stats: Record<string, number> = statsEl.Stats;
  const total = (stats["1"] ?? 0) + (stats["2"] ?? 0);
  const outcome = total > LINE ? 0 : 1;
  console.log(`final goals: ${stats["1"]}+${stats["2"]}=${total} → over ${LINE}.5 = ${outcome === 0 ? "OVER" : "UNDER"}`);

  const v = await txline.statValidation({ fixtureId: FIXTURE, seq, statKey: 1, statKey2: 2 });
  const args: any = {
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
    predicate: { threshold: 0, comparison: { greaterThan: {} } },
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
    op: { add: {} },
  };
  const epochDay = Math.floor(v.summary.updateStats.minTimestamp / 86_400_000);
  const [rootsPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],
    TXLINE_CONFIG.devnet.programId
  );
  const sig = await program.methods
    .settle(outcome, { args } as never)
    .accounts({
      settler: crank.publicKey,
      market,
      txlineRoots: rootsPda,
      txoracleProgram: TXLINE_CONFIG.devnet.programId,
    })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
    .rpc();
  console.log(`✅ SETTLED total-goals → outcome ${outcome} (${sig.slice(0, 24)}…)`);

  const settled: any = await (program.account as any).market.fetch(market);
  console.log("market outcome on-chain:", settled.outcome, "state:", JSON.stringify(settled.state));
  if (settled.outcome !== outcome) throw new Error("outcome mismatch!");
  console.log("\nTOTAL-GOALS SETTLEMENT VERIFIED ✅ (Add op, real Merkle proof)");
}

main().catch((e) => {
  console.error("FAILED:", e.error?.errorMessage ?? e.message ?? e);
  if (e.logs) console.error(e.logs.join("\n"));
  process.exit(1);
});
