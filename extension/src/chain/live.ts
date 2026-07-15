/**
 * Client for the local Onside data proxy (crank/src/proxy.ts) — live scores,
 * StablePrice odds and lineups. The proxy holds the TxLINE credentials; the
 * extension only ever sees public match data. Everything here degrades to
 * null when the proxy is offline, and callers render nothing in that case.
 */

export interface LiveScore {
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

export interface OddsLine {
  type: string;
  line: number | null;
  period: string | null;
  names: string[];
  prices: number[]; // decimal odds
  ts: number;
}

export type LineupPair = {
  home: { n: string; name: string }[];
  away: { n: string; name: string }[];
};

export interface Goalscorer {
  name: string;
  odds: number;
  key: string;
}

const DEFAULT_PROXY = "http://127.0.0.1:8787";
let proxyUrl = DEFAULT_PROXY;
// allow pointing at a hosted proxy without a rebuild:
//   chrome.storage.local.set({ onside_proxy_url: "https://…" })
try {
  chrome.storage?.local?.get("onside_proxy_url", (r) => {
    if (typeof r?.onside_proxy_url === "string" && r.onside_proxy_url) {
      proxyUrl = r.onside_proxy_url.replace(/\/$/, "");
    }
  });
} catch {
  /* orphaned content script */
}

async function getJson<T>(path: string, timeoutMs = 3000): Promise<T | null> {
  // Prefer the background service worker (extension origin — not subject to the
  // stream page's CSP or Chrome Private Network Access). Fall back to a direct
  // fetch if the SW is unavailable (e.g. orphaned script after reload).
  try {
    if (chrome?.runtime?.sendMessage) {
      const reply = await chrome.runtime.sendMessage({ onsideProxy: path, base: proxyUrl });
      if (reply && reply.ok) return (reply.data as T) ?? null;
    }
  } catch {
    /* fall through to direct fetch */
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${proxyUrl}${path}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** All tracked fixtures' live state, or null when the proxy is offline. */
export function fetchLiveAll(): Promise<Record<string, LiveScore> | null> {
  return getJson<Record<string, LiveScore>>("/live");
}

export async function fetchSpOdds(fixtureId: number): Promise<OddsLine[] | null> {
  const o = await getJson<{ lines: OddsLine[] }>(`/odds/${fixtureId}`);
  return o?.lines ?? null;
}

export function fetchProxyLineups(fixtureId: number): Promise<LineupPair | null> {
  return getJson<LineupPair | null>(`/lineups/${fixtureId}`);
}

/** Anytime-goalscorer odds (the-odds-api) keyed by accent-free surname. */
export async function fetchGoalscorer(
  fixtureId: number
): Promise<Record<string, Goalscorer> | null> {
  const g = await getJson<{ players: Record<string, Goalscorer> }>(`/goalscorer/${fixtureId}`);
  return g?.players ?? null;
}

/**
 * Cross-source player key: first-initial + last surname token, accent-free.
 * Must match the proxy's surnameKey exactly. Handles "Surname, First" and
 * "First Surname", compound surnames, and same-surname disambiguation.
 */
export function surnameKey(name: string): string {
  const clean = name.normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  let first = "", surname = "";
  if (clean.includes(",")) {
    [surname, first] = clean.split(",").map((s) => s.trim());
  } else {
    const parts = clean.split(/\s+/);
    first = parts[0] ?? "";
    surname = parts.slice(1).join(" ") || parts[0] || "";
  }
  const lastTok = surname.split(/\s+/).slice(-1)[0] ?? "";
  return ((first[0] ?? "") + lastTok).toLowerCase();
}

/** Display minute for a live clock ("67′", "HT" handled by phaseLabel). */
export function clockMinute(l: LiveScore): string {
  if (!l.clock.seconds) return "";
  return `${Math.min(Math.floor(l.clock.seconds / 60) + 1, 120)}′`;
}

/** The pre-match 1X2 StablePrice line → [home, draw, away] decimal odds. */
export function sp1x2(lines: OddsLine[] | null): number[] | null {
  const l = lines?.find((x) => x.type === "1X2_PARTICIPANT_RESULT" && !x.period);
  return l && l.prices.length === 3 ? l.prices : null;
}

/** Full-match total-goals over/under line closest to `target` (2.5 default). */
export function spTotalGoals(
  lines: OddsLine[] | null,
  target = 2.5
): { line: number; over: number; under: number } | null {
  const cands = (lines ?? []).filter(
    (l) => l.type === "OVERUNDER_PARTICIPANT_GOALS" && !l.period && l.line != null
  );
  if (!cands.length) return null;
  cands.sort((a, b) => Math.abs((a.line ?? 99) - target) - Math.abs((b.line ?? 99) - target));
  const l = cands[0];
  const oi = l.names.indexOf("over");
  const ui = l.names.indexOf("under");
  if (oi < 0 || ui < 0) return null;
  return { line: l.line ?? target, over: l.prices[oi], under: l.prices[ui] };
}
