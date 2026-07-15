import React from "react";
import type { Pin } from "../types";

function shortName(full: string): string {
  return full.includes(",") ? full.split(",")[0].trim() : full.split(" ").at(-1) ?? full;
}

const TEAM_COLOR: Record<string, string> = { home: "#22d3ee", away: "#f0abfc" };

/**
 * A chip anchored at a normalized position inside the video-content layer.
 * Positioned with percentages so the layer's rAF box-sync moves it for free.
 */
export function PlayerChip(props: {
  pin: Pin;
  selected: boolean;
  /** this pin is the current next-scorer pick — render it green */
  scorer?: boolean;
  /** kit-color accent for the assigned team (falls back to cyan/pink) */
  accent?: string;
  onClick: () => void;
}) {
  const { pin } = props;
  const color = props.scorer
    ? "#34d399"
    : pin.assignment
      ? props.accent ?? TEAM_COLOR[pin.assignment.team]
      : "#eaf2f7";
  return (
    <div
      style={{
        position: "absolute",
        left: `${pin.u * 100}%`,
        top: `${pin.v * 100}%`,
        transform: "translate(-50%, -100%)",
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        zIndex: props.selected ? 3 : 2,
      }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          props.onClick();
        }}
        style={{
          pointerEvents: "auto",
          cursor: "pointer",
          border: `1.5px solid ${color}`,
          background: props.selected ? color : "rgba(6,14,20,0.85)",
          color: props.selected ? "#04222a" : color,
          borderRadius: 999,
          padding: "3px 9px",
          fontSize: 11,
          fontWeight: 800,
          fontFamily: "system-ui, sans-serif",
          whiteSpace: "nowrap",
          boxShadow: props.scorer ? "0 0 10px rgba(52,211,153,0.7)" : "0 2px 8px rgba(0,0,0,0.6)",
        }}
      >
        {props.scorer ? "⚽ " : ""}
        {pin.assignment ? `${pin.assignment.n} · ${shortName(pin.assignment.name)}` : props.scorer ? "next scorer" : "＋ assign"}
      </button>
      {/* pointer stem + anchor dot */}
      <div style={{ width: 1.5, height: 7, background: color, opacity: 0.9 }} />
      <div
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          background: color,
          boxShadow: "0 0 6px rgba(0,0,0,0.8)",
        }}
      />
    </div>
  );
}
