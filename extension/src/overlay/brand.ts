import type React from "react";

/**
 * Onside brand palette (from the onside-logo v1 kit + seed deck).
 * Dark green-black surfaces, cyan primary, lime "played live" accent.
 * Team kit colors live in teamColors.ts; the ⚽ scorer pick stays emerald.
 */
export const BRAND = {
  cyan: "#22d3ee",
  lime: "#9be15d", // brand "played live" green / highlights
  ink: "#eaf6f2",
  dim: "#7f978f",
  scorer: "#34d399",
  // glass surfaces
  bar: "rgba(9,18,15,0.82)",
  glass: "rgba(9,18,15,0.72)",
  stroke: "rgba(255,255,255,0.14)",
  strokeStrong: "rgba(155,225,93,0.35)",
} as const;

/** Mono label style used across the brand (uppercase, tracked). */
export const monoLabel: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  textTransform: "uppercase",
  letterSpacing: 1,
};
