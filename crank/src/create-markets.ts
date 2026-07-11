/**
 * Publish Onside markets for a fixture:
 *   - Match result (1X2)          — goals diff, keys 1/2
 *   - Home corners over N         — key 7, StatOver
 *   - Away corners over N         — key 8, StatOver
 * Usage: npx tsx crank/src/create-markets.ts <fixtureId> [cornersLine=4] [awayCornersLine=cornersLine]
 */
import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
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
} from "@onside/txline-client";

const BN = (anchor as any).BN ?? (anchor as any).default.BN;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const FIXTURE_ID = Number(process.argv[2]);
const CORNERS_LINE = Number(process.argv[3] ?? 4);
const AWAY_CORNERS_LINE = Number(process.argv[4] ?? CORNERS_LINE);
if (!FIXTURE_ID) {
  console.error("usage: create-markets.ts <fixtureId> [cornersLine]");
  process.exit(1);
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

  // fixture start time from TxLINE → min_settle_ts = start + 105 min
  const creds = credentialsFromEnv(process.env as never);
  if (!creds) throw new Error("TxLINE credentials missing");
  const txline = new TxlineDataClient(creds);
  const fixtures = (await txline.fixturesSnapshot()) as any[];
  const fx = fixtures.find((f) => f.FixtureId === FIXTURE_ID);
  if (!fx) throw new Error(`fixture ${FIXTURE_ID} not in snapshot`);
  const minSettleTs = fx.StartTime + 105 * 60_000;
  console.log(`${fx.Participant1} vs ${fx.Participant2} — kickoff ${new Date(fx.StartTime).toISOString()}`);

  const create = async (
    kind: object,
    kindByte: number,
    statKey: number,
    statKey2: number | null,
    threshold: number,
    label: string
  ) => {
    const statKeyBuf = Buffer.alloc(4);
    statKeyBuf.writeUInt32LE(statKey);
    const [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), new BN(FIXTURE_ID).toArrayLike(Buffer, "le", 8), Buffer.from([kindByte]), statKeyBuf],
      program.programId
    );
    if (await connection.getAccountInfo(marketPda)) {
      console.log(`${label}: already exists (${marketPda.toBase58()})`);
      return;
    }
    const vault = getAssociatedTokenAddressSync(DEVNET_USDC_MINT, marketPda, true);
    const createVaultIx = createAssociatedTokenAccountIdempotentInstruction(
      crank.publicKey, vault, marketPda, DEVNET_USDC_MINT
    );
    await program.methods
      .createMarket(new BN(FIXTURE_ID), kind as never, statKey, statKey2, threshold, new BN(minSettleTs), new BN(300))
      .accounts({
        creator: crank.publicKey, market: marketPda, vault,
        usdcMint: DEVNET_USDC_MINT, systemProgram: SystemProgram.programId,
      })
      .preInstructions([createVaultIx])
      .rpc();
    console.log(`${label}: created ${marketPda.toBase58()}`);
  };

  await create({ matchResult: {} }, 0, 1, 2, 0, "Match result (1X2)");
  await create({ statOver: {} }, 1, 7, null, CORNERS_LINE, `Home corners over ${CORNERS_LINE}.5`);
  await create({ statOver: {} }, 1, 8, null, AWAY_CORNERS_LINE, `Away corners over ${AWAY_CORNERS_LINE}.5`);
}

main().catch((e) => {
  console.error("FAILED:", e.error?.errorMessage ?? e.message ?? e);
  process.exit(1);
});
