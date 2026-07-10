import React, { useState } from "react";
import type { Assignment, Lineups, Team } from "../types";

const C = {
  bg: "rgba(10,16,22,0.97)",
  stroke: "rgba(255,255,255,0.14)",
  cyan: "#22d3ee",
  pink: "#f0abfc",
  dim: "#8aa0af",
  ink: "#eaf2f7",
  red: "#f87171",
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
  taken: Set<string>; // "team:n" pairs already assigned elsewhere
  removeLabel?: string;
  onAssign: (a: Assignment) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [picking, setPicking] = useState(!props.assignment);
  const a = props.assignment;

  const column = (team: Team) => {
    const players = props.lineups[team].length ? props.lineups[team] : PLACEHOLDER_XI;
    const color = team === "home" ? C.cyan : C.pink;
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
                background: "rgba(255,255,255,0.05)",
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
    borderRadius: 7,
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
    background: "rgba(255,255,255,0.06)",
    color: C.ink,
  };

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
        fontFamily: "system-ui, sans-serif",
        color: C.ink,
        boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
      }}
    >
      {picking || !a ? (
        <>
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 6 }}>
            Who is this? <span style={{ float: "right", cursor: "pointer" }} onClick={props.onClose}>✕</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {column("home")}
            {column("away")}
          </div>
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
            <span style={{ fontSize: 10.5, color: a.team === "home" ? C.cyan : C.pink, fontWeight: 700 }}>
              {props.teams[a.team]}
            </span>
            <span style={{ marginLeft: "auto", cursor: "pointer", color: C.dim }} onClick={props.onClose}>
              ✕
            </span>
          </div>
          <div style={{ fontSize: 10.5, color: C.dim, margin: "6px 0 8px", lineHeight: 1.45 }}>
            Player markets need player-level on-chain proofs — display only for now.
          </div>
          <button disabled style={{ ...btn, width: "100%", opacity: 0.4, cursor: "default" }}>
            Player markets — soon
          </button>
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
