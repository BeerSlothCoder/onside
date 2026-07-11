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
