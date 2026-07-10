import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Lineups, ReadbackResult } from "../types";
import { anchorRect, rectsDiffer, viewportToNorm, type Rect } from "../geometry";
import { useTracking } from "../useTracking";
import { PlayerChip } from "./PlayerChip";
import { AssignPopover } from "./AssignPopover";

const C = {
  bg: "rgba(10,16,22,0.92)",
  stroke: "rgba(255,255,255,0.14)",
  cyan: "#22d3ee",
  green: "#34d399",
  amber: "#fbbf24",
  dim: "#8aa0af",
  ink: "#eaf2f7",
};

function probeBadge(probe: ReadbackResult | null): { label: string; color: string } {
  switch (probe) {
    case "ok":
      return { label: "CV-ready ✓", color: C.green };
    case "black":
      return { label: "DRM stream — pins only", color: C.amber };
    case "tainted":
      return { label: "protected stream — pins only", color: C.amber };
    case "embedded":
      return { label: "embedded player — pins only", color: C.amber };
    case "novideo":
      return { label: "waiting for video…", color: C.dim };
    default:
      return { label: "checking stream…", color: C.dim };
  }
}

/**
 * The video-anchored layer: a fixed div kept in sync with the video's content
 * rect by an rAF loop (imperative style writes — React never re-renders on
 * geometry changes). Chips inside are positioned with percentages, so they
 * ride along for free through resize / fullscreen / theater mode.
 */
export function VideoOverlay(props: {
  lineups: Lineups;
  teams: { home: string; away: string };
  flash: (msg: string) => void;
  onClose: () => void;
}) {
  const { anchor, probe, pins, addPin, assignPin, removePin, clearPins } = useTracking(true);
  const [pinMode, setPinMode] = useState(false);
  const [openPinId, setOpenPinId] = useState<number | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const lastRect = useRef<Rect | null>(null);

  // rAF geometry sync — cheap (one getBoundingClientRect per frame).
  useEffect(() => {
    if (!anchor) return;
    let raf = 0;
    const loop = () => {
      const el = layerRef.current;
      if (el) {
        const r = anchorRect(anchor);
        if (rectsDiffer(lastRect.current, r)) {
          lastRect.current = r;
          if (r) {
            el.style.display = "block";
            el.style.left = `${r.left}px`;
            el.style.top = `${r.top}px`;
            el.style.width = `${r.width}px`;
            el.style.height = `${r.height}px`;
          } else {
            el.style.display = "none";
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [anchor]);

  // Escape exits pin mode / closes the popover.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPinMode(false);
        setOpenPinId(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  const taken = useMemo(() => {
    const s = new Set<string>();
    for (const p of pins) {
      if (p.assignment && p.id !== openPinId) s.add(`${p.assignment.team}:${p.assignment.n}`);
    }
    return s;
  }, [pins, openPinId]);

  const openPin = pins.find((p) => p.id === openPinId) ?? null;
  const badge = probeBadge(probe);

  const barBtn = (active: boolean): React.CSSProperties => ({
    border: `1px solid ${active ? C.cyan : C.stroke}`,
    borderRadius: 8,
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 800,
    cursor: "pointer",
    background: active ? C.cyan : "rgba(255,255,255,0.06)",
    color: active ? "#04222a" : C.ink,
    whiteSpace: "nowrap",
  });

  return (
    <>
      {/* video-anchored layer */}
      <div
        ref={layerRef}
        onClick={(e) => {
          if (!pinMode) return;
          const r = lastRect.current;
          if (!r) return;
          const norm = viewportToNorm(e.clientX, e.clientY, r);
          if (!norm) return;
          const id = addPin(norm.u, norm.v);
          setOpenPinId(id);
          setPinMode(false);
        }}
        style={{
          position: "fixed",
          display: "none",
          pointerEvents: pinMode ? "auto" : "none",
          cursor: pinMode ? "crosshair" : "default",
          zIndex: 2147483645,
          background: pinMode ? "rgba(34,211,238,0.06)" : "transparent",
          outline: pinMode ? `2px dashed ${C.cyan}` : "none",
          outlineOffset: -2,
        }}
      >
        {pins.map((p) => (
          <PlayerChip
            key={p.id}
            pin={p}
            selected={p.id === openPinId}
            onClick={() => setOpenPinId(p.id === openPinId ? null : p.id)}
          />
        ))}
        {openPin && (
          <AssignPopover
            pin={openPin}
            lineups={props.lineups}
            teams={props.teams}
            taken={taken}
            onAssign={(a) => {
              assignPin(openPin.id, a);
              setOpenPinId(null);
              props.flash(`Pinned ${a.n} · ${a.name.split(",")[0].trim()} — chip sticks to the video`);
            }}
            onRemove={() => {
              removePin(openPin.id);
              setOpenPinId(null);
            }}
            onClose={() => setOpenPinId(null)}
          />
        )}
        {pinMode && (
          <div
            style={{
              position: "absolute",
              top: 8,
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(4,34,42,0.92)",
              border: `1px solid ${C.cyan}`,
              color: C.ink,
              borderRadius: 8,
              padding: "5px 12px",
              fontSize: 11.5,
              fontWeight: 700,
              fontFamily: "system-ui, sans-serif",
              pointerEvents: "none",
              whiteSpace: "nowrap",
            }}
          >
            Tap a player on the video · Esc to cancel
          </div>
        )}
      </div>

      {/* floating control strip (bottom-left, clear of the market panel on the right) */}
      <div
        style={{
          position: "fixed",
          left: 16,
          bottom: 16,
          zIndex: 2147483646,
          pointerEvents: "auto",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: C.bg,
          border: `1px solid ${C.stroke}`,
          borderRadius: 12,
          padding: "8px 10px",
          fontFamily: "system-ui, sans-serif",
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 800, color: C.ink }}>
          🎯 <span style={{ color: C.cyan }}>track</span>
        </span>
        <button style={barBtn(pinMode)} onClick={() => setPinMode(!pinMode)}>
          📌 Pin player
        </button>
        {pins.length > 0 && (
          <button style={barBtn(false)} onClick={clearPins}>
            Clear ({pins.length})
          </button>
        )}
        <span style={{ fontSize: 10, color: badge.color, fontWeight: 700, whiteSpace: "nowrap" }}>
          {badge.label}
        </span>
        <button
          style={{ ...barBtn(false), padding: "5px 8px" }}
          onClick={() => props.onClose()}
          title="Hide player tracking"
        >
          ✕
        </button>
      </div>
    </>
  );
}
