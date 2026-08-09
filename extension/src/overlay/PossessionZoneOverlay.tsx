import React, { useEffect, useMemo, useRef, useState } from "react";
import { DemoLedger } from "@onside/var-events";
import type { Rect } from "../tracking/geometry";
import type { BallTrack } from "../tracking/types";
import { ZoneGrid, type ZoneCellState } from "../tracking/ui/ZoneGrid";
import { BRAND, monoData, monoLabel, UI_FONT } from "./brand";

/**
 * "Bet on Possession" — click a pitch zone, and if the ball reaches it
 * within 10 seconds you win instantly. Modelled on markets.futbol's
 * zone-grid mechanic (tap a zone → live odds → 10s resolution window →
 * instant win); this build ships the core loop (single-zone bets, flat
 * payout) — combo/multi-zone stacking and live-shifting odds are documented
 * here as a fast-follow, not built.
 *
 * IMPORTANT — settlement honesty: resolution reads THIS VIEWER'S OWN local
 * CV ball-tracking (extension/src/tracking/detector.ts + tracker.ts,
 * running in-browser). That's the only ball-position signal that exists —
 * TxLINE doesn't expose raw ball coordinates, only score/stat events, so
 * there is no trustless multi-party oracle for "did the ball enter zone X"
 * the way there is for goal/corner/card markets. Different viewers' local
 * detectors could disagree slightly. So, same pattern as the VAR-moment
 * feature: a separate demo play-money ledger, a persistent "your device's
 * tracking" badge, and this stays architecturally distinct from the
 * Merkle-proof-settled on-chain markets. Do not wire this to the real vault.
 */

const WINDOW_MS = 10_000;
const PAYOUT_ODDS = 3.0; // flat placeholder — the reference product's odds shift live per zone; not modelled here
const STAKES = [10, 25, 50, 100];
const RESULT_DISPLAY_MS = 2500; // how long a resolved cell shows ✓/✕ before clearing
const USER_ID = "extension-user";

interface PendingBet {
  zoneKey: string;
  bounds: { u0: number; v0: number; u1: number; v1: number };
  stake: number;
  startedAtMs: number;
  deadlineMs: number;
  state: "pending" | "won" | "lost";
  resolvedAtMs?: number;
}

export function PossessionZoneOverlay({
  rect,
  ball,
  onClose,
}: {
  rect: Rect;
  ball: BallTrack | null;
  onClose: () => void;
}) {
  const ledger = useMemo(() => new DemoLedger(window.localStorage, "onside_possession_demo_ledger"), []);
  const [balance, setBalance] = useState(ledger.balanceOf(USER_ID));
  const [stake, setStake] = useState(25);
  const [bets, setBets] = useState<PendingBet[]>([]);
  const ballRef = useRef(ball);
  ballRef.current = ball;

  // resolution loop: check every pending bet against the live ball position,
  // and expire anything past its 10s window
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      const b = ballRef.current;
      setBets((current) => {
        let changed = false;
        const next = current
          .map((bet) => {
            if (bet.state !== "pending") return bet;
            const cx = b ? b.u + b.w / 2 : null;
            const cy = b ? b.v + b.h / 2 : null;
            const hit = cx !== null && cy !== null && cx >= bet.bounds.u0 && cx <= bet.bounds.u1 && cy >= bet.bounds.v0 && cy <= bet.bounds.v1;
            if (hit) {
              ledger.credit(USER_ID, bet.stake * PAYOUT_ODDS);
              changed = true;
              return { ...bet, state: "won" as const, resolvedAtMs: now };
            }
            if (now >= bet.deadlineMs) {
              changed = true;
              return { ...bet, state: "lost" as const, resolvedAtMs: now };
            }
            return bet;
          })
          // drop resolved bets a couple seconds after they resolve, and cap history
          .filter((bet) => bet.state === "pending" || !bet.resolvedAtMs || now - bet.resolvedAtMs < RESULT_DISPLAY_MS * 6);
        if (changed) setBalance(ledger.balanceOf(USER_ID));
        return changed || next.length !== current.length ? next : current;
      });
    }, 120);
    return () => clearInterval(iv);
  }, [ledger]);

  const pendingKeys = useMemo(() => new Set(bets.filter((b) => b.state === "pending").map((b) => b.zoneKey)), [bets]);

  const cellState = (key: string): ZoneCellState | undefined => {
    const recent = [...bets].reverse().find((b) => b.zoneKey === key);
    if (!recent) return undefined;
    if (recent.state === "pending") return "pending";
    if (recent.resolvedAtMs && Date.now() - recent.resolvedAtMs < RESULT_DISPLAY_MS) {
      return recent.state === "won" ? "won" : "lost";
    }
    return undefined;
  };
  const cellSecondsLeft = (key: string): number | undefined => {
    const bet = bets.find((b) => b.zoneKey === key && b.state === "pending");
    return bet ? Math.max(0, (bet.deadlineMs - Date.now()) / 1000) : undefined;
  };

  const placeBet = (zone: { key: string; u0: number; v0: number; u1: number; v1: number }) => {
    if (pendingKeys.has(zone.key)) return;
    const reservation = ledger.reserve(USER_ID, stake);
    if (!reservation) return;
    setBalance(ledger.balanceOf(USER_ID));
    const now = Date.now();
    setBets((current) => [
      ...current,
      { zoneKey: zone.key, bounds: zone, stake, startedAtMs: now, deadlineMs: now + WINDOW_MS, state: "pending" },
    ]);
  };

  const panel: React.CSSProperties = {
    background: BRAND.panel,
    border: `1px solid ${BRAND.border}`,
    borderRadius: BRAND.radiusCard,
    fontFamily: UI_FONT,
    color: BRAND.text,
    boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
    pointerEvents: "auto",
  };

  const liveCount = bets.filter((b) => b.state === "pending").length;

  return (
    <>
      <ZoneGrid rect={rect} cellState={cellState} cellSecondsLeft={cellSecondsLeft} onSelect={placeBet} disabled={!ball} />

      <div style={{ position: "absolute", top: 16, left: 16, zIndex: 2147483645, display: "flex", flexDirection: "column", gap: 8, width: 280 }}>
        <div
          style={{ ...panel, display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", border: `1px solid ${BRAND.cyan}` }}
          title="Resolves against this device's own live ball-tracking (not a shared oracle) — see the honesty note in the source."
        >
          <span style={{ width: 6, height: 6, borderRadius: 999, background: BRAND.cyan, flexShrink: 0 }} />
          <span style={{ ...monoLabel, fontSize: 9.5, fontWeight: 700, color: BRAND.cyan, whiteSpace: "nowrap" }}>
            POSSESSION · your device's tracking
          </span>
          <span style={{ ...monoData, marginLeft: "auto", fontSize: 12, fontWeight: 700 }}>{balance.toFixed(0)}</span>
          <button
            onClick={onClose}
            style={{ border: "none", background: "transparent", color: BRAND.textMuted, cursor: "pointer", fontSize: 13, padding: 0, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        <div style={{ ...panel, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {!ball ? (
            <div style={{ fontSize: 11.5, color: BRAND.textMuted, lineHeight: 1.5 }}>
              ⚽ ball not detected yet — needs 🎯 tracking + a CV-readable stream. Keep the video
              visible; this activates automatically once the ball is picked up.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>Tap a zone — reach it in 10s, win instantly</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ ...monoLabel, fontSize: 8, color: BRAND.textMuted }}>stake</span>
                {STAKES.map((v) => (
                  <button
                    key={v}
                    onClick={() => setStake(v)}
                    style={{
                      ...monoData,
                      background: stake === v ? BRAND.cyan : "transparent",
                      color: stake === v ? BRAND.bg : BRAND.text,
                      border: `1px solid ${stake === v ? BRAND.cyan : BRAND.border}`,
                      borderRadius: BRAND.radiusControl,
                      padding: "3px 8px",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {v}
                  </button>
                ))}
                <span style={{ ...monoData, marginLeft: "auto", fontSize: 10.5, color: BRAND.textMuted }}>{PAYOUT_ODDS.toFixed(1)}x</span>
              </div>
              {liveCount > 0 && (
                <div style={{ fontSize: 10.5, color: BRAND.cyan }}>
                  {liveCount} zone{liveCount > 1 ? "s" : ""} live — countdown shown on the grid
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
