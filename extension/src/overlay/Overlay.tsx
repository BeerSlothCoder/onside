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
  fetchLiveAll,
  fetchProxyLineups,
  fetchSpOdds,
  LineupPair,
  LiveScore,
  OddsLine,
} from "../chain/live";
import { MatchView } from "./MatchView";
import { VideoOverlay } from "../tracking/ui/VideoOverlay";
import { findAnchor } from "../tracking/videoFinder";
import { anchorRect, rectsDiffer, type Rect } from "../tracking/geometry";
import { teamColors, type TeamColors } from "./teamColors";
import lineupsRaw from "../chain/lineups.json";

type Lineup = { n: string; name: string }[];
const LINEUPS = lineupsRaw as Record<string, { home: Lineup; away: Lineup }>;

function shortName(full: string): string {
  return full.includes(",") ? full.split(",")[0].trim() : full.split(" ").at(-1) ?? full;
}

/** Rail outer width in px: 170 content + 2×10 padding + 2×1 border. */
const RAIL_W = 192;

function PlayerRail(props: {
  team: string;
  players: Lineup;
  side: "left" | "right";
  colors: TeamColors;
  /** viewport-px left position (computed from the video rect) */
  x: number;
  onTap: (p: { n: string; name: string }) => void;
}) {
  const { colors } = props;
  const mirrored = props.side === "right";
  return (
    <div
      style={{
        position: "fixed",
        bottom: 64,
        left: props.x,
        width: 170,
        pointerEvents: "auto",
        background: "rgba(8,14,20,0.62)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 14,
        overflow: "hidden",
        zIndex: 2147483646,
        fontFamily: "system-ui, sans-serif",
        boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
      }}
    >
      {/* kit-color header bar */}
      <div
        style={{
          background: colors.badge,
          color: colors.badgeText,
          fontSize: 11.5,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          padding: "6px 10px",
          textAlign: "center",
          borderBottom: `2px solid ${colors.accent}`,
          textShadow: "0 1px 2px rgba(0,0,0,0.35)",
        }}
      >
        {props.team}
      </div>
      <div style={{ padding: 7 }}>
        {(props.players.length ? props.players : Array.from({ length: 11 }, (_, i) => ({ n: String(i + 1), name: `Player ${i + 1}` }))).map((p, i) => (
          <button
            key={i}
            onClick={() => props.onTap(p)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              flexDirection: mirrored ? "row-reverse" : "row",
              width: "100%",
              marginBottom: 3,
              border: "none",
              borderRadius: 8,
              padding: "3px 5px",
              background: i % 2 ? "transparent" : "rgba(255,255,255,0.045)",
              cursor: "pointer",
              overflow: "hidden",
            }}
          >
            <span
              style={{
                flexShrink: 0,
                width: 21,
                height: 21,
                borderRadius: 999,
                background: colors.badge,
                color: colors.badgeText,
                border: `1px solid ${colors.accent}`,
                fontSize: 10.5,
                fontWeight: 800,
                lineHeight: "19px",
                textAlign: "center",
              }}
            >
              {p.n}
            </span>
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                color: "#eaf2f7",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                textAlign: mirrored ? "right" : "left",
                flex: 1,
              }}
            >
              {shortName(p.name)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const C = {
  bg: "rgba(10,16,22,0.78)",
  stroke: "rgba(255,255,255,0.14)",
  cyan: "#22d3ee",
  green: "#34d399",
  dim: "#8aa0af",
  ink: "#eaf2f7",
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
  const [open, setOpen] = useState(true);
  const [wallet, setWallet] = useState<Keypair | null>(null);
  const [bal, setBal] = useState<{ sol: number; usdc: number } | null>(null);
  const [markets, setMarkets] = useState<MarketView[]>([]);
  const [bets, setBets] = useState<BetView[]>([]);
  const [activeFixture, setActiveFixture] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);
  const [live, setLive] = useState<Record<string, LiveScore>>({});
  const [spOdds, setSpOdds] = useState<OddsLine[] | null>(null);
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

  // StablePrice odds + late-breaking lineups for the opened match
  useEffect(() => {
    if (activeFixture == null) {
      setSpOdds(null);
      return;
    }
    let stop = false;
    const poll = async () => {
      const [o, lu] = await Promise.all([
        fetchSpOdds(activeFixture),
        fetchProxyLineups(activeFixture),
      ]);
      if (stop) return;
      setSpOdds(o);
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
        flash={flash}
        onClose={() => setTracking(false)}
      />
    )}
    {active && open && (() => {
      // flank the stream: rails hug the video's left/right edges, clamped
      // to the viewport; without a video, mirror symmetrically on the window
      const vw = window.innerWidth;
      // straddle the video edges: rails half-in half-out, clamped on screen
      const homeX = videoRect
        ? Math.max(8, videoRect.left - RAIL_W / 2)
        : 12;
      const awayX = videoRect
        ? Math.min(vw - RAIL_W - 8, videoRect.left + videoRect.width - RAIL_W / 2)
        : vw - RAIL_W - 12;
      return (
        <>
          <PlayerRail
            team={active.home}
            players={activeLineups?.home ?? []}
            side="left"
            colors={teamColors(active.home, "home")}
            x={homeX}
            onTap={(p) => flash(`${shortName(p.name)} — player markets need player-level on-chain proofs (display only)`)}
          />
          <PlayerRail
            team={active.away}
            players={activeLineups?.away ?? []}
            side="right"
            colors={teamColors(active.away, "away")}
            x={awayX}
            onTap={(p) => flash(`${shortName(p.name)} — player markets need player-level on-chain proofs (display only)`)}
          />
        </>
      );
    })()}
    <div
      style={{
        pointerEvents: "auto",
        margin: 16,
        width: active ? 520 : 320,
        maxHeight: "84vh",
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, sans-serif",
        color: C.ink,
        background: C.bg,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: `1px solid ${C.stroke}`,
        borderRadius: 14,
        boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
        overflow: "hidden",
        fontSize: 13,
        transition: "width .2s ease",
      }}
    >
      {/* header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          cursor: "pointer",
          background: "rgba(255,255,255,0.04)",
          flexShrink: 0,
        }}
        onClick={() => setOpen(!open)}
      >
        <strong style={{ fontSize: 15 }}>
          on<span style={{ color: C.cyan }}>side</span>
        </strong>
        <span style={{ fontSize: 10.5, color: C.dim }}>played live · devnet</span>
        {bal && (
          <span style={{ marginLeft: "auto", fontSize: 12, color: C.green, fontWeight: 700 }}>
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
            marginLeft: bal ? 6 : "auto",
            border: `1px solid ${tracking ? C.cyan : C.stroke}`,
            background: tracking ? C.cyan : "transparent",
            color: tracking ? "#04222a" : C.ink,
            borderRadius: 7,
            fontSize: 11,
            fontWeight: 800,
            padding: "2px 7px",
            cursor: "pointer",
          }}
        >
          🎯
        </button>
        <span style={{ marginLeft: 6, fontSize: 12 }}>{open ? "−" : "+"}</span>
      </div>

      {open && (
        <div style={{ overflowY: "auto", padding: 12 }}>
          {!wallet && (
            <div style={{ color: C.dim, lineHeight: 1.5, marginBottom: 10 }}>
              No demo wallet yet — click the <b style={{ color: C.ink }}>Onside icon</b> in
              your toolbar and create one (free devnet funds included).
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
              onBack={() => setActiveFixture(null)}
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
                      borderRadius: 10,
                      padding: "10px 12px",
                      marginBottom: 8,
                      background: "rgba(255,255,255,0.03)",
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
            background: "rgba(4,34,42,0.95)",
            border: `1px solid ${C.cyan}`,
            color: C.ink,
            borderRadius: 8,
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
