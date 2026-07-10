/**
 * Browser client for the Onside program — reads markets/bets straight from
 * the chain (no server), builds and sends bet/claim/faucet transactions
 * signed by the burner wallet.
 */
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import idl from "./idl.json";
import fixturesRaw from "./fixtures.json";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MARKET_KIND_LABELS,
  ONSIDE_PROGRAM_ID,
  RPC_URL,
  TOKEN_PROGRAM_ID,
  USDC_MINT,
} from "./constants";

export interface FixtureInfo {
  id: number;
  home: string;
  away: string;
  start: number;
  comp: string;
}
const FIXTURES = new Map<number, FixtureInfo>(
  (fixturesRaw as FixtureInfo[]).map((f) => [f.id, f])
);

export interface MarketView {
  address: PublicKey;
  fixtureId: number;
  fixture?: FixtureInfo;
  kind: "matchResult" | "statOver";
  kindLabel: string;
  sideLabels: string[];
  statKey: number;
  threshold: number;
  state: "open" | "locked" | "settled";
  pools: number[]; // UI units
  totalPool: number;
  outcome: number | null;
  claimAfter: number; // unix secs
  vault: PublicKey;
}

export interface BetView {
  address: PublicKey;
  market: PublicKey;
  side: number;
  amount: number; // UI units
  claimed: boolean;
}

export const connection = new Connection(RPC_URL, "confirmed");

// ── instruction discriminators from the IDL ─────────────────────
const disc: Record<string, Buffer> = {};
for (const ix of (idl as any).instructions) {
  disc[ix.name] = Buffer.from(ix.discriminator);
}
const ACCOUNT_DISC: Record<string, Buffer> = {};
for (const acc of (idl as any).accounts) {
  ACCOUNT_DISC[acc.name] = Buffer.from(acc.discriminator);
}

// ── account decoding (fixed layouts, avoids bundling anchor) ────
function decodeMarket(address: PublicKey, data: Buffer): MarketView {
  let o = 8; // discriminator
  o += 32; // authority
  const fixtureId = Number(data.readBigUInt64LE(o)); o += 8;
  const kindIdx = data.readUInt8(o); o += 1;
  const statKey = data.readUInt32LE(o); o += 4;
  const hasKey2 = data.readUInt8(o); o += 1;
  o += hasKey2 ? 4 : 0;
  const threshold = data.readInt32LE(o); o += 4;
  o += 8; // min_settle_ts
  o += 8; // finality_window_secs
  const stateIdx = data.readUInt8(o); o += 1;
  const pools: number[] = [];
  for (let i = 0; i < 3; i++) { pools.push(Number(data.readBigUInt64LE(o)) / 1e6); o += 8; }
  // borsh Option<u8>: 1-byte tag, value byte present ONLY when Some —
  // skipping it unconditionally shifted every later field (incl. vault)
  // by one byte on open/locked markets and broke place_bet.
  const hasOutcome = data.readUInt8(o); o += 1;
  const outcome = hasOutcome ? data.readUInt8(o) : null;
  o += hasOutcome ? 1 : 0;
  o += 8; // settled_data_ts
  const claimAfter = Number(data.readBigInt64LE(o)); o += 8;
  const vault = new PublicKey(data.slice(o, o + 32)); o += 32;

  const kind = kindIdx === 0 ? "matchResult" : "statOver";
  const labels = MARKET_KIND_LABELS[kind];
  const sideCount = kind === "matchResult" ? 3 : 2;
  return {
    address,
    fixtureId,
    fixture: FIXTURES.get(fixtureId),
    kind,
    kindLabel: labels.name,
    sideLabels: labels.sides,
    statKey,
    threshold,
    state: (["open", "locked", "settled"] as const)[stateIdx],
    pools: pools.slice(0, sideCount),
    totalPool: pools.slice(0, sideCount).reduce((a, b) => a + b, 0),
    outcome,
    claimAfter,
    vault,
  };
}

function decodeBet(address: PublicKey, data: Buffer): BetView {
  let o = 8;
  const market = new PublicKey(data.slice(o, o + 32)); o += 32;
  o += 32; // bettor
  const side = data.readUInt8(o); o += 1;
  const amount = Number(data.readBigUInt64LE(o)) / 1e6; o += 8;
  const claimed = data.readUInt8(o) === 1;
  return { address, market, side, amount, claimed };
}

export async function fetchMarkets(): Promise<MarketView[]> {
  const accounts = await connection.getProgramAccounts(ONSIDE_PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: bs58encode(ACCOUNT_DISC["Market"]) } }],
  });
  return accounts
    .map((a) => decodeMarket(a.pubkey, Buffer.from(a.account.data)))
    .sort((a, b) => (a.fixture?.start ?? 0) - (b.fixture?.start ?? 0));
}

export async function fetchMyBets(owner: PublicKey): Promise<BetView[]> {
  const accounts = await connection.getProgramAccounts(ONSIDE_PROGRAM_ID, {
    filters: [
      { memcmp: { offset: 0, bytes: bs58encode(ACCOUNT_DISC["Bet"]) } },
      { memcmp: { offset: 40, bytes: owner.toBase58() } },
    ],
  });
  return accounts.map((a) => decodeBet(a.pubkey, Buffer.from(a.account.data)));
}

// ── transactions ────────────────────────────────────────────────
function ata(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), USDC_MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

function betPda(market: PublicKey, bettor: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bet"), market.toBuffer(), bettor.toBuffer()],
    ONSIDE_PROGRAM_ID
  )[0];
}

async function send(tx: Transaction, signer: Keypair): Promise<string> {
  tx.feePayer = signer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(signer);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

/** Mint `uiAmount` (≤100) test USDC to the wallet via the on-chain faucet. */
export async function faucet(signer: Keypair, uiAmount: number): Promise<string> {
  const data = Buffer.concat([
    disc["faucet"],
    u64le(BigInt(Math.round(uiAmount * 1e6))),
  ]);
  const [faucetAuth] = PublicKey.findProgramAddressSync(
    [Buffer.from("faucet_auth")],
    ONSIDE_PROGRAM_ID
  );
  const keys = [
    { pubkey: signer.publicKey, isSigner: true, isWritable: true },
    { pubkey: USDC_MINT, isSigner: false, isWritable: true },
    { pubkey: ata(signer.publicKey), isSigner: false, isWritable: true },
    { pubkey: faucetAuth, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  return send(
    new Transaction().add(
      new TransactionInstruction({ programId: ONSIDE_PROGRAM_ID, keys, data })
    ),
    signer
  );
}

export async function placeBet(
  signer: Keypair,
  market: MarketView,
  side: number,
  uiAmount: number
): Promise<string> {
  const data = Buffer.concat([
    disc["place_bet"],
    Buffer.from([side]),
    u64le(BigInt(Math.round(uiAmount * 1e6))),
  ]);
  const keys = [
    { pubkey: signer.publicKey, isSigner: true, isWritable: true },
    { pubkey: market.address, isSigner: false, isWritable: true },
    { pubkey: betPda(market.address, signer.publicKey), isSigner: false, isWritable: true },
    { pubkey: market.vault, isSigner: false, isWritable: true },
    { pubkey: ata(signer.publicKey), isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  return send(
    new Transaction().add(
      new TransactionInstruction({ programId: ONSIDE_PROGRAM_ID, keys, data })
    ),
    signer
  );
}

export async function claim(signer: Keypair, market: MarketView): Promise<string> {
  const keys = [
    { pubkey: signer.publicKey, isSigner: true, isWritable: true },
    { pubkey: market.address, isSigner: false, isWritable: true },
    { pubkey: betPda(market.address, signer.publicKey), isSigner: false, isWritable: true },
    { pubkey: market.vault, isSigner: false, isWritable: true },
    { pubkey: ata(signer.publicKey), isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  return send(
    new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
      .add(new TransactionInstruction({ programId: ONSIDE_PROGRAM_ID, keys, data: disc["claim"] })),
    signer
  );
}

export async function balances(owner: PublicKey): Promise<{ sol: number; usdc: number }> {
  const sol = (await connection.getBalance(owner)) / 1e9;
  let usdc = 0;
  try {
    const bal = await connection.getTokenAccountBalance(ata(owner));
    usdc = bal.value.uiAmount ?? 0;
  } catch {
    /* no ATA yet */
  }
  return { sol, usdc };
}

export async function airdropSol(owner: PublicKey): Promise<string> {
  const sig = await connection.requestAirdrop(owner, 1_000_000_000);
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

// ── small utils ─────────────────────────────────────────────────
function u64le(n: bigint): Buffer {
  // manual LE write — the browser Buffer polyfill's BigInt method has broken typings
  const b = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) b[i] = Number((n >> BigInt(8 * i)) & 0xffn);
  return b;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58encode(buf: Buffer): string {
  let x = BigInt("0x" + buf.toString("hex"));
  let out = "";
  while (x > 0n) { out = B58[Number(x % 58n)] + out; x /= 58n; }
  for (const byte of buf) { if (byte === 0) out = "1" + out; else break; }
  return out;
}

export function impliedOdds(m: MarketView, side: number): number | null {
  const sidePool = m.pools[side];
  if (!sidePool || m.totalPool === 0) return null;
  return m.totalPool / sidePool;
}
