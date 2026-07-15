/**
 * Onside crank daemon — permissionless market lifecycle driver.
 *
 *   watch fixtures → lock_market at kickoff → at full time fetch the
 *   TxLINE Merkle proof and settle() each market → done.
 *
 * Anyone can run this; settlement correctness is enforced on-chain by the
 * proof verification, not by whoever operates the crank.
 *
 * Usage: npm run crank -- [fixtureId ...]   (defaults to the QF slate)
 */
import dotenv from "dotenv";
import * as anchor from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  connectionFor,
  credentialsFromEnv,
  GamePhase,
  TxlineDataClient,
  TXLINE_CONFIG,
} from "@onside/txline-client";

const BN = (anchor as any).BN ?? (anchor as any).default.BN;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: resolve(REPO_ROOT, ".env") });
const POLL_MS = 30_000;
const DEFAULT_FIXTURES = [18209181, 18218149, 18213979, 18222446, 18241006];

const GAME_FINALISED = 100; // TxODDS post-match data confirmation
const FINAL_PHASES = new Set<number>([
  GamePhase.Finished,
  GamePhase.FinishedAfterExtraTime,
  GamePhase.FinishedAfterPenalties,
  GAME_FINALISED,
]);
const LIVE_PHASES = new Set<number>([
  GamePhase.FirstHalf,
  GamePhase.Halftime,
  GamePhase.SecondHalf,
  GamePhase.WaitingExtraTime,
  GamePhase.ExtraTime1,
  GamePhase.ExtraTimeHalftime,
  GamePhase.ExtraTime2,
  GamePhase.WaitingPenalties,
  GamePhase.Penalties,
]);

interface TrackedMarket {
  pda: PublicKey;
  kind: "matchResult" | "statOver";
  statKey: number;
  statKey2: number | null; // set → prove the SUM of two stats (e.g. total goals)
  threshold: number;
}

function toBytes32(value: string | number[]): number[] {
  const bytes = Array.isArray(value) ? Uint8Array.from(value) : Buffer.from(value, "base64");
  return Array.from(bytes);
}
const toProofNodes = (ns: Array<{ hash: string | number[]; isRightSibling: boolean }>) =>
  ns.map((n) => ({ hash: toBytes32(n.hash), isRightSibling: n.isRightSibling }));

async function main() {
  const fixtures = process.argv.slice(2).map(Number).filter(Boolean);
  const fixtureIds = fixtures.length ? fixtures : DEFAULT_FIXTURES;

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

  const creds = credentialsFromEnv(process.env as never);
  if (!creds) throw new Error("TxLINE credentials missing — run activate first");
  const txline = new TxlineDataClient(creds);

  // derive tracked markets per fixture (both kinds)
  const tracked = new Map<number, TrackedMarket[]>();
  for (const fx of fixtureIds) {
    const list: TrackedMarket[] = [];
    // kinds: matchResult (stat 1 vs 2), corners over (7/8), total goals (1 → sum 1+2)
    for (const [kindByte, statKey] of [[0, 1], [1, 7], [1, 8], [1, 1]] as const) {
      const skBuf = Buffer.alloc(4);
      skBuf.writeUInt32LE(statKey);
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), new BN(fx).toArrayLike(Buffer, "le", 8), Buffer.from([kindByte]), skBuf],
        program.programId
      );
      try {
        const acc: any = await (program.account as any).market.fetch(pda);
        list.push({
          pda,
          kind: kindByte === 0 ? "matchResult" : "statOver",
          statKey,
          statKey2: acc.statKey2 ?? null,
          threshold: acc.threshold,
        });
      } catch {
        /* market not created for this fixture/kind */
      }
    }
    if (list.length) tracked.set(fx, list);
    console.log(`fixture ${fx}: tracking ${list.length} markets`);
  }

  const done = new Set<string>();

  const tick = async () => {
    for (const [fx, markets] of tracked) {
      if (markets.every((m) => done.has(m.pda.toBase58()))) continue;
      try {
        // snapshot = array of the latest message per action type
        const snap = (await txline.scoresSnapshot(fx)) as any;
        const arr: any[] = Array.isArray(snap) ? snap : [];
        if (!arr.length) continue;
        const bySeq = (els: any[]) => els.sort((a, b) => (a.Seq ?? 0) - (b.Seq ?? 0));
        // StatusId 100 = game_finalised (TxODDS post-match confirmation)
        const phase: number | undefined = bySeq(
          arr.filter((u) => u.StatusId !== undefined)
        ).at(-1)?.StatusId;
        const statsEl = bySeq(arr.filter((u) => u.Stats)).at(-1);
        const seq: number | undefined = statsEl?.Seq;
        const stats: Record<string, number> = statsEl?.Stats ?? {};
        console.log(
          `[${new Date().toISOString().slice(11, 19)}] fx ${fx}: phase=${phase} seq=${seq} score=${stats["1"] ?? "?"}–${stats["2"] ?? "?"}`
        );
        if (phase === undefined) continue;

        for (const m of markets) {
          const key = m.pda.toBase58();
          if (done.has(key)) continue;
          const acc: any = await (program.account as any).market.fetch(m.pda);
          const state = JSON.stringify(acc.state);

          // lock at kickoff
          if (state === '{"open":{}}' && (LIVE_PHASES.has(phase) || FINAL_PHASES.has(phase))) {
            await program.methods
              .lockMarket()
              .accounts({ cranker: crank.publicKey, market: m.pda })
              .rpc();
            console.log(`  locked ${m.kind} market ${key.slice(0, 8)}…`);
          }

          // settle at full time
          if (FINAL_PHASES.has(phase) && state !== '{"settled":{}}' && seq !== undefined) {
            // total-goals (statOver carrying stat_key2) proves the SUM of two
            // stats; corners prove a single stat; matchResult the goal diff.
            const twoStat = m.kind === "matchResult" || m.statKey2 != null;
            const outcome =
              m.kind === "matchResult"
                ? (stats["1"] ?? 0) > (stats["2"] ?? 0)
                  ? 0
                  : (stats["1"] ?? 0) < (stats["2"] ?? 0)
                    ? 2
                    : 1
                : m.statKey2 != null
                  ? (stats[String(m.statKey)] ?? 0) + (stats[String(m.statKey2)] ?? 0) > m.threshold
                    ? 0
                    : 1
                  : (stats[String(m.statKey)] ?? 0) > m.threshold
                    ? 0
                    : 1;

            const v = await txline.statValidation(
              twoStat
                ? { fixtureId: fx, seq, statKey: m.statKey, statKey2: m.statKey2 ?? 2 }
                : { fixtureId: fx, seq, statKey: m.statKey }
            );
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
              statB: v.statToProve2
                ? {
                    statToProve: v.statToProve2,
                    eventStatRoot: toBytes32(v.eventStatRoot as never),
                    statProof: toProofNodes(v.statProof2 as never),
                  }
                : null,
              op: v.statToProve2 ? { subtract: {} } : null,
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
                market: m.pda,
                txlineRoots: rootsPda,
                txoracleProgram: TXLINE_CONFIG.devnet.programId,
              })
              .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
              .rpc();
            console.log(`  ✅ settled ${m.kind} → outcome ${outcome} (${sig.slice(0, 16)}…)`);
            done.add(key);
          }
          if (state === '{"settled":{}}') done.add(key);
        }
      } catch (e: any) {
        console.warn(`  fx ${fx} tick failed: ${(e.error?.errorMessage ?? e.message ?? e).slice(0, 90)}`);
      }
    }
    const remaining = [...tracked.values()].flat().filter((m) => !done.has(m.pda.toBase58()));
    if (remaining.length === 0) {
      console.log("all tracked markets settled — crank exiting ✅");
      process.exit(0);
    }
  };

  console.log(`Onside crank running — ${tracked.size} fixtures, poll ${POLL_MS / 1000}s`);
  await tick();
  setInterval(tick, POLL_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
