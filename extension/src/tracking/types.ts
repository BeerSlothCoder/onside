// Shared types for the sticky-player-chips feature (tap-to-pin now, CV tracking later).

export type Team = "home" | "away";

export interface LineupPlayer {
  n: string;
  name: string;
}

export interface Lineups {
  home: LineupPlayer[];
  away: LineupPlayer[];
}

export interface Assignment {
  team: Team;
  n: string;
  name: string;
}

/** A manually placed chip, anchored in normalized video-content coordinates (0..1). */
export interface Pin {
  id: number;
  u: number;
  v: number;
  assignment: Assignment | null;
}

/**
 * Result of the canvas-readback probe:
 *  ok       — frames are readable → full CV tracking is possible on this stream
 *  black    — frames decode to black (EME/Widevine DRM) → pins only
 *  tainted  — cross-origin non-MSE source taints the canvas → pins only
 *  embedded — player lives in a cross-origin iframe we can't see into → pins only
 *  novideo  — no playable video found yet
 */
export type ReadbackResult = "ok" | "black" | "tainted" | "embedded" | "novideo";

/** What the overlay layer is anchored to. */
export interface Anchor {
  el: HTMLVideoElement | HTMLIFrameElement;
  kind: "video" | "iframe";
}
