import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Assignment, Lineups, ReadbackResult } from "../types";
import { anchorRect, rectsDiffer, viewportToNorm, type Rect } from "../geometry";
import { useTracking } from "../useTracking";
import { useDetector } from "../useDetector";
import { DebugHud } from "./DebugHud";
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

function shortName(full: string): string {
  return full.includes(",") ? full.split(",")[0].trim() : full.split(" ").at(-1) ?? full;
}

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
  const [auto, setAuto] = useState(false);
  const [debug, setDebug] = useState(false);
  const [trackAssign, setTrackAssign] = useState<Map<number, Assignment>>(new Map());
  const [openTrackId, setOpenTrackId] = useState<number | null>(null);
  const videoEl = anchor?.kind === "video" ? (anchor.el as HTMLVideoElement) : null;
  const { state: detState, tracks, inferMs } = useDetector(videoEl, auto && probe === "ok");
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
        setOpenTrackId(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  const liveIds = useMemo(() => new Set(tracks.map((t) => t.id)), [tracks]);

  // assignments whose track has died (player left the shot) — offered for re-tag
  const parked = useMemo(() => {
    const out: Assignment[] = [];
    for (const [id, a] of trackAssign) if (!liveIds.has(id)) out.push(a);
    return out;
  }, [trackAssign, liveIds]);

  const taken = useMemo(() => {
    const s = new Set<string>();
    for (const p of pins) {
      if (p.assignment && p.id !== openPinId) s.add(`${p.assignment.team}:${p.assignment.n}`);
    }
    for (const [id, a] of trackAssign) {
      if (id !== openTrackId && liveIds.has(id)) s.add(`${a.team}:${a.n}`);
    }
    return s;
  }, [pins, openPinId, trackAssign, openTrackId, liveIds]);

  /** Assigning player X anywhere steals X from any dead track it was tagged to. */
  const stealOrphans = (m: Map<number, Assignment>, a: Assignment) => {
    for (const [id, ex] of m) {
      if (ex.team === a.team && ex.n === a.n && !liveIds.has(id)) m.delete(id);
    }
    return m;
  };

  const openPin = pins.find((p) => p.id === openPinId) ?? null;
  const openTrack = tracks.find((t) => t.id === openTrackId) ?? null;
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
        {auto &&
          tracks.map((t) => {
            const a = trackAssign.get(t.id) ?? null;
            const selected = t.id === openTrackId;
            const color = a ? (a.team === "home" ? C.cyan : "#f0abfc") : "rgba(34,211,238,0.6)";
            return (
              <div
                key={`t${t.id}`}
                style={{
                  position: "absolute",
                  left: `${t.u * 100}%`,
                  top: `${t.v * 100}%`,
                  width: `${t.w * 100}%`,
                  height: `${t.h * 100}%`,
                  // browser tweens between ~7 Hz tracker updates → smooth ride
                  transition: "left 150ms linear, top 150ms linear, width 150ms linear, height 150ms linear",
                  pointerEvents: "none",
                  opacity: t.coasting ? 0.45 : 1,
                  zIndex: selected ? 3 : a ? 2 : 1,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    border: `1.5px solid ${color}`,
                    borderRadius: 4,
                    boxShadow: a ? "0 0 8px rgba(0,0,0,0.4)" : "none",
                  }}
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenTrackId(selected ? null : t.id);
                    setOpenPinId(null);
                  }}
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: 0,
                    transform: "translate(-50%, -115%)",
                    pointerEvents: "auto",
                    cursor: "pointer",
                    fontFamily: "system-ui, sans-serif",
                    whiteSpace: "nowrap",
                    ...(a
                      ? {
                          border: `1.5px solid ${color}`,
                          background: selected ? color : "rgba(6,14,20,0.85)",
                          color: selected ? "#04222a" : color,
                          borderRadius: 999,
                          padding: "2px 8px",
                          fontSize: 10.5,
                          fontWeight: 800,
                        }
                      : {
                          width: 15,
                          height: 15,
                          borderRadius: 999,
                          border: `2px solid ${selected ? C.cyan : "rgba(234,242,247,0.85)"}`,
                          background: selected ? C.cyan : "rgba(6,14,20,0.5)",
                          padding: 0,
                        }),
                  }}
                  title={a ? `${a.n} · ${a.name}` : "Who is this? Click to assign"}
                >
                  {a ? `${a.n} · ${shortName(a.name)}` : ""}
                </button>
              </div>
            );
          })}
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
            u={openPin.u}
            v={openPin.v}
            assignment={openPin.assignment}
            lineups={props.lineups}
            teams={props.teams}
            taken={taken}
            parked={parked}
            onAssign={(a) => {
              setTrackAssign(stealOrphans(new Map(trackAssign), a));
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
        {openTrack && (
          <AssignPopover
            u={openTrack.u + openTrack.w / 2}
            v={openTrack.v + openTrack.h}
            assignment={trackAssign.get(openTrack.id) ?? null}
            lineups={props.lineups}
            teams={props.teams}
            taken={taken}
            removeLabel="Unassign"
            parked={parked}
            onAssign={(a) => {
              setTrackAssign(stealOrphans(new Map(trackAssign), a).set(openTrack.id, a));
              setOpenTrackId(null);
              props.flash(`${a.n} · ${shortName(a.name)} tagged — the chip follows them now`);
            }}
            onRemove={() => {
              const m = new Map(trackAssign);
              m.delete(openTrack.id);
              setTrackAssign(m);
              setOpenTrackId(null);
            }}
            onClose={() => setOpenTrackId(null)}
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
        <span
          style={{ fontSize: 12, fontWeight: 800, color: C.ink, cursor: "default", userSelect: "none" }}
          onClick={(e) => {
            if (e.shiftKey) setDebug(!debug);
          }}
          title="Shift-click for diagnostics"
        >
          🎯 <span style={{ color: C.cyan }}>track</span>
        </span>
        <button style={barBtn(pinMode)} onClick={() => setPinMode(!pinMode)}>
          📌 Pin player
        </button>
        {probe === "ok" && (
          <button style={barBtn(auto)} onClick={() => setAuto(!auto)} title="Detect players with in-browser YOLO (beta)">
            {!auto
              ? "🤖 Auto"
              : detState === "loading"
                ? "🤖 loading…"
                : detState === "error"
                  ? "🤖 failed"
                  : `🤖 ${tracks.length} · ${inferMs}ms`}
          </button>
        )}
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

      {debug && (
        <DebugHud probe={probe} detState={detState} trackCount={tracks.length} inferMs={inferMs} />
      )}
    </>
  );
}
