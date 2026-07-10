// Diagnostic: reproduce the extension's faucet+bet path with a fresh wallet
// and print FULL simulation logs. Usage: npx tsx crank/src/dev-bet-test.ts
import dotenv from "dotenv";
import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectionFor } from "@onside/txline-client";

const BN = (anchor as any).BN ?? (anchor as any).default.BN;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: resolve(REPO_ROOT, ".env") });

const USDC_MINT = new PublicKey("33WQevmATbd5NPyWpQrWWXRBBYpYdT6F26ZG1wYnb9EX");
const FIXTURE = 18218149; // Spain vs Belgium

async function main() {
  const connection = connectionFor("devnet");
  const crank = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(resolve(REPO_ROOT, "wallets/crank.keypair.json"), "utf8")))
  );
  const bettor = Keypair.generate();
  console.log("throwaway bettor:", bettor.publicKey.toBase58());

  // fund from crank
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: crank.publicKey,
      toPubkey: bettor.publicKey,
      lamports: 50_000_000,
    })
  );
  await anchor.web3.sendAndConfirmTransaction(connection, fundTx, [crank]);
  console.log("funded 0.05 SOL");

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(bettor), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const idl = JSON.parse(readFileSync(resolve(REPO_ROOT, "target/idl/onside.json"), "utf8"));
  const program = new anchor.Program(idl, provider);

  const bettorToken = getAssociatedTokenAddressSync(USDC_MINT, bettor.publicKey);
  const [faucetAuth] = PublicKey.findProgramAddressSync(
    [Buffer.from("faucet_auth")],
    program.programId
  );

  try {
    await program.methods
      .faucet(new BN(5_000_000))
      .accounts({
        user: bettor.publicKey,
        usdcMint: USDC_MINT,
        userToken: bettorToken,
        faucetAuthority: faucetAuth,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("faucet 5 tUSDC ✅");
  } catch (e: any) {
    console.error("FAUCET FAILED:", e.message);
    console.error((e.logs ?? (await e.getLogs?.(connection)) ?? []).join("\n"));
    process.exit(1);
  }

  // derive market PDA: ["market", fixture le8, kind, statKey le4] — 1X2 = kind 0, statKey 1
  const skBuf = Buffer.alloc(4);
  skBuf.writeUInt32LE(1);
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), new BN(FIXTURE).toArrayLike(Buffer, "le", 8), Buffer.from([0]), skBuf],
    program.programId
  );
  const acc: any = await (program.account as any).market.fetch(market);
  console.log("market", market.toBase58(), "state:", JSON.stringify(acc.state), "vault:", acc.vault.toBase58());

  const [betPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bet"), market.toBuffer(), bettor.publicKey.toBuffer()],
    program.programId
  );

  try {
    const sig = await program.methods
      .placeBet(0, new BN(1_000_000))
      .accounts({
        bettor: bettor.publicKey,
        market,
        bet: betPda,
        vault: acc.vault,
        bettorToken,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("BET PLACED ✅", sig);
  } catch (e: any) {
    console.error("BET FAILED:", e.message);
    console.error((e.logs ?? (await e.getLogs?.(connection)) ?? []).join("\n"));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
