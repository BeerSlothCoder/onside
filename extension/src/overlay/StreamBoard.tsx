import React, { useState } from "react";
import type { Keypair } from "@solana/web3.js";
import { BetView, impliedOdds, MarketView } from "../chain/onside";
import { Goalscorer, LiveScore, OddsLine, sp1x2, spTotalGoals, surnameKey } from "../chain/live";
import type { Rect } from "../tracking/geometry";
import { teamColors, type TeamColors } from "./teamColors";
import { BRAND, MONO_FONT, UI_FONT, monoData, monoLabel } from "./brand";

/**
 * The board rendered ON the stream, goal.live-style, per the Onside style guide:
 *   top strip     — match outcome (large) + total goals, live timer/score
 *   bottom-left   — left team's corners      bottom-right — right team's corners
 *   player rails  — half-width columns at the video edges, odds above the name
 *   ⇄ change sides swaps rails + corners at half time (teams switch ends)
 * Cyan = act or live. Lime = selected or resolved. Dark green frames the stream.
 */

const RAIL_MIN = 84;
const RAIL_MAX = 124;

function shortName(full: string): string {
  return full.includes(",") ? full.split(",")[0].trim() : full.split(" ").at(-1) ?? full;
}

type Player = { n: string; name: string };
type Side = "home" | "away";

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
  const [sel, setSel] = useState<{ m: MarketView; side: number; label: string } | null>(null);
  const [stake, setStake] = useState(5);
  const [swapped, setSwapped] = useState(false);

  const matchResult = props.markets.find((m) => m.kind === "matchResult");
  const homeCorners = props.markets.find((m) => m.kind === "statOver" && m.statKey === 7);
  const awayCorners = props.markets.find((m) => m.kind === "statOver" && m.statKey === 8);
  const totalGoals = props.markets.find((m) => m.kind === "statOver" && m.statKey === 1);
  const sp = sp1x2(props.spOdds ?? null);
  const tg = spTotalGoals(props.spOdds ?? null);
  const started = !!props.live && props.live.phase > 1;

  const colorOf = (s: Side) => teamColors(props.teams[s], s);
  const cornersOf = (s: Side) => (s === "home" ? homeCorners : awayCorners);

  // change-sides: which team is drawn on the left / right of the stream
  const leftSide: Side = swapped ? "away" : "home";
  const rightSide: Side = swapped ? "home" : "away";

  /** Dark overlay panel — solid canvas at 95%, thin technical border. */
  const panel: React.CSSProperties = {
    background: BRAND.panel,
    border: `1px solid ${BRAND.border}`,
    fontFamily: UI_FONT,
    pointerEvents: "auto",
  };

  /** A market outcome cell. `big` = top strip (match result / goals). */
  const cell = (
    m: MarketView | undefined,
    side: number,
    label: string,
    opts: { accent?: string; spPrice?: number; big?: boolean } = {}
  ) => {
    const { accent, spPrice, big } = opts;
    if (!m) {
      return (
        <span
          style={{
            ...monoLabel,
            padding: big ? "0 12px" : "0 8px",
            fontSize: big ? 8.5 : 7,
            color: BRAND.textMuted,
            whiteSpace: "nowrap",
            alignSelf: "center",
          }}
        >
          {label} · soon
        </span>
      );
    }
    const odds = impliedOdds(m, side);
    const my = props.bets.get(m.address.toBase58());
    const resolved = m.state === "settled" && m.outcome === side;
    const picked = sel?.m.address.equals(m.address) && sel.side === side;
    const open = m.state === "open" && !!props.wallet;
    const limeState = picked || resolved || my?.side === side;
    return (
      <button
        disabled={!open}
        onClick={() => setSel(picked ? null : { m, side, label })}
        title={m.state !== "open" ? `market ${m.state}` : `pool $${m.pools[side]?.toFixed(0) ?? 0}`}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: big ? 3 : 2,
          minWidth: big ? 76 : 52,
          padding: big ? "6px 13px" : "3px 9px",
          border: "none",
          borderRight: `1px solid ${BRAND.border}`,
          background: picked ? BRAND.lime : "transparent",
          color: picked ? BRAND.bg : BRAND.text,
          cursor: open ? "pointer" : "default",
          opacity: !open && !resolved ? 0.45 : 1,
          fontFamily: UI_FONT,
        }}
        onMouseEnter={(e) => {
          if (open && !picked) e.currentTarget.style.background = BRAND.surfaceHover;
        }}
        onMouseLeave={(e) => {
          if (!picked) e.currentTarget.style.background = "transparent";
        }}
      >
        <span
          style={{
            ...monoLabel,
            fontSize: big ? 11 : 7,
            fontWeight: big ? 700 : 400,
            letterSpacing: big ? "0.06em" : "0.18em",
            color: picked ? BRAND.bg : accent ?? BRAND.textMuted,
            whiteSpace: "nowrap",
            maxWidth: big ? 140 : 90,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
          {resolved ? " ✓" : ""}
        </span>
        <span
          style={{
            ...monoData,
            fontSize: big ? 15 : 10.5,
            fontWeight: 700,
            color: picked ? BRAND.bg : limeState ? BRAND.lime : BRAND.text,
            whiteSpace: "nowrap",
          }}
        >
          {spPrice !== undefined ? spPrice.toFixed(2) : odds ? `${odds.toFixed(2)}x` : "—"}
        </span>
      </button>
    );
  };

  /** Stake selector + primary confirm — rendered under the active market. */
  const confirmBar = (m: MarketView) =>
    sel &&
    sel.m.address.equals(m.address) &&
    sel.m.state === "open" && (
      <div
        style={{
          ...panel,
          display: "flex",
          alignItems: "center",
          gap: 6,
          borderRadius: BRAND.radiusControl,
          padding: "6px 8px",
          marginTop: 6,
        }}
      >
        <span style={{ ...monoLabel, fontSize: 7.5, color: BRAND.textMuted, whiteSpace: "nowrap" }}>
          {sel.label}
        </span>
        {[1, 5, 10, 25].map((v) => {
          const onSel = stake === v;
          return (
            <button
              key={v}
              onClick={() => setStake(v)}
              style={{
                ...monoData,
                background: onSel ? BRAND.lime : "transparent",
                color: onSel ? BRAND.bg : BRAND.text,
                border: `1px solid ${onSel ? BRAND.lime : BRAND.border}`,
                borderRadius: BRAND.radiusControl,
                padding: "4px 8px",
                fontSize: 11,
                fontWeight: onSel ? 700 : 600,
                cursor: "pointer",
              }}
            >
              {v}
            </button>
          );
        })}
        <button
          disabled={props.busy === "bet"}
          onClick={() => {
            props.onBet(sel.m, sel.side, stake);
            setSel(null);
          }}
          style={{
            background: BRAND.cyan,
            color: BRAND.bg,
            border: `1px solid ${BRAND.cyan}`,
            borderRadius: BRAND.radiusControl,
            height: 30,
            padding: "0 14px",
            fontFamily: UI_FONT,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            opacity: props.busy === "bet" ? 0.4 : 1,
            whiteSpace: "nowrap",
          }}
        >
          {props.busy === "bet" ? "SIGNING…" : "CONFIRM"}
        </button>
        <button
          onClick={() => setSel(null)}
          style={{
            background: "transparent",
            color: BRAND.textMuted,
            border: `1px solid ${BRAND.border}`,
            borderRadius: BRAND.radiusControl,
            height: 30,
            padding: "0 8px",
            fontFamily: UI_FONT,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      </div>
    );

  /** Half-width player rail; number badge + (odds above name). */
  const rail = (pos: "left" | "right", side: Side) => {
    const colors: TeamColors = colorOf(side);
    const mirrored = pos === "right";
    const players: Player[] = props.lineups[side].length
      ? props.lineups[side]
      : Array.from({ length: 11 }, (_, i) => ({ n: String(i + 1), name: "" }));
    const pct = window.innerWidth < 1400 ? 0.11 : 0.085; // ~half of the old 14%
    const railW = Math.round(Math.min(RAIL_MAX, Math.max(RAIL_MIN, rect.width * pct)));
    const inset = 6;
    const leftBar = rect.left;
    const rightBar = window.innerWidth - (rect.left + rect.width);
    const flank = leftBar >= railW + 4 && rightBar >= railW + 4;
    const x =
      pos === "left"
        ? flank
          ? rect.left - railW - 4
          : rect.left + inset
        : flank
          ? rect.left + rect.width + 4
          : rect.left + rect.width - railW - inset;
    const rowH = Math.min(34, Math.max(24, (rect.height - 26) / players.length - 2));
    return (
      <div
        style={{
          ...panel,
          position: "absolute",
          left: x,
          top: rect.top,
          width: railW,
          height: rect.height,
          borderRadius: BRAND.radiusCard,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          zIndex: 2147483646,
        }}
      >
        <div
          style={{
            ...monoLabel,
            background: colors.badge,
            color: colors.badgeText,
            borderBottom: `1px solid ${BRAND.border}`,
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.04em",
            padding: "6px 6px",
            textAlign: "center",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flexShrink: 0,
          }}
        >
          {props.teams[side]}
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-evenly" }}>
          {players.map((p, i) => {
            const gs = p.name ? props.goalscorers?.[surnameKey(p.name)] : undefined;
            return (
              <button
                key={i}
                onClick={() => props.onTapPlayer({ n: p.n, name: p.name || `Player ${p.n}` })}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  flexDirection: mirrored ? "row-reverse" : "row",
                  height: rowH,
                  border: "none",
                  borderBottom: `1px solid ${BRAND.border}`,
                  padding: "0 5px",
                  background: BRAND.surface,
                  cursor: "pointer",
                  overflow: "hidden",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = BRAND.surfaceHover)}
                onMouseLeave={(e) => (e.currentTarget.style.background = BRAND.surface)}
              >
                <span
                  style={{
                    ...monoData,
                    flexShrink: 0,
                    width: 15,
                    fontSize: 11,
                    fontWeight: 600,
                    color: BRAND.textMuted,
                    textAlign: "center",
                  }}
                >
                  {p.n}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: mirrored ? "flex-end" : "flex-start",
                    lineHeight: 1.05,
                  }}
                >
                  {gs && (
                    <span style={{ ...monoData, fontSize: 8.5, fontWeight: 700, color: BRAND.lime }}>
                      {gs.odds.toFixed(2)}
                    </span>
                  )}
                  <span
                    style={{
                      fontFamily: UI_FONT,
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: "-0.01em",
                      color: BRAND.text,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: "100%",
                    }}
                  >
                    {p.name ? shortName(p.name) : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  /** Corner market panel for one bottom corner. */
  const cornerPanel = (pos: "left" | "right", side: Side) => {
    const m = cornersOf(side);
    const c = colorOf(side);
    const nowCount = started && props.live ? props.live.corners[side] : null;
    return (
      <div
        style={{
          position: "absolute",
          bottom: 52,
          [pos]: 10,
          zIndex: 2147483646,
          display: "flex",
          flexDirection: "column",
          alignItems: pos === "left" ? "flex-start" : "flex-end",
        } as React.CSSProperties}
      >
        <div
          style={{
            ...panel,
            borderRadius: BRAND.radiusControl,
            borderTop: `2px solid ${c.accent}`,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              ...monoLabel,
              fontSize: 9,
              fontWeight: 700,
              color: c.accent,
              padding: "5px 9px",
              borderBottom: `1px solid ${BRAND.border}`,
              whiteSpace: "nowrap",
              textAlign: pos,
            }}
          >
            ⚑ {shortName(props.teams[side])} corners o{m ? `${m.threshold}.5` : ""}
            {nowCount !== null ? ` · now ${nowCount}` : ""}
          </div>
          <div style={{ display: "flex" }}>
            {cell(m, 0, "Over", { accent: c.accent })}
            {cell(m, 1, "Under", { accent: c.accent })}
          </div>
        </div>
        {m && confirmBar(m)}
      </div>
    );
  };

  /** Current-position slip — compact, lime border, bottom centre. */
  const positions = props.markets
    .map((m) => ({ m, bet: props.bets.get(m.address.toBase58()) }))
    .filter((x) => x.bet);

  return (
    <>
      {/* TOP STRIP — match result (large) + total goals + change sides */}
      <div
        style={{
          position: "absolute",
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
        <div style={{ ...panel, display: "flex", alignItems: "stretch", minHeight: 46, borderRadius: BRAND.radiusControl, overflow: "hidden" }}>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "0 11px",
              borderRight: `1px solid ${BRAND.border}`,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: started && !props.live?.final ? BRAND.cyan : BRAND.textMuted,
                flexShrink: 0,
              }}
            />
            <span style={{ ...monoData, fontSize: 11, fontWeight: 700, color: BRAND.cyan, whiteSpace: "nowrap" }}>
              {started && props.live
                ? `${props.live.phaseLabel}${
                    props.live.clock.running
                      ? ` ${Math.min(Math.floor(props.live.clock.seconds / 60) + 1, 120)}'`
                      : ""
                  }`
                : "PRE"}
            </span>
            {started && props.live && (
              <span style={{ ...monoData, fontSize: 13, fontWeight: 700, color: BRAND.text }}>
                {props.live.score.home}–{props.live.score.away}
              </span>
            )}
          </span>
          {cell(matchResult, 0, props.teams.home, { accent: colorOf("home").accent, spPrice: sp?.[0], big: true })}
          {cell(matchResult, 1, "Draw", { spPrice: sp?.[1], big: true })}
          {cell(matchResult, 2, props.teams.away, { accent: colorOf("away").accent, spPrice: sp?.[2], big: true })}
          {/* total goals in the same line as the match result */}
          <span
            style={{
              ...monoLabel,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              lineHeight: 1.15,
              fontSize: 8,
              color: BRAND.textMuted,
              padding: "0 8px",
              borderRight: `1px solid ${BRAND.border}`,
              whiteSpace: "nowrap",
            }}
          >
            <span>goals</span>
            <span>o{totalGoals ? `${totalGoals.threshold}.5` : tg ? tg.line : "2.5"}</span>
          </span>
          {cell(totalGoals, 0, "Over", { spPrice: tg?.over, big: true })}
          {cell(totalGoals, 1, "Under", { spPrice: tg?.under, big: true })}
          {/* change sides */}
          <button
            onClick={() => setSwapped((s) => !s)}
            title="Swap sides (teams change ends at half time)"
            style={{
              ...monoLabel,
              pointerEvents: "auto",
              border: "none",
              borderLeft: `1px solid ${BRAND.border}`,
              background: swapped ? BRAND.surfaceHover : "transparent",
              color: BRAND.cyan,
              fontSize: 13,
              padding: "0 11px",
              cursor: "pointer",
            }}
          >
            ⇄
          </button>
        </div>
        {(sel?.m === matchResult || sel?.m === totalGoals) && sel && confirmBar(sel.m)}
        {positions.length > 0 && (
          <div
            style={{
              ...panel,
              border: `1px solid ${BRAND.lime}`,
              borderRadius: BRAND.radiusControl,
              boxShadow: "0 6px 18px rgba(0,0,0,0.55)",
              padding: "4px 9px",
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ ...monoLabel, fontSize: 7.5, color: BRAND.textMuted, whiteSpace: "nowrap" }}>
              Position{positions.length > 1 ? `s · ${positions.length}` : ""}
            </span>
            {positions.slice(0, 3).map(({ m, bet }) => (
              <span key={m.address.toBase58()} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontFamily: UI_FONT, fontSize: 10, fontWeight: 600, color: BRAND.text, whiteSpace: "nowrap" }}>
                  {m.sideLabels[bet!.side]}
                </span>
                <span style={{ ...monoData, fontSize: 12, fontWeight: 700, color: BRAND.lime }}>{bet!.amount.toFixed(0)}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {rail("left", leftSide)}
      {rail("right", rightSide)}
      {cornerPanel("left", leftSide)}
      {cornerPanel("right", rightSide)}
    </>
  );
}
