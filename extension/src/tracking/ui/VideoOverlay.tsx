import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Assignment, BallTrack, Lineups, ReadbackResult } from "../types";
import { anchorRect, rectsDiffer, viewportToNorm, type Rect } from "../geometry";
import { useTracking } from "../useTracking";
import { useDetector } from "../useDetector";
import { DebugHud } from "./DebugHud";
import { PlayerChip } from "./PlayerChip";
import { AssignPopover } from "./AssignPopover";
import { teamColors } from "../../overlay/teamColors";
import { surnameKey } from "../../chain/live";
import { BRAND, UI_FONT, MONO_FONT } from "../../overlay/brand";

const C = {
  bg: BRAND.panel,
  stroke: BRAND.border,
  cyan: BRAND.cyan,
  green: BRAND.lime, // "green" here = the lime selection colour
  amber: BRAND.danger,
  dim: BRAND.textMuted,
  ink: BRAND.text,
};

function shortName(full: string): string {
  return full.includes(",") ? full.split(",")[0].trim() : full.split(" ").at(-1) ?? full;
}

function probeBadge(probe: ReadbackResult | null): { label: string; color: string } {
  switch (probe) {
    case "ok":
      // available → cyan (live/available state)
      return { label: "CV-ready", color: C.cyan };
    case "black":
      return { label: "DRM stream — pins only", color: C.dim };
    case "tainted":
      return { label: "protected stream — pins only", color: C.dim };
    case "embedded":
      return { label: "embedded player — pins only", color: C.dim };
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
  goalscorers?: Record<string, { name: string; odds: number; key: string }> | null;
  flash: (msg: string) => void;
  onClose: () => void;
  /** Pushes the live ball track up to the parent whenever it changes — lets
   *  a sibling overlay (e.g. PossessionZoneOverlay) resolve against it
   *  without running a second, GPU-doubling detector instance. */
  onBallUpdate?: (ball: BallTrack | null) => void;
  /** When true, forces CV auto-detection on even if the user hasn't clicked
   *  🤖 Auto themselves — used by features that need ball tracking (e.g.
   *  "Bet on Possession") so enabling them is a single click, not three. */
  forceAuto?: boolean;
}) {
  const { anchor, probe, pins, addPin, assignPin, removePin, clearPins } = useTracking(true);
  const [pinMode, setPinMode] = useState(false);
  const [openPinId, setOpenPinId] = useState<number | null>(null);
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    if (props.forceAuto) setAuto(true);
  }, [props.forceAuto]);
  const [debug, setDebug] = useState(false);
  const [trackAssign, setTrackAssign] = useState<Map<number, Assignment>>(new Map());
  const [openTrackId, setOpenTrackId] = useState<number | null>(null);
  // next-scorer pick (demo market): one player at a time, rendered green.
  // Keyed to the clicked chip, plus the assignment so the pick survives
  // track death → re-tag.
  const [scorer, setScorer] = useState<{
    src: "track" | "pin";
    id: number;
    assignment: Assignment | null;
  } | null>(null);
  const videoEl = anchor?.kind === "video" ? (anchor.el as HTMLVideoElement) : null;
  const { state: detState, tracks, ball, inferMs } = useDetector(videoEl, auto && probe === "ok");
  const [ballSelected, setBallSelected] = useState(false);
  useEffect(() => {
    props.onBallUpdate?.(ball);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ball]);
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

  // kit-color accents for chips/pills — falls back to cyan/pink for unknown teams
  const accents = useMemo(
    () => ({
      home: teamColors(props.teams.home, "home").accent,
      away: teamColors(props.teams.away, "away").accent,
    }),
    [props.teams.home, props.teams.away]
  );

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

  const sameAssign = (a: Assignment | null, b: Assignment | null) =>
    !!a && !!b && a.team === b.team && a.n === b.n;
  const isScorer = (src: "track" | "pin", id: number, a: Assignment | null) =>
    !!scorer && ((scorer.src === src && scorer.id === id) || sameAssign(scorer.assignment, a));
  /** Toggle the next-scorer pick on a chip (replaces any previous pick). */
  const toggleScorer = (src: "track" | "pin", id: number, a: Assignment | null) => {
    if (isScorer(src, id, a)) {
      setScorer(null);
      props.flash("Next-scorer pick removed");
    } else {
      setScorer({ src, id, assignment: a });
      props.flash(
        `⚽ Next scorer: ${a ? `${a.n} · ${shortName(a.name)}` : "tagged player"} — demo market, display only`
      );
    }
  };
  /** Keep the green on the player when their assignment moves to a new chip. */
  const followScorer = (src: "track" | "pin", id: number, a: Assignment) => {
    if (scorer && sameAssign(scorer.assignment, a)) setScorer({ src, id, assignment: a });
  };

  const openPin = pins.find((p) => p.id === openPinId) ?? null;
  const openTrack = tracks.find((t) => t.id === openTrackId) ?? null;
  const badge = probeBadge(probe);

  const barBtn = (active: boolean): React.CSSProperties => ({
    border: `1px solid ${active ? C.cyan : C.stroke}`,
    borderRadius: BRAND.radiusControl,
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    background: active ? C.cyan : BRAND.surface,
    color: active ? BRAND.bg : C.ink,
    fontFamily: UI_FONT,
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
          position: "absolute",
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
            const picked = isScorer("track", t.id, a);
            // lime only for the selected (next-scorer) marker; assigned keeps
            // kit colour (team identity); unassigned is an available cyan ring
            const color = picked ? C.green : a ? accents[a.team] : C.cyan;
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
                  zIndex: selected ? 3 : picked ? 3 : a ? 2 : 1,
                }}
              >
                {/* the whole frame is the click target — much easier to hit a
                    moving player than the small chip. A faint kit-colour wash
                    distinguishes it as a button while keeping the picture
                    watchable; it lifts a little on hover. */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenTrackId(selected ? null : t.id);
                    setOpenPinId(null);
                  }}
                  title={a ? `${a.n} · ${a.name}` : "Who is this? Click to assign"}
                  style={{
                    position: "absolute",
                    inset: 0,
                    padding: 0,
                    border: `${picked ? 3 : 1.5}px solid ${color}`,
                    borderRadius: 4,
                    background: selected ? `${color}33` : `${color}1c`,
                    pointerEvents: "auto",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = `${color}3a`)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = selected ? `${color}33` : `${color}1c`)}
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
                    fontFamily: MONO_FONT,
                    whiteSpace: "nowrap",
                    ...(a || picked
                      ? {
                          border: `1px solid ${color}`,
                          background: selected || picked ? color : BRAND.panel,
                          color: selected || picked ? BRAND.bg : color,
                          borderRadius: BRAND.radiusControl,
                          padding: "2px 8px",
                          fontSize: 10.5,
                          fontWeight: 700,
                        }
                      : {
                          width: 15,
                          height: 15,
                          borderRadius: 999,
                          border: `2px solid ${selected ? C.cyan : C.cyan}`,
                          background: selected ? C.cyan : BRAND.surfaceHover,
                          padding: 0,
                        }),
                  }}
                  title={a ? `${a.n} · ${a.name}` : "Who is this? Click to assign"}
                >
                  {picked ? "⚽ " : ""}
                  {a ? `${a.n} · ${shortName(a.name)}` : picked ? "next scorer" : ""}
                  {a && props.goalscorers?.[surnameKey(a.name)] && (
                    <span style={{ color: C.green, marginLeft: 4, fontWeight: 800 }}>
                      ⚽{props.goalscorers[surnameKey(a.name)].odds.toFixed(2)}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        {auto && ball && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setBallSelected((v) => !v);
            }}
            title={`ball · ${(ball.score * 100).toFixed(0)}%${ball.coasting ? " (coasting)" : ""}`}
            style={{
              position: "absolute",
              left: `${(ball.u + ball.w / 2) * 100}%`,
              top: `${(ball.v + ball.h / 2) * 100}%`,
              transform: "translate(-50%, -50%)",
              // transition matches the ~7Hz tracker update cadence, same as player chips
              transition: "left 150ms linear, top 150ms linear",
              width: ballSelected ? 22 : 16,
              height: ballSelected ? 22 : 16,
              padding: 0,
              border: `1.5px solid ${ballSelected ? C.green : C.ink}`,
              borderRadius: 999,
              background: BRAND.panel,
              color: BRAND.text,
              fontSize: ballSelected ? 13 : 10,
              lineHeight: 1,
              opacity: ball.coasting ? 0.5 : 1,
              pointerEvents: "auto",
              cursor: "pointer",
              zIndex: 4,
            }}
          >
            ⚽
          </button>
        )}
        {pins.map((p) => (
          <PlayerChip
            key={p.id}
            pin={p}
            selected={p.id === openPinId}
            scorer={isScorer("pin", p.id, p.assignment)}
            accent={p.assignment ? accents[p.assignment.team] : undefined}
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
            accents={accents}
            taken={taken}
            parked={parked}
            scorer={isScorer("pin", openPin.id, openPin.assignment)}
            onScorer={() => {
              toggleScorer("pin", openPin.id, openPin.assignment);
              setOpenPinId(null);
            }}
            onAssign={(a) => {
              setTrackAssign(stealOrphans(new Map(trackAssign), a));
              assignPin(openPin.id, a);
              followScorer("pin", openPin.id, a);
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
            accents={accents}
            taken={taken}
            removeLabel="Unassign"
            parked={parked}
            scorer={isScorer("track", openTrack.id, trackAssign.get(openTrack.id) ?? null)}
            onScorer={() => {
              toggleScorer("track", openTrack.id, trackAssign.get(openTrack.id) ?? null);
              setOpenTrackId(null);
            }}
            onAssign={(a) => {
              setTrackAssign(stealOrphans(new Map(trackAssign), a).set(openTrack.id, a));
              followScorer("track", openTrack.id, a);
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
              background: BRAND.panel,
              border: `1px solid ${C.cyan}`,
              color: C.ink,
              borderRadius: BRAND.radiusControl,
              padding: "5px 12px",
              fontSize: 11.5,
              fontWeight: 600,
              fontFamily: UI_FONT,
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
          position: "absolute",
          left: 16,
          bottom: 16,
          zIndex: 2147483646,
          pointerEvents: "auto",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: C.bg,
          border: `1px solid ${C.stroke}`,
          borderRadius: BRAND.radiusCard,
          padding: "8px 10px",
          fontFamily: UI_FONT,
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
        {scorer && (
          <span
            style={{ fontSize: 11, fontWeight: 800, color: C.green, whiteSpace: "nowrap" }}
            title="Next-scorer pick (demo market)"
          >
            ⚽ {scorer.assignment ? shortName(scorer.assignment.name) : "next scorer"}
            <span
              onClick={() => setScorer(null)}
              style={{ cursor: "pointer", marginLeft: 5, color: C.dim, fontWeight: 700 }}
              title="Remove pick"
            >
              ✕
            </span>
          </span>
        )}
        {pins.length > 0 && (
          <button
            style={barBtn(false)}
            onClick={() => {
              if (scorer?.src === "pin") setScorer(null);
              clearPins();
            }}
          >
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
