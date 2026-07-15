import React, { useState } from "react";
import type { Keypair } from "@solana/web3.js";
import { BetView, impliedOdds, MarketView } from "../chain/onside";
import { clockMinute, LiveScore, OddsLine, sp1x2 } from "../chain/live";
import { teamColors } from "./teamColors";
import { BRAND } from "./brand";

const C = {
  stroke: BRAND.stroke,
  cyan: BRAND.cyan,
  green: BRAND.lime,
  red: "#f87171",
  dim: BRAND.dim,
  ink: BRAND.ink,
  pitch: "rgba(20,80,40,0.35)",
};

const sideBtn: React.CSSProperties = {
  border: `1px solid ${C.stroke}`,
  borderRadius: 8,
  padding: "8px 6px",
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
  background: "rgba(255,255,255,0.06)",
  color: C.ink,
  textAlign: "center",
};

export interface MatchViewProps {
  fixtureId: number;
  title: { home: string; away: string };
  markets: MarketView[];
  bets: Map<string, BetView>;
  wallet: Keypair | null;
  busy: string | null;
  live?: LiveScore | null;
  spOdds?: OddsLine[] | null;
  onBet: (m: MarketView, side: number, stake: number) => void;
  onClaim: (m: MarketView) => void;
  onBack: () => void;
}

/**
 * Expanded match view — goal.live-style layout:
 *   top:    match result (1X2) + total-goals strip
 *   bottom: corners buttons, home corner left / away corner right
 * (players live on the screen-edge rails and the 🎯 tracked chips,
 *  not inside this panel)
 */
export function MatchView({
  title,
  markets,
  bets,
  wallet,
  busy,
  live,
  spOdds,
  onBet,
  onClaim,
  onBack,
}: MatchViewProps) {
  const [slip, setSlip] = useState<{ m: MarketView; side: number } | null>(null);
  const [stake, setStake] = useState(5);

  const matchResult = markets.find((m) => m.kind === "matchResult");
  const homeCorners = markets.find((m) => m.kind === "statOver" && m.statKey === 7);
  const awayCorners = markets.find((m) => m.kind === "statOver" && m.statKey === 8);

  const sp = sp1x2(spOdds ?? null);
  const started = !!live && live.phase > 1;
  const homeC = teamColors(title.home, "home");
  const awayC = teamColors(title.away, "away");

  const marketBtn = (m: MarketView | undefined, side: number, label: string, spPrice?: number, accent?: string) => {
    if (!m) {
      return (
        <div style={{ ...sideBtn, opacity: 0.35, cursor: "default" }}>
          <div>{label}</div>
          <div style={{ fontSize: 9.5, color: C.dim }}>soon</div>
        </div>
      );
    }
    const odds = impliedOdds(m, side);
    const my = bets.get(m.address.toBase58());
    const isOutcome = m.state === "settled" && m.outcome === side;
    const sel = slip?.m.address.equals(m.address) && slip.side === side;
    return (
      <button
        disabled={m.state !== "open" || !wallet}
        onClick={() => setSlip(sel ? null : { m, side })}
        style={{
          ...sideBtn,
          background: sel ? C.cyan : isOutcome ? "rgba(52,211,153,0.18)" : sideBtn.background,
          color: sel ? "#04222a" : isOutcome ? C.green : C.ink,
          borderColor: sel ? C.cyan : my?.side === side ? C.green : accent ?? C.stroke,
          opacity: m.state !== "open" && !isOutcome ? 0.55 : 1,
          width: "100%",
        }}
      >
        <div style={{ color: sel ? "#04222a" : isOutcome ? C.green : accent ?? C.ink }}>{label}</div>
        <div style={{ fontSize: 9.5, opacity: 0.85 }}>
          ${m.pools[side]?.toFixed(0) ?? 0}
          {odds ? ` · ${odds.toFixed(2)}x` : ""}
        </div>
        {spPrice !== undefined && (
          <div style={{ fontSize: 9, color: sel ? "#04222a" : C.cyan }}>
            SP {spPrice.toFixed(2)}
          </div>
        )}
      </button>
    );
  };

  const claimRow = (m: MarketView | undefined) => {
    if (!m) return null;
    const my = bets.get(m.address.toBase58());
    if (!my || m.state !== "settled") return null;
    const won = my.side === m.outcome;
    const claimable = won && !my.claimed && Date.now() / 1000 >= m.claimAfter;
    return (
      <div style={{ fontSize: 11, display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
        <span style={{ color: won ? C.green : C.red, fontWeight: 700 }}>
          {my.claimed ? "PAID" : won ? "WON" : "LOST"} (${my.amount.toFixed(2)})
        </span>
        {claimable && (
          <button
            onClick={() => onClaim(m)}
            disabled={busy === m.address.toBase58()}
            style={{ ...sideBtn, padding: "3px 10px", background: C.green, color: "#022" }}
          >
            {busy === m.address.toBase58() ? "…" : "CLAIM"}
          </button>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <button onClick={onBack} style={{ ...sideBtn, padding: "4px 10px" }}>←</button>
        <b style={{ fontSize: 14 }}>
          <span style={{ color: homeC.accent }}>{title.home}</span>{" "}
          {started ? (
            <span style={{ color: live.final ? C.ink : C.green }}>
              {live.score.home}–{live.score.away}
            </span>
          ) : (
            <span style={{ color: C.dim }}>vs</span>
          )}{" "}
          <span style={{ color: awayC.accent }}>{title.away}</span>
        </b>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 10,
            color: started && !live.final ? C.green : C.dim,
            textTransform: "uppercase",
            fontWeight: started ? 700 : 400,
          }}
        >
          {started
            ? `${live.phaseLabel}${!live.final && live.clock.running ? ` ${clockMinute(live)}` : ""}`
            : matchResult?.state ?? ""}
        </span>
      </div>

      {/* top: match result + totals strip */}
      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ flex: 1 }}>{marketBtn(matchResult, 0, title.home, sp?.[0], homeC.accent)}</div>
        <div style={{ flex: 1 }}>{marketBtn(matchResult, 1, "Draw", sp?.[1])}</div>
        <div style={{ flex: 1 }}>{marketBtn(matchResult, 2, title.away, sp?.[2], awayC.accent)}</div>
      </div>
      {sp && (
        <div style={{ fontSize: 9, color: C.dim, marginTop: 3, textAlign: "right" }}>
          SP = TxODDS StablePrice (demargined) · pools set your actual payout
        </div>
      )}
      {claimRow(matchResult)}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {["0", "1", "2", "3", "4", "5+"].map((g) => (
          <div key={g} style={{ ...sideBtn, flex: 1, opacity: 0.35, cursor: "default", padding: "5px 4px", fontSize: 11 }}>
            <div>{g} goals</div>
            <div style={{ fontSize: 9, color: C.dim }}>soon</div>
          </div>
        ))}
      </div>

      {/* bottom: corners left / right */}
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: C.dim, marginBottom: 3 }}>
            <span style={{ color: homeC.accent }}>⚑ {title.home}</span> corners over {homeCorners ? `${homeCorners.threshold}.5` : ""}
            {started && (
              <b style={{ color: C.green }}> · now {live.corners.home}</b>
            )}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{ flex: 1 }}>{marketBtn(homeCorners, 0, "Over")}</div>
            <div style={{ flex: 1 }}>{marketBtn(homeCorners, 1, "Under")}</div>
          </div>
          {claimRow(homeCorners)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: C.dim, marginBottom: 3, textAlign: "right" }}>
            {started && (
              <b style={{ color: C.green }}>now {live.corners.away} · </b>
            )}
            <span style={{ color: awayC.accent }}>{title.away} ⚑</span> corners {awayCorners ? `over ${awayCorners.threshold}.5` : ""}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{ flex: 1 }}>{marketBtn(awayCorners, 0, "Over")}</div>
            <div style={{ flex: 1 }}>{marketBtn(awayCorners, 1, "Under")}</div>
          </div>
          {claimRow(awayCorners)}
        </div>
      </div>

      {/* bet slip */}
      {slip && slip.m.state === "open" && (
        <div
          style={{
            marginTop: 10,
            display: "flex",
            gap: 6,
            alignItems: "center",
            background: "rgba(34,211,238,0.08)",
            border: `1px solid ${C.cyan}`,
            borderRadius: 10,
            padding: 8,
          }}
        >
          <span style={{ fontSize: 11.5, color: C.dim }}>
            {slip.m.kindLabel} · <b style={{ color: C.ink }}>{slip.m.sideLabels[slip.side]}</b>
          </span>
          {[1, 5, 10, 25].map((v) => (
            <button
              key={v}
              onClick={() => setStake(v)}
              style={{
                ...sideBtn,
                padding: "4px 8px",
                background: stake === v ? C.cyan : "rgba(255,255,255,0.06)",
                color: stake === v ? "#04222a" : C.ink,
              }}
            >
              ${v}
            </button>
          ))}
          <button
            onClick={() => {
              onBet(slip.m, slip.side, stake);
              setSlip(null);
            }}
            disabled={busy === "bet"}
            style={{ ...sideBtn, marginLeft: "auto", background: C.green, color: "#022" }}
          >
            {busy === "bet" ? "…" : "PLACE BET"}
          </button>
        </div>
      )}
    </div>
  );
}
