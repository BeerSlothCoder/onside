import React, { useState } from "react";
import type { Keypair } from "@solana/web3.js";
import { BetView, impliedOdds, MarketView } from "../chain/onside";
import { Goalscorer, LiveScore, OddsLine, sp1x2, spTotalGoals, surnameKey } from "../chain/live";
import type { Rect } from "../tracking/geometry";
import { teamColors, type TeamColors } from "./teamColors";
import { BRAND, MONO_FONT, UI_FONT, monoData, monoLabel } from "./brand";

/**
 * The board rendered ON the stream, goal.live-style, per the Onside style guide.
 * Each side is ONE full-height column: team name at the top, players stretched
 * to fill, in-play props (fullscreen only), corners pinned at the bottom.
 *   top strip — match result (large) + total goals, live timer/score, ⇄ sides
 * Cyan = act or live. Lime = selected or resolved. Dark green frames the stream.
 */

const RAIL_MIN = 116;
const RAIL_MAX = 158;

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
  hideRails?: boolean;
  /** fullscreen: show the extra in-play micro-markets in the rail gap */
  isFs?: boolean;
  onBet: (m: MarketView, side: number, stake: number) => void;
  onTapPlayer: (p: Player) => void;
}

/** Simulated in-play micro-markets (no on-chain settlement yet) — the roadmap
 *  for event-level markets as TxLINE signed data expands. */
const IN_PLAY_PROPS: { key: string; label: string; odds: number }[] = [
  { key: "sot", label: "Next shot on target", odds: 2.1 },
  { key: "g10", label: "Goal in next 10′", odds: 3.4 },
  { key: "cor", label: "Next corner", odds: 1.85 },
  { key: "card", label: "Card in next 10′", odds: 4.2 },
];

export function StreamBoard(props: Props) {
  const { rect } = props;
  const [sel, setSel] = useState<{ m: MarketView; side: number; label: string } | null>(null);
  const [stake, setStake] = useState(5);
  const [swapped, setSwapped] = useState(false);
  const [scorer, setScorer] = useState<{ side: Side; n: string; name: string } | null>(null);
  const [pickedProps, setPickedProps] = useState<Set<string>>(new Set());

  const matchResult = props.markets.find((m) => m.kind === "matchResult");
  const homeCorners = props.markets.find((m) => m.kind === "statOver" && m.statKey === 7);
  const awayCorners = props.markets.find((m) => m.kind === "statOver" && m.statKey === 8);
  const totalGoals = props.markets.find((m) => m.kind === "statOver" && m.statKey === 1);
  const sp = sp1x2(props.spOdds ?? null);
  const tg = spTotalGoals(props.spOdds ?? null);
  const started = !!props.live && props.live.phase > 1;

  const colorOf = (s: Side) => teamColors(props.teams[s], s);
  const cornersOf = (s: Side) => (s === "home" ? homeCorners : awayCorners);
  const leftSide: Side = swapped ? "away" : "home";
  const rightSide: Side = swapped ? "home" : "away";

  const pct = window.innerWidth < 1400 ? 0.14 : 0.115;
  const railW = Math.round(Math.min(RAIL_MAX, Math.max(RAIL_MIN, rect.width * pct)));
  const railX = (pos: "left" | "right") => {
    const leftBar = rect.left;
    const rightBar = window.innerWidth - (rect.left + rect.width);
    const flank = leftBar >= railW + 4 && rightBar >= railW + 4;
    const inset = 6;
    return pos === "left"
      ? flank
        ? rect.left - railW - 4
        : rect.left + inset
      : flank
        ? rect.left + rect.width + 4
        : rect.left + rect.width - railW - inset;
  };

  const panel: React.CSSProperties = {
    background: BRAND.panel,
    border: `1px solid ${BRAND.border}`,
    fontFamily: UI_FONT,
    pointerEvents: "auto",
  };

  /** A market outcome cell. `big` = top strip; `bg` = team-tinted (corners). */
  const cell = (
    m: MarketView | undefined,
    side: number,
    label: string,
    opts: { accent?: string; spPrice?: number; big?: boolean; bg?: string } = {}
  ) => {
    const { accent, spPrice, big, bg } = opts;
    if (!m) {
      return (
        <span style={{ ...monoLabel, padding: big ? "0 12px" : "0 8px", fontSize: big ? 8.5 : 7, color: BRAND.textMuted, whiteSpace: "nowrap", alignSelf: "center" }}>
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
    const rest = picked ? BRAND.lime : bg ? `${bg}26` : "transparent";
    return (
      <button
        disabled={!open}
        onClick={() => setSel(picked ? null : { m, side, label })}
        title={m.state !== "open" ? `market ${m.state}` : `pool $${m.pools[side]?.toFixed(0) ?? 0}`}
        style={{
          flex: big ? undefined : 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: big ? 3 : 2,
          minWidth: big ? 76 : 0,
          padding: big ? "6px 13px" : "4px 6px",
          border: "none",
          borderRight: `1px solid ${BRAND.border}`,
          background: rest,
          color: picked ? BRAND.bg : BRAND.text,
          cursor: open ? "pointer" : "default",
          opacity: !open && !resolved ? 0.45 : 1,
          fontFamily: UI_FONT,
        }}
        onMouseEnter={(e) => {
          if (open && !picked) e.currentTarget.style.background = bg ? `${bg}3e` : BRAND.surfaceHover;
        }}
        onMouseLeave={(e) => {
          if (!picked) e.currentTarget.style.background = rest;
        }}
      >
        <span style={{ ...monoLabel, fontSize: big ? 11 : 8.5, fontWeight: big ? 700 : 600, letterSpacing: big ? "0.06em" : "0.1em", color: picked ? BRAND.bg : accent ?? BRAND.textMuted, whiteSpace: "nowrap", maxWidth: big ? 140 : 60, overflow: "hidden", textOverflow: "ellipsis" }}>
          {label}
          {resolved ? " ✓" : ""}
        </span>
        <span style={{ ...monoData, fontSize: big ? 15 : 13, fontWeight: 700, color: picked ? BRAND.bg : limeState ? BRAND.lime : BRAND.text, whiteSpace: "nowrap" }}>
          {spPrice !== undefined ? spPrice.toFixed(2) : odds ? `${odds.toFixed(2)}x` : "—"}
        </span>
      </button>
    );
  };

  /** Single floating confirm bar (under the top strip) for any selected market. */
  const confirmBar = sel && sel.m.state === "open" && (
    <div style={{ ...panel, display: "flex", alignItems: "center", gap: 6, borderRadius: BRAND.radiusControl, padding: "6px 8px", marginTop: 6 }}>
      <span style={{ ...monoLabel, fontSize: 7.5, color: BRAND.textMuted, whiteSpace: "nowrap" }}>{sel.label}</span>
      {[1, 5, 10, 25].map((v) => {
        const onSel = stake === v;
        return (
          <button
            key={v}
            onClick={() => setStake(v)}
            style={{ ...monoData, background: onSel ? BRAND.lime : "transparent", color: onSel ? BRAND.bg : BRAND.text, border: `1px solid ${onSel ? BRAND.lime : BRAND.border}`, borderRadius: BRAND.radiusControl, padding: "4px 8px", fontSize: 11, fontWeight: onSel ? 700 : 600, cursor: "pointer" }}
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
        style={{ background: BRAND.cyan, color: BRAND.bg, border: `1px solid ${BRAND.cyan}`, borderRadius: BRAND.radiusControl, height: 30, padding: "0 14px", fontFamily: UI_FONT, fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: props.busy === "bet" ? 0.4 : 1, whiteSpace: "nowrap" }}
      >
        {props.busy === "bet" ? "SIGNING…" : "CONFIRM"}
      </button>
      <button
        onClick={() => setSel(null)}
        style={{ background: "transparent", color: BRAND.textMuted, border: `1px solid ${BRAND.border}`, borderRadius: BRAND.radiusControl, height: 30, padding: "0 8px", fontFamily: UI_FONT, fontSize: 12, cursor: "pointer" }}
      >
        ✕
      </button>
    </div>
  );

  /** One full-height column: header · players (fill) · props (fs) · corners. */
  const sideColumn = (pos: "left" | "right", side: Side) => {
    const colors: TeamColors = colorOf(side);
    const mirrored = pos === "right";
    const players: Player[] = props.lineups[side].length
      ? props.lineups[side]
      : Array.from({ length: 11 }, (_, i) => ({ n: String(i + 1), name: "" }));
    const m = cornersOf(side);
    const nowCount = started && props.live ? props.live.corners[side] : null;
    return (
      <div
        style={{
          ...panel,
          position: "absolute",
          left: railX(pos),
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
        {/* team header */}
        <div style={{ ...monoLabel, background: colors.badge, color: colors.badgeText, borderBottom: `1px solid ${BRAND.border}`, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", padding: "6px 6px", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 0 }}>
          {props.teams[side]}
        </div>

        {/* players — proportional share so rows stay a readable, even height */}
        <div style={{ flex: players.length, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {players.map((p, i) => {
            const gs = p.name ? props.goalscorers?.[surnameKey(p.name)] : undefined;
            const picked = scorer?.side === side && scorer?.n === p.n;
            return (
              <button
                key={i}
                onClick={() => {
                  const full = p.name || `Player ${p.n}`;
                  setScorer(picked ? null : { side, n: p.n, name: full });
                  props.onTapPlayer({ n: p.n, name: full });
                }}
                title="Tag as next goalscorer"
                style={{ flex: 1, minHeight: 20, maxHeight: 44, display: "flex", alignItems: "center", gap: 5, flexDirection: mirrored ? "row-reverse" : "row", border: "none", borderBottom: `1px solid ${BRAND.border}`, padding: "0 5px", background: picked ? BRAND.lime : BRAND.surface, cursor: "pointer", overflow: "hidden" }}
                onMouseEnter={(e) => {
                  if (!picked) e.currentTarget.style.background = BRAND.surfaceHover;
                }}
                onMouseLeave={(e) => {
                  if (!picked) e.currentTarget.style.background = BRAND.surface;
                }}
              >
                <span style={{ ...monoData, flexShrink: 0, width: 15, fontSize: 11, fontWeight: 600, color: picked ? BRAND.bg : BRAND.textMuted, textAlign: "center" }}>
                  {p.n}
                </span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: mirrored ? "flex-end" : "flex-start", lineHeight: 1.05 }}>
                  {gs && (
                    <span style={{ ...monoData, fontSize: 8.5, fontWeight: 700, color: picked ? BRAND.bg : BRAND.lime }}>
                      {picked ? "⚽ " : ""}
                      {gs.odds.toFixed(2)}
                    </span>
                  )}
                  <span style={{ fontFamily: UI_FONT, fontSize: 10, fontWeight: 600, letterSpacing: "-0.01em", color: picked ? BRAND.bg : BRAND.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                    {p.name ? shortName(p.name) : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* in-play props — fullscreen only, proportional height */}
        {props.isFs && (
          <div style={{ flex: IN_PLAY_PROPS.length + 1, minHeight: 0, display: "flex", flexDirection: "column", borderTop: `2px solid ${colors.accent}` }}>
            <div style={{ ...monoLabel, fontSize: 7.5, color: BRAND.textMuted, padding: "3px 7px", borderBottom: `1px solid ${BRAND.border}`, whiteSpace: "nowrap", flexShrink: 0 }}>
              in-play · sim
            </div>
            {IN_PLAY_PROPS.map((pr) => {
              const on = pickedProps.has(`${side}:${pr.key}`);
              return (
                <button
                  key={pr.key}
                  onClick={() =>
                    setPickedProps((s) => {
                      const n = new Set(s);
                      const id = `${side}:${pr.key}`;
                      n.has(id) ? n.delete(id) : n.add(id);
                      return n;
                    })
                  }
                  title="Simulated in-play market (display only)"
                  style={{ flex: 1, minHeight: 26, maxHeight: 46, width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, padding: "0 8px", border: "none", borderBottom: `1px solid ${BRAND.border}`, background: on ? BRAND.lime : `${colors.accent}18`, cursor: "pointer", overflow: "hidden" }}
                  onMouseEnter={(e) => {
                    if (!on) e.currentTarget.style.background = `${colors.accent}30`;
                  }}
                  onMouseLeave={(e) => {
                    if (!on) e.currentTarget.style.background = `${colors.accent}18`;
                  }}
                >
                  <span style={{ fontFamily: UI_FONT, fontSize: 10, fontWeight: 600, color: on ? BRAND.bg : BRAND.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {pr.label}
                  </span>
                  <span style={{ ...monoData, flexShrink: 0, fontSize: 12, fontWeight: 700, color: on ? BRAND.bg : BRAND.cyan }}>
                    {pr.odds.toFixed(2)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* corners — pinned at the bottom, proportional height */}
        <div style={{ flex: 3, minHeight: 0, display: "flex", flexDirection: "column", borderTop: `2px solid ${colors.accent}` }}>
          <div style={{ ...monoLabel, fontSize: 8.5, fontWeight: 700, color: colors.accent, padding: "5px 6px", borderBottom: `1px solid ${BRAND.border}`, whiteSpace: "nowrap", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 0 }}>
            ⚑ corners o{m ? `${m.threshold}.5` : ""}
            {nowCount !== null ? ` · ${nowCount}` : ""}
          </div>
          <div style={{ display: "flex", flex: 1, minHeight: 40, alignItems: "stretch" }}>
            {cell(m, 0, "Over", { accent: colors.accent, bg: colors.accent })}
            {cell(m, 1, "Under", { accent: colors.accent, bg: colors.accent })}
          </div>
        </div>
      </div>
    );
  };

  const positions = props.markets.map((m) => ({ m, bet: props.bets.get(m.address.toBase58()) })).filter((x) => x.bet);

  return (
    <>
      {/* TOP STRIP — match result (large) + total goals + change sides */}
      <div style={{ position: "absolute", left: rect.left + rect.width / 2, top: rect.top + 8, transform: "translateX(-50%)", zIndex: 2147483646, display: "flex", flexDirection: "column", alignItems: "center", pointerEvents: "none" }}>
        <div style={{ ...panel, display: "flex", alignItems: "stretch", minHeight: 46, borderRadius: BRAND.radiusControl, overflow: "hidden" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5, padding: "0 11px", borderRight: `1px solid ${BRAND.border}` }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: started && !props.live?.final ? BRAND.cyan : BRAND.textMuted, flexShrink: 0 }} />
            <span style={{ ...monoData, fontSize: 11, fontWeight: 700, color: BRAND.cyan, whiteSpace: "nowrap" }}>
              {started && props.live
                ? `${props.live.phaseLabel}${props.live.clock.running ? ` ${Math.min(Math.floor(props.live.clock.seconds / 60) + 1, 120)}'` : ""}`
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
          <span style={{ ...monoLabel, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", lineHeight: 1.15, fontSize: 8, color: BRAND.textMuted, padding: "0 8px", borderRight: `1px solid ${BRAND.border}`, whiteSpace: "nowrap" }}>
            <span>goals</span>
            <span>o{totalGoals ? `${totalGoals.threshold}.5` : tg ? tg.line : "2.5"}</span>
          </span>
          {cell(totalGoals, 0, "Over", { spPrice: tg?.over, big: true })}
          {cell(totalGoals, 1, "Under", { spPrice: tg?.under, big: true })}
          <button
            onClick={() => setSwapped((s) => !s)}
            title="Swap sides (teams change ends at half time)"
            style={{ ...monoLabel, pointerEvents: "auto", border: "none", borderLeft: `1px solid ${BRAND.border}`, background: swapped ? BRAND.surfaceHover : "transparent", color: BRAND.cyan, fontSize: 13, padding: "0 11px", cursor: "pointer" }}
          >
            ⇄
          </button>
        </div>
        {confirmBar}
        {(scorer || positions.length > 0) && (
          <div style={{ ...panel, border: `1px solid ${BRAND.lime}`, borderRadius: BRAND.radiusControl, boxShadow: "0 6px 18px rgba(0,0,0,0.55)", padding: "4px 9px", marginTop: 6, display: "flex", alignItems: "center", gap: 10 }}>
            {scorer && (
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ ...monoLabel, fontSize: 7.5, color: BRAND.textMuted }}>⚽ next scorer</span>
                <span style={{ fontFamily: UI_FONT, fontSize: 11, fontWeight: 700, color: BRAND.lime }}>
                  {scorer.n} {shortName(scorer.name)}
                </span>
              </span>
            )}
            {positions.slice(0, 3).map(({ m, bet }) => (
              <span key={m.address.toBase58()} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontFamily: UI_FONT, fontSize: 10, fontWeight: 600, color: BRAND.text, whiteSpace: "nowrap" }}>{m.sideLabels[bet!.side]}</span>
                <span style={{ ...monoData, fontSize: 12, fontWeight: 700, color: BRAND.lime }}>{bet!.amount.toFixed(0)}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {!props.hideRails && (
        <>
          {sideColumn("left", leftSide)}
          {sideColumn("right", rightSide)}
        </>
      )}
    </>
  );
}
