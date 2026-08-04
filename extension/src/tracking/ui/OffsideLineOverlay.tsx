import React, { useCallback, useRef, useState } from "react";
import type { Rect } from "../geometry";
import { BRAND, MONO_FONT, UI_FONT, monoLabel } from "../../overlay/brand";

/**
 * Draws a single offside line across the video, in the same normalized
 * video-content coordinate space as the player tracker/pins (see
 * ../geometry.ts) — u=0 is the left edge of the picture, u=1 the right edge,
 * independent of window size / fullscreen / theater mode.
 *
 * SIMPLIFICATION, stated plainly: this is a straight vertical line (fixed u,
 * spanning the full picture height) with no camera-perspective correction.
 * A true offside line is a straight line on the pitch parallel to the goal
 * line — under a real broadcast camera it's tilted, not vertical, and
 * "connects the same-distance point on both touchlines" only exactly at
 * that tilt. We don't have pitch-corner/homography calibration in this repo
 * (the tracker gives player boxes in raw video-normalized coordinates only,
 * no pitch-plane mapping), so a vertical line is the honest, cheap
 * approximation: good enough to judge a close call on a head-on tactical
 * camera, not a broadcast-grade graphic. The one degree of freedom the user
 * gets — sliding it left/right — matches how a real operator places these:
 * never rotated, just slid to the defender's depth.
 */
export function OffsideLineOverlay({ rect, onClose }: { rect: Rect; onClose: () => void }) {
  const [u, setU] = useState(0.5);
  const [dragging, setDragging] = useState(false);
  const rectRef = useRef(rect);
  rectRef.current = rect;

  const clampU = (clientX: number) => {
    const r = rectRef.current;
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    setU(clampU(e.clientX));
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.buttons === 0) return; // guard against a stray move after capture loss
    setU(clampU(e.clientX));
  }, []);
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  }, []);

  const color = dragging ? BRAND.lime : BRAND.cyan;

  return (
    <div
      style={{
        position: "absolute",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        zIndex: 2147483645,
        pointerEvents: "none",
      }}
    >
      {/* label */}
      <div
        style={{
          position: "absolute",
          left: `${u * 100}%`,
          top: 6,
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: BRAND.panel,
          border: `1px solid ${color}`,
          borderRadius: BRAND.radiusControl,
          padding: "3px 8px",
          pointerEvents: "auto",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ ...monoLabel, fontSize: 9, fontWeight: 700, color, fontFamily: MONO_FONT }}>
          OFFSIDE LINE · approx
        </span>
        <button
          onClick={onClose}
          title="Hide offside line"
          style={{ border: "none", background: "transparent", color: BRAND.textMuted, cursor: "pointer", fontFamily: UI_FONT, fontSize: 12, padding: 0, lineHeight: 1 }}
        >
          ✕
        </button>
      </div>

      {/* the line itself */}
      <div
        style={{
          position: "absolute",
          left: `${u * 100}%`,
          top: 0,
          bottom: 0,
          width: 2,
          transform: "translateX(-1px)",
          background: color,
          boxShadow: `0 0 6px ${color}`,
          pointerEvents: "none",
        }}
      />

      {/* wide invisible drag rail so a moving player under the line doesn't
          steal the pointer — the whole vertical strip is grabbable */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="Drag left/right to the last defender"
        style={{
          position: "absolute",
          left: `calc(${u * 100}% - 14px)`,
          top: 0,
          bottom: 0,
          width: 28,
          cursor: "ew-resize",
          pointerEvents: "auto",
        }}
      />

      {/* drag handle, mid-height, for a clear affordance even when the rail is subtle */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          position: "absolute",
          left: `${u * 100}%`,
          top: "50%",
          width: 20,
          height: 20,
          transform: "translate(-50%, -50%)",
          borderRadius: 999,
          background: color,
          border: `2px solid ${BRAND.bg}`,
          cursor: "ew-resize",
          pointerEvents: "auto",
        }}
      />
    </div>
  );
}
