import React, { useState } from "react";
import type { Assignment, Lineups, Team } from "../types";
import { BRAND, UI_FONT } from "../../overlay/brand";

const C = {
  bg: BRAND.panel,
  stroke: BRAND.border,
  cyan: BRAND.cyan,
  pink: BRAND.cyan, // no pink in the system — away also reads cyan when no kit
  green: BRAND.lime,
  dim: BRAND.textMuted,
  ink: BRAND.text,
  red: BRAND.danger,
};

function shortName(full: string): string {
  return full.includes(",") ? full.split(",")[0].trim() : full.split(" ").at(-1) ?? full;
}

const PLACEHOLDER_XI = Array.from({ length: 11 }, (_, i) => ({
  n: String(i + 1),
  name: `Player ${i + 1}`,
}));

/**
 * Popover anchored at a normalized position (works for pins AND tracked
 * players). Two views:
 *  - unassigned → home/away lineup picker
 *  - assigned   → player card with reassign / remove
 */
export function AssignPopover(props: {
  u: number;
  v: number;
  assignment: Assignment | null;
  lineups: Lineups;
  teams: { home: string; away: string };
  /** kit-color accents per side (falls back to cyan/pink) */
  accents?: { home: string; away: string };
  taken: Set<string>; // "team:n" pairs already assigned elsewhere
  /** assignments whose track died (player left the shot) — quick re-tag row */
  parked?: Assignment[];
  removeLabel?: string;
  /** is this player the current next-scorer pick */
  scorer?: boolean;
  /** toggle the next-scorer pick on this player (demo market) */
  onScorer?: () => void;
  onAssign: (a: Assignment) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [picking, setPicking] = useState(!props.assignment);
  const a = props.assignment;
  const teamColor = (team: Team) =>
    props.accents?.[team] ?? (team === "home" ? C.cyan : C.pink);

  const column = (team: Team) => {
    const players = props.lineups[team].length ? props.lineups[team] : PLACEHOLDER_XI;
    const color = teamColor(team);
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 800,
            color,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            marginBottom: 4,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {props.teams[team]}
        </div>
        {players.map((p) => {
          const takenElsewhere = props.taken.has(`${team}:${p.n}`);
          return (
            <button
              key={p.n}
              disabled={takenElsewhere}
              onClick={() => props.onAssign({ team, n: p.n, name: p.name })}
              style={{
                display: "block",
                width: "100%",
                marginBottom: 3,
                border: `1px solid ${C.stroke}`,
                borderRadius: 6,
                padding: "3px 6px",
                fontSize: 10.5,
                fontWeight: 700,
                background: BRAND.surface,
                color: takenElsewhere ? C.dim : C.ink,
                opacity: takenElsewhere ? 0.4 : 1,
                cursor: takenElsewhere ? "default" : "pointer",
                textAlign: "left",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {p.n} · {shortName(p.name)}
            </button>
          );
        })}
      </div>
    );
  };

  const btn: React.CSSProperties = {
    border: `1px solid ${C.stroke}`,
    borderRadius: BRAND.radiusControl,
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
    background: BRAND.surface,
    color: C.ink,
  };

  const scorerBtn = props.onScorer && (
    <button
      onClick={props.onScorer}
      style={{
        ...btn,
        width: "100%",
        border: `1px solid ${C.green}`,
        background: props.scorer ? C.green : BRAND.surface,
        color: props.scorer ? BRAND.bg : C.green,
      }}
    >
      {props.scorer ? "⚽ Remove next-scorer pick" : "⚽ Pick as next scorer"}
    </button>
  );

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: `${Math.min(Math.max(props.u * 100, 12), 88)}%`,
        top: `${Math.min(props.v * 100, 90)}%`,
        transform: "translate(-50%, 12px)",
        width: 280,
        maxHeight: 300,
        overflowY: "auto",
        pointerEvents: "auto",
        background: C.bg,
        border: `1px solid ${C.stroke}`,
        borderRadius: 12,
        padding: 10,
        zIndex: 5,
        fontFamily: UI_FONT,
        color: C.ink,
        boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
      }}
    >
      {picking || !a ? (
        <>
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 6 }}>
            Who is this? <span style={{ float: "right", cursor: "pointer" }} onClick={props.onClose}>✕</span>
          </div>
          {props.parked && props.parked.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9.5, color: C.dim, marginBottom: 4 }}>Re-tag (lost from view):</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {props.parked.map((p) => (
                  <button
                    key={`${p.team}:${p.n}`}
                    onClick={() => props.onAssign(p)}
                    style={{
                      ...btn,
                      padding: "3px 8px",
                      fontSize: 10.5,
                      borderColor: teamColor(p.team),
                      color: teamColor(p.team),
                    }}
                  >
                    {p.n} · {shortName(p.name)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            {column("home")}
            {column("away")}
          </div>
          {scorerBtn && <div style={{ marginTop: 8 }}>{scorerBtn}</div>}
          <button onClick={props.onRemove} style={{ ...btn, marginTop: 8, color: C.red, width: "100%" }}>
            {props.removeLabel ?? "Remove pin"}
          </button>
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <b style={{ fontSize: 15 }}>
              {a.n} · {shortName(a.name)}
            </b>
            <span style={{ fontSize: 10.5, color: teamColor(a.team), fontWeight: 700 }}>
              {props.teams[a.team]}
            </span>
            <span style={{ marginLeft: "auto", cursor: "pointer", color: C.dim }} onClick={props.onClose}>
              ✕
            </span>
          </div>
          <div style={{ fontSize: 10.5, color: C.dim, margin: "6px 0 8px", lineHeight: 1.45 }}>
            Next-scorer is a demo market — settlement needs player-level
            on-chain proofs (TxLINE roadmap), so the pick is display-only.
          </div>
          {scorerBtn ?? (
            <button disabled style={{ ...btn, width: "100%", opacity: 0.4, cursor: "default" }}>
              Player markets — soon
            </button>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button onClick={() => setPicking(true)} style={{ ...btn, flex: 1 }}>
              Reassign
            </button>
            <button onClick={props.onRemove} style={{ ...btn, flex: 1, color: C.red }}>
              {props.removeLabel ?? "Remove pin"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
