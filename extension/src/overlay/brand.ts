import type React from "react";

/**
 * Onside design system — taken from the Onside website style guide.
 *
 * Broadcast-dark + technical + live: the stream is the focus, the UI frames it.
 *   Cyan = act or live.  Lime = selected or resolved.  Dark green frames the stream.
 * Usage ratio: 75% canvas/stream · 15% dark-green surfaces+borders · 7% cyan · 3% lime.
 * Cyan and lime are never used equally — lime is the rare selection/confirmation colour.
 *
 * Avoid: glassmorphism, bright white borders, soft gradients behind controls, glow on
 * lime fills, and any casino/sportsbook language or imagery.
 */
export const BRAND = {
  bg: "#000502", // canvas + dark overlay panels
  surface: "#010E06", // cards, rails, controls, menus
  surfaceHover: "#03160B", // hovered rows, raised panels
  deepGreen: "#00391F", // subtle branded fills, depth
  border: "#183525", // dividers, outlines
  text: "#EDF4EF", // headlines, key values
  textMuted: "#9CADA1", // supporting copy, inactive labels
  cyan: "#00DEF0", // primary CTA, live state, focus, data highlight
  cyanHover: "#00D7EA",
  lime: "#BCF13B", // selected player, confirmed prediction
  danger: "#DE3B3D", // errors, unavailable market only
  radiusControl: 6,
  radiusCard: 12,
  /** Dark overlay panels sit at 95% opacity over the stream. */
  panel: "rgba(0,5,2,0.95)",
} as const;

/** Main UI font — headings 600–700 (-0.04em), body 400 (-0.01em). */
export const UI_FONT = "Arial, Helvetica, system-ui, sans-serif";

/** Data font — odds, timers, market IDs, player numbers, settlement data. */
export const MONO_FONT = 'SFMono-Regular, Consolas, "Liberation Mono", monospace';

/** Small uppercase interface label (data font, ~0.18em tracking). */
export const monoLabel: React.CSSProperties = {
  fontFamily: MONO_FONT,
  textTransform: "uppercase",
  letterSpacing: "0.18em",
};

/** Odds / multipliers / numbers — data font, tabular. */
export const monoData: React.CSSProperties = {
  fontFamily: MONO_FONT,
  fontVariantNumeric: "tabular-nums",
};

/** Primary action — one per view ("Confirm prediction", "Enter market"). */
export const primaryBtn: React.CSSProperties = {
  background: BRAND.cyan,
  color: BRAND.bg,
  border: `1px solid ${BRAND.cyan}`,
  borderRadius: BRAND.radiusControl,
  padding: "0 20px",
  height: 44,
  fontFamily: UI_FONT,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

/** Secondary action — cancel, back, filters. */
export const secondaryBtn: React.CSSProperties = {
  background: "transparent",
  color: BRAND.text,
  border: `1px solid ${BRAND.border}`,
  borderRadius: BRAND.radiusControl,
  fontFamily: UI_FONT,
  fontWeight: 600,
  cursor: "pointer",
};

/** Selected market / player / outcome — solid lime fill, no glow. */
export const selectedBtn: React.CSSProperties = {
  background: BRAND.lime,
  color: BRAND.bg,
  border: `1px solid ${BRAND.lime}`,
  borderRadius: BRAND.radiusControl,
  fontWeight: 700,
  cursor: "pointer",
};
