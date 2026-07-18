import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Keypair } from "@solana/web3.js";
import type { Lineups } from "../types";
import { VideoOverlay } from "./VideoOverlay";
import { StreamBoard } from "../../overlay/StreamBoard";
import { BRAND } from "../../overlay/brand";
import { loadWallet, onWalletChange } from "../../chain/wallet";
import {
  balances,
  BetView,
  fetchMarkets,
  fetchMyBets,
  MarketView,
  placeBet,
} from "../../chain/onside";
import {
  fetchGoalscorer,
  fetchLiveAll,
  fetchProxyLineups,
  fetchSpOdds,
  Goalscorer,
  LineupPair,
  LiveScore,
  OddsLine,
} from "../../chain/live";
import { findAnchor } from "../videoFinder";
import { anchorRect, rectsDiffer, type Rect } from "../geometry";

interface MatchCtx {
  fixtureId: number;
  teams: { home: string; away: string };
  lineups: Lineups | null;
}

const SANE_POOL_LIMIT = 100_000;

/**
 * Tracker UI for player IFRAMES (e.g. ČT / Nova embeds). Inside the frame we
 * can reach the real <video>, so pins + CV work. The active match is shared by
 * the top-frame panel via extension storage.
 *
 * The top-frame market board floats over the iframe in windowed mode, but when
 * the player fullscreens the iframe the top frame is no longer rendered — so we
 * ALSO render the board here, but only while this frame is fullscreen (avoids a
 * duplicate board windowed). The iframe content script has the same extension
 * privileges, so it reads markets/odds/wallet independently.
 */
export function FrameTracker() {
  const [on, setOn] = useState(false);
  const [ctx, setCtx] = useState<MatchCtx | null>(null);
  const [isFs, setIsFs] = useState(false);

  // shared match context (teams + lineups) from the top-frame panel
  useEffect(() => {
    const apply = (v: unknown) => setCtx((v as MatchCtx) ?? null);
    try {
      chrome.storage.local.get("onside_match_ctx").then((r) => apply(r.onside_match_ctx));
      const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area === "local" && changes.onside_match_ctx) apply(changes.onside_match_ctx.newValue);
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    } catch {
      /* orphaned script after extension reload */
    }
  }, []);

  // this frame's own fullscreen state
  useEffect(() => {
    const sync = () =>
      setIsFs(!!(document.fullscreenElement || (document as any).webkitFullscreenElement));
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  return (
    <>
      {/* the board renders inside the iframe only while it's fullscreen */}
      {isFs && ctx && <IframeBoard ctx={ctx} />}

      {!on ? (
        <button
          onClick={() => setOn(true)}
          title="Onside — pin players on the video"
          style={{
            position: "absolute",
            left: 12,
            bottom: 12,
            zIndex: 2147483646,
            pointerEvents: "auto",
            border: `1px solid ${BRAND.border}`,
            background: BRAND.panel,
            color: BRAND.text,
            borderRadius: 999,
            width: 34,
            height: 34,
            fontSize: 15,
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
          }}
        >
          🎯
        </button>
      ) : (
        <VideoOverlay
          lineups={ctx?.lineups ?? { home: [], away: [] }}
          teams={ctx?.teams ?? { home: "Home", away: "Away" }}
          flash={() => undefined}
          onClose={() => setOn(false)}
        />
      )}
    </>
  );
}

/** Self-sufficient market board for the fullscreen iframe (own chain reads). */
function IframeBoard({ ctx }: { ctx: MatchCtx }) {
  const [wallet, setWallet] = useState<Keypair | null>(null);
  const [markets, setMarkets] = useState<MarketView[]>([]);
  const [bets, setBets] = useState<BetView[]>([]);
  const [bal, setBal] = useState<{ sol: number; usdc: number } | null>(null);
  const [live, setLive] = useState<Record<string, LiveScore>>({});
  const [spOdds, setSpOdds] = useState<OddsLine[] | null>(null);
  const [goalscorers, setGoalscorers] = useState<Record<string, Goalscorer> | null>(null);
  const [proxyLineup, setProxyLineup] = useState<LineupPair | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [videoRect, setVideoRect] = useState<Rect | null>(null);

  const refresh = useCallback(async () => {
    try {
      const w = await loadWallet();
      setWallet(w);
      setMarkets((await fetchMarkets()).filter((m) => m.totalPool < SANE_POOL_LIMIT));
      if (w) {
        setBal(await balances(w.publicKey));
        setBets(await fetchMyBets(w.publicKey));
      }
    } catch {
      /* transient RPC error */
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20_000);
    onWalletChange(refresh);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      const [l, o, gs, lu] = await Promise.all([
        fetchLiveAll(),
        fetchSpOdds(ctx.fixtureId),
        fetchGoalscorer(ctx.fixtureId),
        fetchProxyLineups(ctx.fixtureId),
      ]);
      if (stop) return;
      if (l) setLive(l);
      setSpOdds(o);
      setGoalscorers(gs);
      if (lu && (lu.home?.length || lu.away?.length)) setProxyLineup(lu);
    };
    poll();
    const t = setInterval(poll, 15_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [ctx.fixtureId]);

  // track the iframe's own video box
  useEffect(() => {
    let lastR: Rect | null = null;
    const update = () => {
      const a = findAnchor();
      const r = a ? anchorRect(a) : null;
      if (rectsDiffer(lastR, r)) {
        lastR = r;
        setVideoRect(r);
      }
    };
    update();
    const t = setInterval(update, 800);
    return () => clearInterval(t);
  }, []);

  const betByMarket = useMemo(() => {
    const m = new Map<string, BetView>();
    for (const b of bets) m.set(b.market.toBase58(), b);
    return m;
  }, [bets]);

  const activeMarkets = useMemo(
    () => markets.filter((m) => m.fixtureId === ctx.fixtureId),
    [markets, ctx.fixtureId]
  );

  const submitBet = async (m: MarketView, side: number, stake: number) => {
    if (!wallet) return;
    setBusy("bet");
    try {
      await placeBet(wallet, m, side, stake);
      await refresh();
    } catch {
      /* surfaced via unchanged state */
    } finally {
      setBusy(null);
    }
  };

  const lineups = proxyLineup ?? ctx.lineups ?? { home: [], away: [] };
  if (!videoRect || activeMarkets.length === 0) return null;

  return (
    <StreamBoard
      rect={videoRect}
      teams={ctx.teams}
      lineups={{ home: lineups.home ?? [], away: lineups.away ?? [] }}
      markets={activeMarkets}
      bets={betByMarket}
      wallet={wallet}
      busy={busy}
      live={live[String(ctx.fixtureId)] ?? null}
      spOdds={spOdds}
      goalscorers={goalscorers}
      onBet={submitBet}
      onTapPlayer={() => undefined /* player markets need player-level proofs */}
    />
  );
}
