/**
 * One-time TxLINE onboarding (devnet):
 * subscribe on-chain (free World Cup tier) → activate API token.
 * Prints TXLINE_JWT / TXLINE_API_TOKEN values to paste into .env.
 *
 * Requires: wallets/crank.keypair.json funded with devnet SOL, and the
 * txoracle devnet IDL downloaded to crank/idl/txoracle.json (from the
 * TxLINE docs "IDL & Types (Devnet)" page — login required).
 */
import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
import {
  connectionFor,
  subscribeAndActivate,
  SERVICE_LEVEL_WORLD_CUP_DELAYED,
  TXLINE_CONFIG,
} from "@onside/txline-client";

async function main() {
  const keypairPath = resolve(
    REPO_ROOT,
    process.env.WALLET_KEYPAIR_PATH ?? "wallets/crank.keypair.json"
  );
  const secret = JSON.parse(readFileSync(keypairPath, "utf8")) as number[];
  const keypair = Keypair.fromSecretKey(Uint8Array.from(secret));
  const wallet = new anchor.Wallet(keypair);

  const connection = connectionFor("devnet");
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const idl = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "crank/idl/txoracle.json"), "utf8")
  );
  const program = new anchor.Program(idl, provider);
  if (!program.programId.equals(TXLINE_CONFIG.devnet.programId)) {
    throw new Error("IDL program id does not match TxLINE devnet program");
  }

  const creds = await subscribeAndActivate({
    network: "devnet",
    wallet,
    program,
    serviceLevelId: SERVICE_LEVEL_WORLD_CUP_DELAYED,
  });

  console.log("Add these to your .env:");
  console.log(`TXLINE_JWT=${creds.jwt}`);
  console.log(`TXLINE_API_TOKEN=${creds.apiToken}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
