import React, { useState } from "react";
import type { Keypair } from "@solana/web3.js";
import { BetView, impliedOdds, MarketView } from "../chain/onside";
import { Goalscorer, LiveScore, OddsLine, sp1x2, spTotalGoals, surnameKey } from "../chain/live";
import type { Rect } from "../tracking/geometry";
import { teamColors, type TeamColors } from "./teamColors";
import { BRAND, MONO_FONT, UI_FONT, monoData, monoLabel } from "./brand";

/**
 * The board rendered ON the stream, per the Onside style guide:
 *   top market strip — live timer/score + match result
 *   bottom strip     — corners (live counts) + total goals
 *   position slip    — confirmed positions, bottom centre, lime border
 *   player rails     — full-height columns at the video edges (14% per side)
 *
 * Cyan = act or live. Lime = selected or resolved. Dark green frames the stream.
 * No glassmorphism; panels are solid canvas at 95%. Shadows only on rails + slip.
 */

const RAIL_MIN = 128;
const RAIL_MAX = 190;

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
  const [sel, setSel] = useState<{ m: MarketView; side: number; label: string } | null>(null);
  const [stake, setStake] = useState(5);

  const matchResult = props.markets.find((m) => m.kind === "matchResult");
  const homeCorners = props.markets.find((m) => m.kind === "statOver" && m.statKey === 7);
  const awayCorners = props.markets.find((m) => m.kind === "statOver" && m.statKey === 8);
  const totalGoals = props.markets.find((m) => m.kind === "statOver" && m.statKey === 1);
  const sp = sp1x2(props.spOdds ?? null);
  const tg = spTotalGoals(props.spOdds ?? null);
  const started = !!props.live && props.live.phase > 1;

  /** Dark overlay panel — solid canvas at 95%, thin technical border. */
  const panel: React.CSSProperties = {
    background: BRAND.panel,
    border: `1px solid ${BRAND.border}`,
    fontFamily: UI_FONT,
    pointerEvents: "auto",
  };

  /** One market outcome as a strip cell: label above, quote below (data font). */
  const cell = (
    m: MarketView | undefined,
    side: number,
    label: string,
    accent?: string,
    spPrice?: number
  ) => {
    if (!m) {
      return (
        <span
          style={{
            ...monoLabel,
            padding: "0 10px",
            fontSize: 7.5,
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
    // lime only for the rare states: your selection, your position, the resolved outcome
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
          gap: 2,
          minWidth: 62,
          padding: "4px 10px",
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
            fontSize: 7.5,
            color: picked ? BRAND.bg : accent ?? BRAND.textMuted,
            whiteSpace: "nowrap",
            maxWidth: 90,
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
            fontSize: 10,
            fontWeight: 700,
            color: picked ? BRAND.bg : limeState ? BRAND.lime : BRAND.text,
            whiteSpace: "nowrap",
          }}
        >
          {spPrice !== undefined
            ? spPrice.toFixed(2)
            : odds
              ? `${odds.toFixed(2)}x`
              : "—"}
        </span>
      </button>
    );
  };

  /** Strip shell: min 40px, canvas at 95%, 1px dividers between cells. */
  const strip = (children: React.ReactNode) => (
    <div
      style={{
        ...panel,
        display: "flex",
        alignItems: "stretch",
        minHeight: 40,
        borderRadius: BRAND.radiusControl,
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );

  /** Stake selector + primary confirm — appears under the selected market. */
  const confirmBar = sel && sel.m.state === "open" && (
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
        const on = stake === v;
        return (
          <button
            key={v}
            onClick={() => setStake(v)}
            style={{
              ...monoData,
              background: on ? BRAND.lime : "transparent",
              color: on ? BRAND.bg : BRAND.text,
              border: `1px solid ${on ? BRAND.lime : BRAND.border}`,
              borderRadius: BRAND.radiusControl,
              padding: "4px 8px",
              fontSize: 11,
              fontWeight: on ? 700 : 600,
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
        onMouseEnter={(e) => (e.currentTarget.style.background = BRAND.cyanHover)}
        onMouseLeave={(e) => (e.currentTarget.style.background = BRAND.cyan)}
      >
        {props.busy === "bet" ? "SIGNING…" : "CONFIRM PREDICTION"}
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

  /** Current-position slip — compact status, lime border. */
  const positions = props.markets
    .map((m) => ({ m, bet: props.bets.get(m.address.toBase58()) }))
    .filter((x) => x.bet);
  const positionSlip = positions.length > 0 && (
    <div
      style={{
        ...panel,
        border: `1px solid ${BRAND.lime}`,
        borderRadius: BRAND.radiusControl,
        boxShadow: "0 6px 18px rgba(0,0,0,0.55)",
        padding: "5px 9px",
        marginTop: 6,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span style={{ ...monoLabel, fontSize: 8, color: BRAND.textMuted, whiteSpace: "nowrap" }}>
        Current position{positions.length > 1 ? `s · ${positions.length}` : ""}
      </span>
      {positions.slice(0, 3).map(({ m, bet }) => (
        <span key={m.address.toBase58()} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontFamily: UI_FONT, fontSize: 10, fontWeight: 600, color: BRAND.text, whiteSpace: "nowrap" }}>
            {m.sideLabels[bet!.side]}
          </span>
          <span style={{ ...monoData, fontSize: 12, fontWeight: 700, color: BRAND.lime }}>
            {bet!.amount.toFixed(0)}
          </span>
        </span>
      ))}
    </div>
  );

  /** Full-height player rail at one video edge (14% per side, 18% small screens). */
  const rail = (side: "home" | "away") => {
    const colors: TeamColors = side === "home" ? homeC : awayC;
    const mirrored = side === "away";
    const players: Player[] = props.lineups[side].length
      ? props.lineups[side]
      : Array.from({ length: 11 }, (_, i) => ({ n: String(i + 1), name: "" }));
    const pct = window.innerWidth < 1400 ? 0.18 : 0.14;
    const railW = Math.round(Math.min(RAIL_MAX, Math.max(RAIL_MIN, rect.width * pct)));
    // Flank the letterbox bars when there's room; otherwise tuck just inside the
    // video edge (fullscreen). Same rule both sides → always symmetric.
    const inset = 6;
    const leftBar = rect.left;
    const rightBar = window.innerWidth - (rect.left + rect.width);
    const flank = leftBar >= railW + 4 && rightBar >= railW + 4;
    const x =
      side === "home"
        ? flank
          ? rect.left - railW - 4
          : rect.left + inset
        : flank
          ? rect.left + rect.width + 4
          : rect.left + rect.width - railW - inset;
    const rowH = Math.min(40, Math.max(22, (rect.height - 30) / players.length - 2));
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
        {/* team header — the one place kit colour carries team identity */}
        <div
          style={{
            ...monoLabel,
            background: colors.badge,
            color: colors.badgeText,
            borderBottom: `1px solid ${BRAND.border}`,
            fontSize: 9,
            fontWeight: 700,
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
                  gap: 6,
                  flexDirection: mirrored ? "row-reverse" : "row",
                  height: rowH,
                  border: "none",
                  borderBottom: `1px solid ${BRAND.border}`,
                  padding: "0 6px",
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
                    width: 16,
                    fontSize: 12,
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
                    fontFamily: UI_FONT,
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "-0.01em",
                    color: BRAND.text,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    textAlign: mirrored ? "right" : "left",
                  }}
                >
                  {p.name ? shortName(p.name) : ""}
                </span>
                {gs && (
                  <span
                    title={`${gs.name} — anytime goalscorer quote`}
                    style={{ ...monoData, flexShrink: 0, fontSize: 9, color: BRAND.lime }}
                  >
                    {gs.odds.toFixed(2)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* TOP MARKET STRIP — live state + match result */}
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
        {strip(
          <>
            {/* live cell: cyan dot + timer (cyan = live) */}
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "0 10px",
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
              <span style={{ ...monoData, fontSize: 10, fontWeight: 700, color: BRAND.cyan, whiteSpace: "nowrap" }}>
                {started && props.live
                  ? `${props.live.phaseLabel}${
                      props.live.clock.running
                        ? ` ${Math.min(Math.floor(props.live.clock.seconds / 60) + 1, 120)}'`
                        : ""
                    }`
                  : "PRE"}
              </span>
              {started && props.live && (
                <span style={{ ...monoData, fontSize: 10, fontWeight: 700, color: BRAND.text }}>
                  {props.live.score.home}–{props.live.score.away}
                </span>
              )}
            </span>
            {cell(matchResult, 0, props.teams.home, homeC.accent, sp?.[0] ?? undefined)}
            {cell(matchResult, 1, "Draw", undefined, sp?.[1] ?? undefined)}
            {cell(matchResult, 2, props.teams.away, awayC.accent, sp?.[2] ?? undefined)}
          </>
        )}
        {sel?.m === matchResult && confirmBar}
      </div>

      {/* BOTTOM STRIP — corners + total goals, then position slip */}
      <div
        style={{
          position: "absolute",
          left: rect.left + rect.width / 2,
          top: rect.top + rect.height - 44,
          transform: "translate(-50%, -100%)",
          zIndex: 2147483646,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          pointerEvents: "none",
        }}
      >
        {strip(
          <>
            <span
              style={{
                ...monoLabel,
                display: "flex",
                alignItems: "center",
                fontSize: 7.5,
                color: BRAND.textMuted,
                padding: "0 8px",
                borderRight: `1px solid ${BRAND.border}`,
                whiteSpace: "nowrap",
              }}
            >
              {shortName(props.teams.home)} corners o{homeCorners ? `${homeCorners.threshold}.5` : ""}
              {started && props.live ? ` · ${props.live.corners.home}` : ""}
            </span>
            {cell(homeCorners, 0, "Over", homeC.accent)}
            {cell(homeCorners, 1, "Under", homeC.accent)}
            {cell(awayCorners, 0, "Over", awayC.accent)}
            {cell(awayCorners, 1, "Under", awayC.accent)}
            <span
              style={{
                ...monoLabel,
                display: "flex",
                alignItems: "center",
                fontSize: 7.5,
                color: BRAND.textMuted,
                padding: "0 8px",
                borderRight: `1px solid ${BRAND.border}`,
                whiteSpace: "nowrap",
              }}
            >
              {started && props.live ? `${props.live.corners.away} · ` : ""}
              {shortName(props.teams.away)} corners o{awayCorners ? `${awayCorners.threshold}.5` : ""}
            </span>
            <span
              style={{
                ...monoLabel,
                display: "flex",
                alignItems: "center",
                fontSize: 7.5,
                color: BRAND.textMuted,
                padding: "0 8px",
                borderRight: `1px solid ${BRAND.border}`,
                whiteSpace: "nowrap",
              }}
            >
              Goals o{totalGoals ? `${totalGoals.threshold}.5` : tg ? tg.line : "2.5"}
            </span>
            {cell(totalGoals, 0, "Over", undefined, tg?.over)}
            {cell(totalGoals, 1, "Under", undefined, tg?.under)}
          </>
        )}
        {sel && sel.m !== matchResult && confirmBar}
        {positionSlip}
      </div>

      {rail("home")}
      {rail("away")}
    </>
  );
}
