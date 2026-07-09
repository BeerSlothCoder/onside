/**
 * Seed open markets with starter liquidity so pool odds are meaningful
 * from the first pageview. Uses three dedicated seeder wallets (one per
 * side) funded with SOL from the crank and tUSDC from the on-chain faucet.
 *
 * 1X2 seeding shape ~ favourite/draw/underdog; O/U seeding ~ even.
 */
import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectionFor, DEVNET_USDC_MINT } from "@onside/txline-client";

const BN = (anchor as any).BN ?? (anchor as any).default.BN;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// pool shape per market kind (tUSDC per side)
const SHAPE_1X2 = [20, 12, 16];
const SHAPE_OU = [10, 12];

function loadOrCreateSeeder(i: number): Keypair {
  const path = resolve(REPO_ROOT, `wallets/seeder-${i}.keypair.json`);
  if (existsSync(path)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  }
  const kp = Keypair.generate();
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

async function main() {
  const connection = connectionFor("devnet");
  const crank = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(resolve(REPO_ROOT, "wallets/crank.keypair.json"), "utf8")))
  );
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(crank), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const idl = JSON.parse(readFileSync(resolve(REPO_ROOT, "target/idl/onside.json"), "utf8"));
  const program = new anchor.Program(idl, provider);

  const seeders = [0, 1, 2].map(loadOrCreateSeeder);

  // fund seeders: SOL for fees + faucet tUSDC (100 max per call)
  for (const s of seeders) {
    const bal = await connection.getBalance(s.publicKey);
    if (bal < 0.02 * LAMPORTS_PER_SOL) {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: crank.publicKey,
          toPubkey: s.publicKey,
          lamports: 0.05 * LAMPORTS_PER_SOL,
        })
      );
      await provider.sendAndConfirm(tx, [crank]);
    }
    const [faucetAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from("faucet_auth")],
      program.programId
    );
    const sProvider = new anchor.AnchorProvider(connection, new anchor.Wallet(s), {
      commitment: "confirmed",
    });
    const sProgram = new anchor.Program(idl, sProvider);
    await sProgram.methods
      .faucet(new BN(100_000_000))
      .accounts({
        user: s.publicKey,
        usdcMint: DEVNET_USDC_MINT,
        userToken: getAssociatedTokenAddressSync(DEVNET_USDC_MINT, s.publicKey),
        faucetAuthority: faucetAuth,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ATA_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`seeder ${s.publicKey.toBase58().slice(0, 8)}… funded (+100 tUSDC)`);
  }

  // derive market PDAs directly (avoids throttled getProgramAccounts):
  // per fixture: matchResult (kind 0, statKey 1) + statOver corners (kind 1, statKey 7)
  const FIXTURES = [18209181, 18218149, 18213979, 18222446];
  const pdas: PublicKey[] = [];
  for (const fx of FIXTURES) {
    for (const [kind, statKey] of [[0, 1], [1, 7]] as const) {
      const skBuf = Buffer.alloc(4);
      skBuf.writeUInt32LE(statKey);
      pdas.push(
        PublicKey.findProgramAddressSync(
          [Buffer.from("market"), new BN(fx).toArrayLike(Buffer, "le", 8), Buffer.from([kind]), skBuf],
          program.programId
        )[0]
      );
    }
  }
  const open: any[] = [];
  for (const pda of pdas) {
    try {
      const acc = await (program.account as any).market.fetch(pda);
      if (JSON.stringify(acc.state) === '{"open":{}}') open.push({ publicKey: pda, account: acc });
    } catch {
      /* not created */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log("open markets:", open.length);

  for (const m of open) {
    const isMatchResult = JSON.stringify(m.account.marketKind) === '{"matchResult":{}}';
    const shape = isMatchResult ? SHAPE_1X2 : SHAPE_OU;
    for (let side = 0; side < shape.length; side++) {
      const seeder = seeders[side];
      const sProvider = new anchor.AnchorProvider(connection, new anchor.Wallet(seeder), {
        commitment: "confirmed",
      });
      const sProgram = new anchor.Program(idl, sProvider);
      const [betPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("bet"), m.publicKey.toBuffer(), seeder.publicKey.toBuffer()],
        program.programId
      );
      if (await connection.getAccountInfo(betPda)) {
        console.log(`  ${m.publicKey.toBase58().slice(0, 8)}… side ${side}: already seeded`);
        continue;
      }
      try {
        await sProgram.methods
          .placeBet(side, new BN(shape[side] * 1_000_000))
          .accounts({
            bettor: seeder.publicKey,
            market: m.publicKey,
            bet: betPda,
            vault: m.account.vault,
            bettorToken: getAssociatedTokenAddressSync(DEVNET_USDC_MINT, seeder.publicKey),
            tokenProgram: TOKEN_PROGRAM,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        console.log(`  ${m.publicKey.toBase58().slice(0, 8)}… side ${side}: +$${shape[side]}`);
      } catch (e: any) {
        const msg = e.error?.errorMessage ?? e.message ?? String(e);
        console.log(`  ${m.publicKey.toBase58().slice(0, 8)}… side ${side}: skipped (${msg.slice(0, 40)})`);
      }
    }
  }
}

main().catch((e) => {
  console.error("FAILED:", e.error?.errorMessage ?? e.message ?? e);
  process.exit(1);
});
