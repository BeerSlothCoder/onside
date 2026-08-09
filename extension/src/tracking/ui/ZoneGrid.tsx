import React from "react";
import type { Rect } from "../geometry";
import { BRAND } from "../../overlay/brand";

/**
 * A visible grid of clickable pitch zones, in the same normalized
 * video-content coordinate space as the player tracker/pins (see
 * ../geometry.ts). Adapted from an earlier goal.live prototype
 * (VideoOverlayDebugGrid) that used a near-invisible grid purely as a
 * coordinate-probe/calibration tool — this version renders real, visible,
 * bettable zone tiles instead.
 */

export type ZoneCellState = "idle" | "pending" | "won" | "lost";

export interface ZoneBounds {
  row: number;
  col: number;
  key: string;
  /** Zone bounds in normalized (0..1) video-content coordinates. */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

interface ZoneGridProps {
  rect: Rect;
  rows?: number;
  cols?: number;
  /** Look up a cell's current state by its key — defaults to "idle". */
  cellState?: (key: string) => ZoneCellState | undefined;
  /** Seconds remaining, for a "pending" cell — drives the countdown label. */
  cellSecondsLeft?: (key: string) => number | undefined;
  onSelect: (zone: ZoneBounds) => void;
  disabled?: boolean;
}

const STATE_STYLE: Record<ZoneCellState, { border: string; fill: string }> = {
  idle: { border: "rgba(0,222,240,0.18)", fill: "rgba(0,222,240,0.02)" },
  pending: { border: BRAND.cyan, fill: "rgba(0,222,240,0.14)" },
  won: { border: BRAND.lime, fill: "rgba(188,241,59,0.22)" },
  lost: { border: BRAND.danger, fill: "rgba(222,59,61,0.16)" },
};

export function ZoneGrid({ rect, rows = 3, cols = 4, cellState, cellSecondsLeft, onSelect, disabled }: ZoneGridProps) {
  const cells: ZoneBounds[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({
        row,
        col,
        key: `r${row}-c${col}`,
        u0: col / cols,
        v0: row / rows,
        u1: (col + 1) / cols,
        v1: (row + 1) / rows,
      });
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        zIndex: 2147483644,
        display: "grid",
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        pointerEvents: disabled ? "none" : "auto",
      }}
    >
      {cells.map((cell) => {
        const state = cellState?.(cell.key) ?? "idle";
        const style = STATE_STYLE[state];
        const secondsLeft = state === "pending" ? cellSecondsLeft?.(cell.key) : undefined;
        return (
          <button
            key={cell.key}
            type="button"
            onClick={() => onSelect(cell)}
            disabled={disabled || state === "pending"}
            style={{
              border: `1px solid ${style.border}`,
              background: style.fill,
              color: BRAND.text,
              cursor: disabled || state === "pending" ? "default" : "pointer",
              fontFamily: "SFMono-Regular, Consolas, monospace",
              fontSize: 12,
              fontWeight: 800,
              padding: 0,
              transition: "background 0.15s ease, border-color 0.15s ease",
            }}
            onMouseEnter={(e) => {
              if (state === "idle" && !disabled) e.currentTarget.style.background = "rgba(0,222,240,0.08)";
            }}
            onMouseLeave={(e) => {
              if (state === "idle") e.currentTarget.style.background = style.fill;
            }}
          >
            {state === "pending" && secondsLeft !== undefined ? `${Math.ceil(secondsLeft)}s` : ""}
            {state === "won" ? "✓" : ""}
            {state === "lost" ? "✕" : ""}
          </button>
        );
      })}
    </div>
  );
}
