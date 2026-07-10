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
import { MatchView } from "./MatchView";
import { VideoOverlay } from "../tracking/ui/VideoOverlay";
import lineupsRaw from "../chain/lineups.json";

type Lineup = { n: string; name: string }[];
const LINEUPS = lineupsRaw as Record<string, { home: Lineup; away: Lineup }>;

function shortName(full: string): string {
  return full.includes(",") ? full.split(",")[0].trim() : full.split(" ").at(-1) ?? full;
}

function PlayerRail(props: {
  team: string;
  players: Lineup;
  side: "left" | "right";
  panelWidth: number;
  onTap: (p: { n: string; name: string }) => void;
}) {
  const pos: React.CSSProperties =
    props.side === "left"
      ? { left: 12 }
      : { right: props.panelWidth + 40 };
  return (
    <div
      style={{
        position: "fixed",
        top: "16vh",
        ...pos,
        width: 128,
        pointerEvents: "auto",
        background: "rgba(10,16,22,0.88)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 12,
        padding: 8,
        zIndex: 2147483646,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 800, color: "#8aa0af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, textAlign: "center" }}>
        {props.team}
      </div>
      {(props.players.length ? props.players : Array.from({ length: 11 }, (_, i) => ({ n: String(i + 1), name: `Player ${i + 1}` }))).map((p, i) => (
        <button
          key={i}
          onClick={() => props.onTap(p)}
          style={{
            display: "block",
            width: "100%",
            marginBottom: 4,
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 7,
            padding: "4px 6px",
            fontSize: 10.5,
            fontWeight: 700,
            background: "rgba(255,255,255,0.06)",
            color: "#eaf2f7",
            cursor: "pointer",
            textAlign: props.side === "left" ? "left" : "right",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {props.side === "left" ? `${p.n} · ${shortName(p.name)}` : `${shortName(p.name)} · ${p.n}`}
        </button>
      ))}
    </div>
  );
}

const C = {
  bg: "rgba(10,16,22,0.95)",
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
  const activeLineups = active ? LINEUPS[String(active.fixtureId)] : undefined;

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
    {active && open && (
      <>
        <PlayerRail
          team={active.home}
          players={activeLineups?.home ?? []}
          side="left"
          panelWidth={520}
          onTap={(p) => flash(`${shortName(p.name)} — player markets need player-level on-chain proofs (display only)`)}
        />
        <PlayerRail
          team={active.away}
          players={activeLineups?.away ?? []}
          side="right"
          panelWidth={520}
          onTap={(p) => flash(`${shortName(p.name)} — player markets need player-level on-chain proofs (display only)`)}
        />
      </>
    )}
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
                      <b>{g.home} vs {g.away}</b>
                      <span style={{ marginLeft: "auto", fontSize: 10, color: g.state === "open" ? C.green : C.dim, textTransform: "uppercase", fontWeight: 700 }}>
                        {g.state}
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
