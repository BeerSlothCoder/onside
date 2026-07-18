/**
 * Read-only chain access for the viewer — decodes Onside markets straight
 * from devnet RPC (no server, no wallet) and digs out the settlement
 * transaction whose logs carry the TxLINE Merkle-proof verification.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "../../extension/src/chain/idl.json";
import fixturesRaw from "../../extension/src/chain/fixtures.json";
import settlementsRaw from "../../crank/fixtures/settlements.json";

/** market address → recorded settle tx (persisted by the crank at settle time). */
export const KNOWN_SETTLEMENTS = settlementsRaw as Record<
  string,
  { sig: string; blockTime: number | null; outcome: number | null }
>;

export const RPC_URL = "https://api.devnet.solana.com";
export const ONSIDE_PROGRAM_ID = new PublicKey("DhFnzPPgyg77EczxLpmfuT2msD1yHzBLjWfz32q9A4B8");
export const TXORACLE_PROGRAM_ID = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");

export const connection = new Connection(RPC_URL, "confirmed");

export interface FixtureInfo {
  id: number;
  home: string;
  away: string;
  start: number;
  comp: string;
}
export const FIXTURES = new Map<number, FixtureInfo>(
  (fixturesRaw as FixtureInfo[]).map((f) => [f.id, f])
);

export interface MarketRow {
  address: PublicKey;
  fixtureId: number;
  fixture?: FixtureInfo;
  kind: "matchResult" | "statOver";
  statKey: number;
  threshold: number;
  state: "open" | "locked" | "settled";
  pools: number[];
  totalPool: number;
  outcome: number | null;
  vault: PublicKey;
}

const MARKET_DISC: number[] = (idl as any).accounts.find(
  (a: any) => a.name === "Market"
).discriminator;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58encode(bytes: number[] | Uint8Array): string {
  let x = 0n;
  for (const b of bytes) x = (x << 8n) | BigInt(b);
  let out = "";
  while (x > 0n) {
    out = B58[Number(x % 58n)] + out;
    x /= 58n;
  }
  for (const b of bytes) {
    if (b === 0) out = "1" + out;
    else break;
  }
  return out;
}

function decodeMarket(address: PublicKey, raw: Uint8Array): MarketRow {
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let o = 8; // discriminator
  o += 32; // authority
  const fixtureId = Number(dv.getBigUint64(o, true)); o += 8;
  const kindIdx = dv.getUint8(o); o += 1;
  const statKey = dv.getUint32(o, true); o += 4;
  const hasKey2 = dv.getUint8(o); o += 1;
  o += hasKey2 ? 4 : 0;
  const threshold = dv.getInt32(o, true); o += 4;
  o += 8; // min_settle_ts
  o += 8; // finality_window_secs
  const stateIdx = dv.getUint8(o); o += 1;
  const pools: number[] = [];
  for (let i = 0; i < 3; i++) { pools.push(Number(dv.getBigUint64(o, true)) / 1e6); o += 8; }
  // borsh Option<u8>: value byte present only when the tag is 1
  const hasOutcome = dv.getUint8(o); o += 1;
  const outcome = hasOutcome ? dv.getUint8(o) : null;
  o += hasOutcome ? 1 : 0;
  o += 8; // settled_data_ts
  o += 8; // claim_after
  const vault = new PublicKey(raw.slice(o, o + 32));

  const kind = kindIdx === 0 ? "matchResult" : "statOver";
  const sideCount = kind === "matchResult" ? 3 : 2;
  const sidePools = pools.slice(0, sideCount);
  return {
    address,
    fixtureId,
    fixture: FIXTURES.get(fixtureId),
    kind,
    statKey,
    threshold,
    state: (["open", "locked", "settled"] as const)[stateIdx],
    pools: sidePools,
    totalPool: sidePools.reduce((a, b) => a + b, 0),
    outcome,
    vault,
  };
}

/** Stale accounts from pre-release program layouts decode to garbage pools. */
const SANE_POOL_LIMIT = 100_000;

export async function fetchMarkets(): Promise<MarketRow[]> {
  const accounts = await connection.getProgramAccounts(ONSIDE_PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: bs58encode(MARKET_DISC) } }],
  });
  return accounts
    .map((a) => decodeMarket(a.pubkey, new Uint8Array(a.account.data)))
    .filter((m) => m.totalPool < SANE_POOL_LIMIT)
    .sort((a, b) => (a.fixture?.start ?? 0) - (b.fixture?.start ?? 0));
}

export interface Settlement {
  signature: string;
  blockTime: number | null;
  logs: string[];
}

/**
 * Find the settle transaction for a market: walk recent signatures on the
 * market PDA (newest first — claims sit above it) until the logs say
 * "Instruction: Settle".
 */
export async function findSettlement(market: PublicKey): Promise<Settlement | null> {
  // 1) Prefer the crank-recorded signature — link straight to the explorer,
  //    which keeps a full archive even after the public RPC prunes history.
  const known = KNOWN_SETTLEMENTS[market.toBase58()];
  if (known) {
    let logs: string[] = [];
    try {
      const tx = await connection.getTransaction(known.sig, { maxSupportedTransactionVersion: 0 });
      logs = tx?.meta?.logMessages ?? [];
    } catch {
      /* pruned from RPC — the explorer link still works */
    }
    return { signature: known.sig, blockTime: known.blockTime, logs };
  }
  // 2) Otherwise scan the market's signatures oldest-first (settle sits early).
  //    Works for recently-settled markets; old ones may be pruned → null.
  try {
    const sigs = await connection.getSignaturesForAddress(market, { limit: 1000 });
    let fetched = 0;
    for (const s of [...sigs].reverse()) {
      if (s.err) continue;
      if (fetched++ > 40) break;
      const tx = await connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
      const logs = tx?.meta?.logMessages ?? [];
      if (logs.some((l) => l.includes("Instruction: Settle"))) {
        return { signature: s.signature, blockTime: tx?.blockTime ?? null, logs };
      }
    }
  } catch {
    /* RPC rate-limit / pruned */
  }
  return null;
}

export function impliedOdds(m: MarketRow, side: number): number | null {
  const sidePool = m.pools[side];
  if (!sidePool || m.totalPool === 0) return null;
  return m.totalPool / sidePool;
}

export const explorerAddr = (a: string) =>
  `https://explorer.solana.com/address/${a}?cluster=devnet`;
export const explorerTx = (s: string) =>
  `https://explorer.solana.com/tx/${s}?cluster=devnet`;
