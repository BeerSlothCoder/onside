/**
 * Onside data proxy — read-only HTTP bridge between TxLINE and the browser.
 *
 * The TxLINE api token must never ship client-side, so this tiny server
 * holds the credentials and re-serves only public match data:
 *
 *   GET /live               → { [fixtureId]: LiveInfo }   (scores, phase, clock)
 *   GET /odds/:fixtureId    → StablePrice lines (prices ÷1000 → decimal odds)
 *   GET /lineups/:fixtureId → starting XI from crank/fixtures/lineups.json
 *                             (re-read per request — edit the file, no restart)
 *   GET /health             → { ok, fixtures, updatedAt }
 *
 * Usage: npm run proxy -w crank -- [fixtureId ...]   (defaults to the slate)
 */
import dotenv from "dotenv";
import { createServer, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { credentialsFromEnv, GamePhase, TxlineDataClient } from "@onside/txline-client";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: resolve(REPO_ROOT, ".env") });

const PORT = Number(process.env.PROXY_PORT ?? 8787);
const DEFAULT_FIXTURES = [18209181, 18218149, 18213979, 18222446, 18241006];
const SCORES_POLL_MS = 15_000;
const ODDS_POLL_MS = 60_000;
const LINEUPS_PATH = resolve(REPO_ROOT, "crank/fixtures/lineups.json");

const PHASE_LABELS: Record<number, string> = {
  [GamePhase.NotStarted]: "upcoming",
  [GamePhase.FirstHalf]: "1H",
  [GamePhase.Halftime]: "HT",
  [GamePhase.SecondHalf]: "2H",
  [GamePhase.Finished]: "FT",
  [GamePhase.WaitingExtraTime]: "ET soon",
  [GamePhase.ExtraTime1]: "ET1",
  [GamePhase.ExtraTimeHalftime]: "ET HT",
  [GamePhase.ExtraTime2]: "ET2",
  [GamePhase.FinishedAfterExtraTime]: "AET",
  [GamePhase.WaitingPenalties]: "pens soon",
  [GamePhase.Penalties]: "pens",
  [GamePhase.FinishedAfterPenalties]: "FT (pens)",
  100: "FT ✓", // game_finalised — TxODDS post-match confirmation
};
const FINAL_PHASES = new Set([5, 10, 13, 100]);

interface LiveInfo {
  fixtureId: number;
  phase: number;
  phaseLabel: string;
  final: boolean;
  clock: { running: boolean; seconds: number };
  score: { home: number; away: number };
  corners: { home: number; away: number };
  seq: number | null;
  ts: number | null;
  updatedAt: number;
}

interface OddsLine {
  type: string;
  line: number | null;
  period: string | null;
  names: string[];
  prices: number[]; // decimal odds
  ts: number;
}

const live = new Map<number, LiveInfo>();
// snapshot only returns recently-updated lines, so accumulate per market
// line (type+line+period) and keep the freshest price for each
const odds = new Map<number, { byKey: Map<string, OddsLine>; updatedAt: number }>();
const startTimes = new Map<number, number>();

/** Reduce a scores snapshot (latest message per action type) to one LiveInfo. */
function mergeSnapshot(fixtureId: number, arr: any[]): LiveInfo | null {
  if (!arr.length) return null;
  const bySeq = [...arr].sort((a, b) => (a.Seq ?? 0) - (b.Seq ?? 0));
  const last = <T>(pick: (el: any) => T | undefined): T | undefined => {
    for (let i = bySeq.length - 1; i >= 0; i--) {
      const v = pick(bySeq[i]);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const phase = last((el) => el.StatusId) ?? GamePhase.NotStarted;
  const score = last((el) => el.Score);
  const clock = last((el) => el.Clock);
  const total = (p: any) => p?.Total ?? {};
  return {
    fixtureId,
    phase,
    phaseLabel: PHASE_LABELS[phase] ?? `phase ${phase}`,
    final: FINAL_PHASES.has(phase),
    clock: { running: !!clock?.Running, seconds: clock?.Seconds ?? 0 },
    score: {
      home: total(score?.Participant1).Goals ?? 0,
      away: total(score?.Participant2).Goals ?? 0,
    },
    corners: {
      home: total(score?.Participant1).Corners ?? 0,
      away: total(score?.Participant2).Corners ?? 0,
    },
    seq: last((el) => el.Seq) ?? null,
    ts: last((el) => el.Ts) ?? null,
    updatedAt: Date.now(),
  };
}

function trimOdds(arr: any[]): OddsLine[] {
  return arr
    .filter((e) => typeof e.Bookmaker === "string" && e.Bookmaker.includes("StablePrice"))
    .map((e) => ({
      type: e.SuperOddsType,
      line: e.MarketParameters ? Number(/line=(-?[\d.]+)/.exec(e.MarketParameters)?.[1]) : null,
      period: e.MarketPeriod ?? null,
      names: e.PriceNames ?? [],
      prices: (e.Prices ?? []).map((p: number) => p / 1000),
      ts: e.Ts,
    }));
}

function readLineups(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(LINEUPS_PATH, "utf8"));
  } catch {
    return {};
  }
}

/** Poll a fixture only around its live window (or until first data arrives). */
function inWindow(fx: number, beforeMs: number, afterMs: number): boolean {
  const start = startTimes.get(fx);
  if (start === undefined) return true;
  const now = Date.now();
  return now >= start - beforeMs && now <= start + afterMs;
}

async function main() {
  const argFixtures = process.argv.slice(2).map(Number).filter(Boolean);
  const fixtures = argFixtures.length ? argFixtures : DEFAULT_FIXTURES;
  const creds = credentialsFromEnv(process.env as never);
  if (!creds) throw new Error("TxLINE credentials missing in .env");
  const txline = new TxlineDataClient(creds);

  try {
    const snap = (await txline.fixturesSnapshot()) as any[];
    for (const f of snap) if (fixtures.includes(f.FixtureId)) startTimes.set(f.FixtureId, f.StartTime);
  } catch (e: any) {
    console.warn("fixtures snapshot failed (will poll everything):", e.message);
  }

  const pollScores = async (all = false) => {
    for (const fx of fixtures) {
      const info = live.get(fx);
      if (!all && info?.final) continue; // result is in, stop polling
      if (!all && !inWindow(fx, 60 * 60_000, 4 * 3_600_000)) continue;
      try {
        const snap = (await txline.scoresSnapshot(fx)) as any[];
        const merged = mergeSnapshot(fx, Array.isArray(snap) ? snap : []);
        if (merged) live.set(fx, merged);
      } catch (e: any) {
        console.warn(`scores ${fx}: ${e.message}`);
      }
    }
  };

  const pollOdds = async (all = false) => {
    for (const fx of fixtures) {
      if (!all && live.get(fx)?.final) continue;
      if (!all && !inWindow(fx, 24 * 3_600_000, 4 * 3_600_000)) continue;
      try {
        const snap = (await txline.oddsSnapshot(fx)) as any[];
        const entry = odds.get(fx) ?? { byKey: new Map<string, OddsLine>(), updatedAt: 0 };
        for (const line of trimOdds(Array.isArray(snap) ? snap : [])) {
          const key = `${line.type}|${line.line}|${line.period}`;
          const prev = entry.byKey.get(key);
          if (!prev || line.ts >= prev.ts) entry.byKey.set(key, line);
        }
        entry.updatedAt = Date.now();
        odds.set(fx, entry);
      } catch (e: any) {
        console.warn(`odds ${fx}: ${e.message}`);
      }
    }
  };

  await Promise.all([pollScores(true), pollOdds(true)]);
  setInterval(pollScores, SCORES_POLL_MS);
  setInterval(pollOdds, ODDS_POLL_MS);

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  };

  createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    const [, route, arg] = url.pathname.split("/");
    if (req.method === "OPTIONS") return json(res, 204, {});
    if (route === "health")
      return json(res, 200, { ok: true, fixtures, updatedAt: Date.now() });
    if (route === "live" && !arg)
      return json(res, 200, Object.fromEntries([...live.entries()]));
    if (route === "live") {
      const info = live.get(Number(arg));
      return info ? json(res, 200, info) : json(res, 404, { error: "unknown fixture" });
    }
    if (route === "odds") {
      const o = odds.get(Number(arg));
      return o
        ? json(res, 200, { lines: [...o.byKey.values()], updatedAt: o.updatedAt })
        : json(res, 404, { error: "no odds" });
    }
    if (route === "lineups") {
      const all = readLineups();
      return arg
        ? json(res, 200, (all as any)[arg] ?? null)
        : json(res, 200, all);
    }
    return json(res, 404, { error: "not found" });
  }).listen(PORT, "127.0.0.1", () => {
    console.log(`Onside proxy on http://127.0.0.1:${PORT} — fixtures: ${fixtures.join(", ")}`);
    console.log(`lineups hot-file: ${LINEUPS_PATH}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
