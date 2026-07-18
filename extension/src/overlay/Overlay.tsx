import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { Keypair } from "@solana/web3.js";
import {
  balances,
  BetView,
  claim,
  fetchMarkets,
  fetchMyBets,
  MarketView,
  placeBet,
} from "../chain/onside";
import { loadWallet, onWalletChange } from "../chain/wallet";
import {
  fetchGoalscorer,
  fetchLiveAll,
  fetchProxyLineups,
  fetchSpOdds,
  Goalscorer,
  LineupPair,
  LiveScore,
  OddsLine,
  surnameKey,
} from "../chain/live";
import { MatchView } from "./MatchView";
import { StreamBoard } from "./StreamBoard";
import { VideoOverlay } from "../tracking/ui/VideoOverlay";
import { findAnchor } from "../tracking/videoFinder";
import { anchorRect, rectsDiffer, type Rect } from "../tracking/geometry";
import { teamColors } from "./teamColors";
import { OnsideLogo } from "./OnsideLogo";
import { BRAND, UI_FONT, monoData, monoLabel } from "./brand";
import lineupsRaw from "../chain/lineups.json";

type Lineup = { n: string; name: string }[];
const LINEUPS = lineupsRaw as Record<string, { home: Lineup; away: Lineup }>;

function shortName(full: string): string {
  return full.includes(",") ? full.split(",")[0].trim() : full.split(" ").at(-1) ?? full;
}

const C = {
  bg: BRAND.panel,
  stroke: BRAND.border,
  cyan: BRAND.cyan,
  green: BRAND.lime,
  dim: BRAND.textMuted,
  ink: BRAND.text,
};

/** Stale dev accounts from pre-release program layouts decode to garbage. */
const SANE_POOL_LIMIT = 100_000;

interface MatchGroup {
  fixtureId: number;
  home: string;
  away: string;
  start: number;
  markets: MarketView[];
  state: string;
}

export function Overlay() {
  const [open, setOpen] = useState(false);
  const [wallet, setWallet] = useState<Keypair | null>(null);
  const [bal, setBal] = useState<{ sol: number; usdc: number } | null>(null);
  const [markets, setMarkets] = useState<MarketView[]>([]);
  const [bets, setBets] = useState<BetView[]>([]);
  const [activeFixture, setActiveFixture] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);
  const [hideRails, setHideRails] = useState(false);
  const [live, setLive] = useState<Record<string, LiveScore>>({});
  const [spOdds, setSpOdds] = useState<OddsLine[] | null>(null);
  const [goalscorers, setGoalscorers] = useState<Record<string, Goalscorer> | null>(null);
  const [proxyLineups, setProxyLineups] = useState<Record<string, LineupPair>>({});
  const [videoRect, setVideoRect] = useState<Rect | null>(null);

  // track the stream's box so the player rails flank the video symmetrically
  useEffect(() => {
    let last: Rect | null = null;
    const update = () => {
      const a = findAnchor();
      const r = a ? anchorRect(a) : null;
      if (rectsDiffer(last, r)) {
        last = r;
        setVideoRect(r);
      }
    };
    update();
    const t = setInterval(update, 1500);
    return () => clearInterval(t);
  }, []);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const refresh = useCallback(async () => {
    try {
      const w = await loadWallet();
      setWallet(w);
      const ms = (await fetchMarkets()).filter((m) => m.totalPool < SANE_POOL_LIMIT);
      setMarkets(ms);
      if (w) {
        setBal(await balances(w.publicKey));
        setBets(await fetchMyBets(w.publicKey));
      }
    } catch (e) {
      console.warn("onside refresh failed", e);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20_000);
    onWalletChange(refresh);
    return () => clearInterval(t);
  }, [refresh]);

  // rails collapse — persisted so the in-iframe fullscreen board respects it too
  useEffect(() => {
    try {
      chrome.storage?.local?.get("onside_hide_rails", (r) => setHideRails(!!r?.onside_hide_rails));
    } catch {
      /* orphaned script */
    }
  }, []);
  const toggleRails = () => {
    setHideRails((h) => {
      const next = !h;
      try {
        chrome.storage?.local?.set({ onside_hide_rails: next });
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // live scores from the local data proxy (renders nothing when offline)
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      const l = await fetchLiveAll();
      if (!stop && l) setLive(l);
    };
    poll();
    const t = setInterval(poll, 15_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  // StablePrice odds + goalscorer odds + late-breaking lineups for the opened match
  useEffect(() => {
    if (activeFixture == null) {
      setSpOdds(null);
      setGoalscorers(null);
      return;
    }
    let stop = false;
    const poll = async () => {
      const [o, lu, gs] = await Promise.all([
        fetchSpOdds(activeFixture),
        fetchProxyLineups(activeFixture),
        fetchGoalscorer(activeFixture),
      ]);
      if (stop) return;
      setSpOdds(o);
      setGoalscorers(gs);
      if (lu && (lu.home?.length || lu.away?.length)) {
        setProxyLineups((prev) => ({ ...prev, [String(activeFixture)]: lu }));
      }
    };
    poll();
    const t = setInterval(poll, 60_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [activeFixture]);

  const betByMarket = useMemo(() => {
    const map = new Map<string, BetView>();
    for (const b of bets) map.set(b.market.toBase58(), b);
    return map;
  }, [bets]);

  const matches = useMemo<MatchGroup[]>(() => {
    const groups = new Map<number, MatchGroup>();
    for (const m of markets) {
      const g = groups.get(m.fixtureId) ?? {
        fixtureId: m.fixtureId,
        home: m.fixture?.home ?? `Fixture #${m.fixtureId}`,
        away: m.fixture?.away ?? "",
        start: m.fixture?.start ?? 0,
        markets: [],
        state: "settled",
      };
      g.markets.push(m);
      if (m.state === "open") g.state = "open";
      else if (m.state === "locked" && g.state !== "open") g.state = "locked";
      groups.set(m.fixtureId, g);
    }
    return [...groups.values()].sort((a, b) => {
      const rank = (s: string) => (s === "open" ? 0 : s === "locked" ? 1 : 2);
      return rank(a.state) - rank(b.state) || a.start - b.start;
    });
  }, [markets]);

  // auto-focus the match that matters: a live one, else the soonest open,
  // else whatever's first — so the on-stream board shows without the panel.
  useEffect(() => {
    if (activeFixture != null) return;
    if (!matches.length) return;
    const isLive = (g: MatchGroup) => {
      const l = live[String(g.fixtureId)];
      return l && l.phase > 1 && !l.final;
    };
    const pick = matches.find(isLive) ?? matches.find((g) => g.state === "open") ?? matches[0];
    setActiveFixture(pick.fixtureId);
  }, [matches, activeFixture, live]);

  async function submitBet(m: MarketView, side: number, stake: number) {
    if (!wallet) return;
    setBusy("bet");
    try {
      await placeBet(wallet, m, side, stake);
      flash(`Bet locked: $${stake} on ${m.sideLabels[side]}`);
      await refresh();
    } catch (e: any) {
      flash(`Bet failed: ${(e.error?.errorMessage ?? e.message ?? e).slice(0, 60)}`);
    } finally {
      setBusy(null);
    }
  }

  async function submitClaim(m: MarketView) {
    if (!wallet) return;
    setBusy(m.address.toBase58());
    try {
      await claim(wallet, m);
      flash("Winnings claimed 🎉");
      await refresh();
    } catch (e: any) {
      flash(`Claim failed: ${(e.error?.errorMessage ?? e.message ?? e).slice(0, 60)}`);
    } finally {
      setBusy(null);
    }
  }

  const active = matches.find((g) => g.fixtureId === activeFixture);
  // proxy-served lineups win over the baked file — tonight's XIs go live
  // by editing crank/fixtures/lineups.json, no extension rebuild
  const activeLineups = active
    ? proxyLineups[String(active.fixtureId)] ?? LINEUPS[String(active.fixtureId)]
    : undefined;

  // Share the active match with tracker instances in player iframes
  // (they can't see this panel's state, but they can read extension storage).
  useEffect(() => {
    const ctx = active
      ? {
          fixtureId: active.fixtureId,
          teams: { home: active.home, away: active.away },
          lineups: activeLineups ?? null,
        }
      : null;
    try {
      chrome.storage?.local?.set({ onside_match_ctx: ctx });
    } catch {
      /* storage unavailable (orphaned script after reload) */
    }
  }, [active?.fixtureId, active?.home, active?.away, activeLineups]);

  return (
    <>
    {tracking && (
      <VideoOverlay
        lineups={{ home: activeLineups?.home ?? [], away: activeLineups?.away ?? [] }}
        teams={{ home: active?.home ?? "Home", away: active?.away ?? "Away" }}
        goalscorers={goalscorers}
        flash={flash}
        onClose={() => setTracking(false)}
      />
    )}
    {active && videoRect && (
      <StreamBoard
        rect={videoRect}
        teams={{ home: active.home, away: active.away }}
        lineups={{ home: activeLineups?.home ?? [], away: activeLineups?.away ?? [] }}
        markets={active.markets}
        bets={betByMarket}
        wallet={wallet}
        busy={busy}
        live={live[String(active.fixtureId)] ?? null}
        spOdds={spOdds}
        goalscorers={goalscorers}
        hideRails={hideRails}
        onBet={submitBet}
        onTapPlayer={(p) => {
          const gs = goalscorers?.[surnameKey(p.name)];
          flash(
            gs
              ? `⚽ ${shortName(p.name)} tagged next scorer — anytime ${gs.odds.toFixed(2)} (display only)`
              : `⚽ ${shortName(p.name)} tagged next scorer (display only)`
          );
        }}
      />
    )}
    <div
      style={{
        // anchored top-right within the full-cover overlay root (absolute, so
        // it survives fullscreen reparenting like the on-stream panels)
        position: "absolute",
        top: 0,
        right: 0,
        pointerEvents: "auto",
        margin: 16,
        width: open ? (active ? 480 : 320) : "auto",
        maxHeight: "84vh",
        display: "flex",
        flexDirection: "column",
        fontFamily: UI_FONT,
        color: C.ink,
        background: C.bg,
        border: `1px solid ${C.stroke}`,
        borderRadius: BRAND.radiusCard,
        boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
        overflow: "hidden",
        fontSize: 13,
        transition: "width .2s ease",
      }}
    >
      {/* header — the slim brand bar (betting happens on the stream strips) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "9px 12px",
          cursor: "pointer",
          background: BRAND.surface,
          flexShrink: 0,
        }}
        onClick={() => setOpen(!open)}
        title="Markets & claims"
      >
        <span style={{ color: C.ink, display: "flex", alignItems: "center" }}>
          <OnsideLogo size={20} />
        </span>
        <strong style={{ fontSize: 15, letterSpacing: 0.2 }}>
          on<span style={{ color: C.cyan }}>side</span>
        </strong>
        <span style={{ ...monoLabel, fontSize: 8, color: C.dim }}>played&nbsp;live · devnet</span>
        {bal && (
          // wallet info → data font, off-white (lime is reserved for selections)
          <span style={{ ...monoData, marginLeft: "auto", fontSize: 12, fontWeight: 700, color: C.ink }}>
            ${bal.usdc.toFixed(2)}
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setTracking(!tracking);
          }}
          title="Sticky player chips on the video"
          style={{
            marginLeft: bal ? 4 : "auto",
            border: `1px solid ${tracking ? C.cyan : C.stroke}`,
            background: tracking ? C.cyan : "transparent",
            color: tracking ? BRAND.bg : C.ink,
            borderRadius: BRAND.radiusControl,
            fontSize: 11,
            fontWeight: 800,
            padding: "2px 7px",
            cursor: "pointer",
          }}
        >
          🎯
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleRails();
          }}
          title={hideRails ? "Show player rails" : "Hide player rails"}
          style={{
            marginLeft: 4,
            border: `1px solid ${hideRails ? C.stroke : C.cyan}`,
            background: hideRails ? "transparent" : C.cyan,
            color: hideRails ? C.ink : BRAND.bg,
            borderRadius: BRAND.radiusControl,
            fontSize: 11,
            fontWeight: 800,
            padding: "2px 7px",
            cursor: "pointer",
          }}
        >
          👥
        </button>
        <span style={{ marginLeft: 2, fontSize: 12, color: C.dim }}>{open ? "▴" : "▾"}</span>
      </div>

      {open && (
        <div style={{ overflowY: "auto", padding: 12 }}>
          {!wallet && (
            <div style={{ color: C.dim, lineHeight: 1.5, marginBottom: 10 }}>
              No demo wallet yet — click the <b style={{ color: C.ink }}>Onside icon</b> in
              your toolbar and create one (free devnet funds included).
            </div>
          )}

          {matches.length > 1 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {matches.map((g) => {
                const sel = g.fixtureId === activeFixture;
                return (
                  <button
                    key={g.fixtureId}
                    onClick={() => setActiveFixture(g.fixtureId)}
                    style={{
                      border: `1px solid ${sel ? C.cyan : C.stroke}`,
                      background: sel ? BRAND.surfaceHover : BRAND.surface,
                      color: sel ? C.cyan : C.ink,
                      borderRadius: BRAND.radiusControl,
                      padding: "3px 10px",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: UI_FONT,
                    }}
                  >
                    {shortName(g.home)}–{shortName(g.away)}
                    <span style={{ color: C.dim, fontWeight: 400 }}> · {g.state}</span>
                  </button>
                );
              })}
            </div>
          )}
          {active ? (
            <MatchView
              fixtureId={active.fixtureId}
              title={{ home: active.home, away: active.away }}
              markets={active.markets}
              bets={betByMarket}
              wallet={wallet}
              busy={busy}
              live={live[String(active.fixtureId)] ?? null}
              spOdds={spOdds}
              onBet={submitBet}
              onClaim={submitClaim}
              onBack={() => setOpen(false)}
            />
          ) : (
            <>
              {matches.length === 0 && (
                <div style={{ color: C.dim }}>No markets published yet — check back soon.</div>
              )}
              {matches.map((g) => {
                const myCount = g.markets.filter((m) => betByMarket.has(m.address.toBase58())).length;
                const pool = g.markets.reduce((a, m) => a + m.totalPool, 0);
                const lv = live[String(g.fixtureId)];
                const started = lv && lv.phase > 1;
                return (
                  <div
                    key={g.fixtureId}
                    onClick={() => setActiveFixture(g.fixtureId)}
                    style={{
                      border: `1px solid ${C.stroke}`,
                      borderRadius: BRAND.radiusControl,
                      padding: "10px 12px",
                      marginBottom: 8,
                      background: BRAND.surface,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                      <b>
                        <span style={{ color: teamColors(g.home, "home").accent }}>{g.home}</span>
                        <span style={{ color: C.dim, fontWeight: 400 }}> vs </span>
                        <span style={{ color: teamColors(g.away, "away").accent }}>{g.away}</span>
                      </b>
                      {started && (
                        <b style={{ color: lv.final ? C.dim : C.green }}>
                          {lv.score.home}–{lv.score.away}
                          {!lv.final && lv.clock.seconds > 0 && (
                            <span style={{ fontWeight: 400 }}> · {Math.min(Math.floor(lv.clock.seconds / 60) + 1, 120)}′</span>
                          )}
                        </b>
                      )}
                      <span style={{ marginLeft: "auto", fontSize: 10, color: g.state === "open" ? C.green : C.dim, textTransform: "uppercase", fontWeight: 700 }}>
                        {started && !lv.final ? lv.phaseLabel : g.state}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
                      {g.start ? new Date(g.start).toLocaleString() + " · " : ""}
                      {g.markets.length} markets · pool ${pool.toFixed(0)}
                      {myCount > 0 && <span style={{ color: C.cyan }}> · {myCount} bet{myCount > 1 ? "s" : ""}</span>}
                    </div>
                  </div>
                );
              })}
              <div style={{ fontSize: 10, color: C.dim, textAlign: "center", marginTop: 6 }}>
                tap a match for the full board · settled by TxLINE Merkle proofs
              </div>
            </>
          )}
        </div>
      )}

      {toast && (
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 12,
            right: 12,
            background: BRAND.panel,
            border: `1px solid ${C.cyan}`,
            color: C.ink,
            borderRadius: BRAND.radiusControl,
            padding: "8px 10px",
            fontSize: 12,
          }}
        >
          {toast}
        </div>
      )}
    </div>
    </>
  );
}
