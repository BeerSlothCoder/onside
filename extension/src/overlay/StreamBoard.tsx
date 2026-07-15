import React, { useState } from "react";
import type { Keypair } from "@solana/web3.js";
import { BetView, impliedOdds, MarketView } from "../chain/onside";
import { Goalscorer, LiveScore, OddsLine, sp1x2, spTotalGoals, surnameKey } from "../chain/live";
import type { Rect } from "../tracking/geometry";
import { teamColors, type TeamColors } from "./teamColors";
import { BRAND, monoLabel } from "./brand";

/**
 * goal.live-style board rendered ON the stream:
 *   top strip    — match outcome (1X2) in one line, centered
 *   bottom strip — corners (live counts) + goals chips in one line
 *   side rails   — full-height player columns hugging the video edges
 * All geometry derives from the video rect the Overlay already polls.
 */

const C = {
  glass: BRAND.glass,
  stroke: BRAND.stroke,
  cyan: BRAND.cyan,
  green: BRAND.lime,
  dim: BRAND.dim,
  ink: BRAND.ink,
};

const RAIL_W = 148;

function shortName(full: string): string {
  return full.includes(",") ? full.split(",")[0].trim() : full.split(" ").at(-1) ?? full;
}

type Player = { n: string; name: string };

interface Props {
  rect: Rect;
  teams: { home: string; away: string };
  lineups: { home: Player[]; away: Player[] };
  markets: MarketView[];
  bets: Map<string, BetView>;
  wallet: Keypair | null;
  busy: string | null;
  live?: LiveScore | null;
  spOdds?: OddsLine[] | null;
  goalscorers?: Record<string, Goalscorer> | null;
  onBet: (m: MarketView, side: number, stake: number) => void;
  onTapPlayer: (p: Player) => void;
}

export function StreamBoard(props: Props) {
  const { rect } = props;
  const homeC = teamColors(props.teams.home, "home");
  const awayC = teamColors(props.teams.away, "away");
  const [slip, setSlip] = useState<{ m: MarketView; side: number; label: string } | null>(null);
  const [stake, setStake] = useState(5);

  const matchResult = props.markets.find((m) => m.kind === "matchResult");
  const homeCorners = props.markets.find((m) => m.kind === "statOver" && m.statKey === 7);
  const awayCorners = props.markets.find((m) => m.kind === "statOver" && m.statKey === 8);
  // total-goals over/under market: statOver carrying stat_key2 (goals sum)
  const totalGoals = props.markets.find((m) => m.kind === "statOver" && m.statKey === 1);
  const sp = sp1x2(props.spOdds ?? null);
  const tg = spTotalGoals(props.spOdds ?? null);
  const started = !!props.live && props.live.phase > 1;

  const glass: React.CSSProperties = {
    background: C.glass,
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    border: `1px solid ${C.stroke}`,
    boxShadow: "0 8px 22px rgba(0,0,0,0.45)",
    fontFamily: "system-ui, sans-serif",
    pointerEvents: "auto",
  };

  /** One market side as a compact strip button. */
  const stripBtn = (
    m: MarketView | undefined,
    side: number,
    label: string,
    accent?: string,
    spPrice?: number,
    extra?: string
  ) => {
    if (!m) {
      return (
        <span style={{ padding: "4px 9px", fontSize: 10, color: C.dim, whiteSpace: "nowrap" }}>
          {label} <span style={{ fontSize: 8.5 }}>soon</span>
        </span>
      );
    }
    const odds = impliedOdds(m, side);
    const my = props.bets.get(m.address.toBase58());
    const isOutcome = m.state === "settled" && m.outcome === side;
    const sel = slip?.m.address.equals(m.address) && slip.side === side;
    const open = m.state === "open" && !!props.wallet;
    return (
      <button
        disabled={!open}
        onClick={() => setSlip(sel ? null : { m, side, label })}
        style={{
          border: `1px solid ${sel ? C.cyan : my?.side === side ? C.green : accent ?? C.stroke}`,
          background: sel ? C.cyan : isOutcome ? "rgba(52,211,153,0.16)" : "rgba(255,255,255,0.05)",
          color: sel ? "#04222a" : isOutcome ? C.green : accent ?? C.ink,
          borderRadius: 8,
          padding: "3px 9px",
          fontSize: 11.5,
          fontWeight: 800,
          cursor: open ? "pointer" : "default",
          opacity: !open && !isOutcome ? 0.6 : 1,
          whiteSpace: "nowrap",
          lineHeight: 1.25,
        }}
        title={`pool $${m.pools[side]?.toFixed(0) ?? 0}`}
      >
        {label}
        {isOutcome ? " ✓" : ""}
        {/* StablePrice is the meaningful market price; pool odds only once the
            parimutuel pool has real liquidity (else it reads a misleading 1.00x) */}
        {spPrice !== undefined ? (
          <span style={{ fontSize: 10.5, fontWeight: 800, color: sel ? "#04222a" : C.cyan }}>
            {" "}
            {spPrice.toFixed(2)}
          </span>
        ) : odds ? (
          <span style={{ fontSize: 9.5, fontWeight: 700, opacity: 0.85 }}> {odds.toFixed(2)}x</span>
        ) : null}
        {spPrice !== undefined && m.totalPool > 1 && odds ? (
          <span style={{ fontSize: 8.5, color: C.dim }}> · pool {odds.toFixed(2)}x</span>
        ) : null}
        {extra ? <span style={{ fontSize: 9, color: C.dim }}> {extra}</span> : null}
      </button>
    );
  };

  /** Mini bet slip attached to whichever strip spawned it. */
  const miniSlip = slip && slip.m.state === "open" && (
    <div
      style={{
        ...glass,
        display: "flex",
        alignItems: "center",
        gap: 6,
        borderRadius: 10,
        borderColor: C.cyan,
        padding: "6px 9px",
        marginTop: 6,
      }}
    >
      <span style={{ fontSize: 11, color: C.dim, whiteSpace: "nowrap" }}>
        <b style={{ color: C.ink }}>{slip.label}</b>
      </span>
      {[1, 5, 10, 25].map((v) => (
        <button
          key={v}
          onClick={() => setStake(v)}
          style={{
            border: `1px solid ${C.stroke}`,
            borderRadius: 7,
            padding: "3px 7px",
            fontSize: 11,
            fontWeight: 800,
            cursor: "pointer",
            background: stake === v ? C.cyan : "rgba(255,255,255,0.06)",
            color: stake === v ? "#04222a" : C.ink,
          }}
        >
          ${v}
        </button>
      ))}
      <button
        disabled={props.busy === "bet"}
        onClick={() => {
          props.onBet(slip.m, slip.side, stake);
          setSlip(null);
        }}
        style={{
          border: "none",
          borderRadius: 7,
          padding: "4px 10px",
          fontSize: 11,
          fontWeight: 800,
          cursor: "pointer",
          background: C.green,
          color: "#022",
        }}
      >
        {props.busy === "bet" ? "…" : "PLACE BET"}
      </button>
      <span style={{ cursor: "pointer", color: C.dim, fontSize: 12 }} onClick={() => setSlip(null)}>
        ✕
      </span>
    </div>
  );

  /** Full-height player rail hugging one video edge (goal.live style). */
  const rail = (side: "home" | "away") => {
    const colors: TeamColors = side === "home" ? homeC : awayC;
    const mirrored = side === "away";
    const players: Player[] = props.lineups[side].length
      ? props.lineups[side]
      : Array.from({ length: 11 }, (_, i) => ({ n: String(i + 1), name: "" }));
    const outside = side === "home" ? rect.left - RAIL_W - 4 : rect.left + rect.width + 4;
    const x =
      side === "home"
        ? outside >= 4
          ? outside
          : rect.left + 4
        : outside + RAIL_W <= window.innerWidth - 4
          ? outside
          : rect.left + rect.width - RAIL_W - 4;
    const rowH = Math.min(44, Math.max(24, (rect.height - 34) / players.length - 3));
    return (
      <div
        style={{
          ...glass,
          position: "fixed",
          left: x,
          top: rect.top,
          width: RAIL_W,
          height: rect.height,
          borderRadius: 12,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          zIndex: 2147483646,
        }}
      >
        <div
          style={{
            background: colors.badge,
            color: colors.badgeText,
            borderBottom: `2px solid ${colors.accent}`,
            fontSize: 11,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: 0.7,
            padding: "6px 8px",
            textAlign: "center",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flexShrink: 0,
          }}
        >
          {props.teams[side]}
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-evenly", padding: "3px 5px" }}>
          {players.map((p, i) => (
            <button
              key={i}
              onClick={() => props.onTapPlayer({ n: p.n, name: p.name || `Player ${p.n}` })}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexDirection: mirrored ? "row-reverse" : "row",
                height: rowH,
                border: "none",
                borderRadius: 7,
                padding: "0 5px",
                background: i % 2 ? "transparent" : "rgba(255,255,255,0.05)",
                cursor: "pointer",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  background: colors.badge,
                  color: colors.badgeText,
                  border: `1px solid ${colors.accent}`,
                  fontSize: 10,
                  fontWeight: 800,
                  lineHeight: "18px",
                  textAlign: "center",
                }}
              >
                {p.n}
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: C.ink,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  textAlign: mirrored ? "right" : "left",
                }}
              >
                {p.name ? shortName(p.name) : ""}
              </span>
              {(() => {
                const gs = p.name ? props.goalscorers?.[surnameKey(p.name)] : undefined;
                return gs ? (
                  <span
                    title={`${gs.name} — anytime goalscorer odds (the-odds-api)`}
                    style={{
                      flexShrink: 0,
                      fontSize: 10,
                      fontWeight: 800,
                      color: C.green,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    ⚽{gs.odds.toFixed(2)}
                  </span>
                ) : null;
              })()}
            </button>
          ))}
        </div>
      </div>
    );
  };

  // Total goals over/under, priced live by TxODDS StablePrice. Clickable once
  // the on-chain total-goals market exists; until then shows live odds only.
  const goalsSection = (
    <>
      <span style={{ ...monoLabel, fontSize: 9, color: C.dim, whiteSpace: "nowrap" }}>
        goals o{totalGoals ? `${totalGoals.threshold}.5` : tg ? tg.line : "2.5"}
      </span>
      {totalGoals ? (
        <>
          {stripBtn(totalGoals, 0, "Over", C.cyan, tg?.over)}
          {stripBtn(totalGoals, 1, "Under", C.cyan, tg?.under)}
        </>
      ) : (
        ["Over", "Under"].map((lbl, i) => (
          <span
            key={lbl}
            title="TxODDS live odds · on-chain total-goals market coming"
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: C.dim,
              border: `1px solid ${C.stroke}`,
              borderRadius: 8,
              padding: "3px 9px",
              whiteSpace: "nowrap",
            }}
          >
            {lbl}
            <span style={{ fontSize: 9.5, color: tg ? C.cyan : C.dim }}>
              {tg ? ` SP ${(i === 0 ? tg.over : tg.under).toFixed(2)}` : " soon"}
            </span>
          </span>
        ))
      )}
    </>
  );

  return (
    <>
      {/* top strip: match outcome, centered — clear of broadcaster scorebugs */}
      <div
        style={{
          position: "fixed",
          left: rect.left + rect.width / 2,
          top: rect.top + 8,
          transform: "translateX(-50%)",
          zIndex: 2147483646,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            ...glass,
            display: "flex",
            alignItems: "center",
            gap: 6,
            borderRadius: 999,
            padding: "5px 10px",
          }}
        >
          {started && props.live && (
            <b style={{ fontSize: 11.5, color: props.live.final ? C.dim : C.green, whiteSpace: "nowrap" }}>
              {props.live.score.home}–{props.live.score.away}
              <span style={{ fontWeight: 400, fontSize: 9.5 }}> {props.live.phaseLabel}</span>
            </b>
          )}
          {stripBtn(matchResult, 0, props.teams.home, homeC.accent, sp?.[0] ?? undefined)}
          {stripBtn(matchResult, 1, "Draw", undefined, sp?.[1] ?? undefined)}
          {stripBtn(matchResult, 2, props.teams.away, awayC.accent, sp?.[2] ?? undefined)}
        </div>
        {slip?.m === matchResult && miniSlip}
      </div>

      {/* bottom strip: corners with live counts + goals (soon), one line */}
      <div
        style={{
          position: "fixed",
          left: rect.left + rect.width / 2,
          top: rect.top + rect.height - 44,
          transform: "translate(-50%, -100%)",
          zIndex: 2147483646,
          display: "flex",
          flexDirection: "column-reverse",
          alignItems: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            ...glass,
            display: "flex",
            alignItems: "center",
            gap: 6,
            borderRadius: 999,
            padding: "5px 10px",
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 800, color: homeC.accent, whiteSpace: "nowrap" }}>
            ⚑ corners o{homeCorners ? `${homeCorners.threshold}.5` : ""}
            {started && props.live ? ` · ${props.live.corners.home}` : ""}
          </span>
          {stripBtn(homeCorners, 0, "Over", homeC.accent)}
          {stripBtn(homeCorners, 1, "Under", homeC.accent)}
          <span style={{ width: 1, alignSelf: "stretch", background: C.stroke }} />
          {stripBtn(awayCorners, 0, "Over", awayC.accent)}
          {stripBtn(awayCorners, 1, "Under", awayC.accent)}
          <span style={{ fontSize: 10, fontWeight: 800, color: awayC.accent, whiteSpace: "nowrap" }}>
            {started && props.live ? `${props.live.corners.away} · ` : ""}o
            {awayCorners ? `${awayCorners.threshold}.5` : ""} corners ⚑
          </span>
          <span style={{ width: 1, alignSelf: "stretch", background: C.stroke }} />
          {goalsSection}
        </div>
        {slip && slip.m !== matchResult && miniSlip}
      </div>

      {rail("home")}
      {rail("away")}
    </>
  );
}
