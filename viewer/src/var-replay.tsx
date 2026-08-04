import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DemoLedger, ReplayVarEventSource, VarEvent } from "@onside/var-events";
import sampleEvents from "@onside/var-events/sample-events/france-england-var-events.json";
// Reused from the extension overlay on purpose — same components that will
// eventually render on top of the live stream, so this standalone page is a
// faithful preview, not a reimplementation. See extension/src/overlay/VarMomentOverlay.tsx
// and extension/src/tracking/ui/OffsideLineOverlay.tsx.
import { VarMomentOverlay } from "../../extension/src/overlay/VarMomentOverlay";
import { OffsideLineOverlay } from "../../extension/src/tracking/ui/OffsideLineOverlay";
import type { Rect } from "../../extension/src/tracking/geometry";

/**
 * Standalone, shareable demo of VAR-moment markets — no browser extension,
 * no live stream, no wallet required. Everything here runs off a scripted
 * replay of a real, finished match (France vs England, TxLINE fixture
 * 18257865); see @onside/var-events for why that's the honest way to build
 * and demo this until TxODDS access covers a competition with VAR data.
 *
 * Deployed alongside the read-only markets viewer at
 * https://beerslothcoder.github.io/onside/var-replay.html
 */

const C = {
  stroke: "rgba(255,255,255,0.14)",
  cyan: "#22d3ee",
  dim: "#8aa0af",
  ink: "#eaf2f7",
  card: "rgba(255,255,255,0.03)",
};

const DEMO_USER_ID = "demo-viewer";
const DEFAULT_SPEED = 12; // compresses the ~35 scripted match-minutes into ~3 real minutes

function useMatchClock(speedMultiplier: number) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => {
      setSeconds(Math.floor(((Date.now() - start) / 1000) * speedMultiplier));
    }, 250);
    return () => clearInterval(t);
  }, [speedMultiplier]);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function App() {
  const speedMultiplier = useMemo(() => {
    const q = Number(new URLSearchParams(location.search).get("speed"));
    return q > 0 ? q : DEFAULT_SPEED;
  }, []);

  const clock = useMatchClock(speedMultiplier);

  // Stable for the page's lifetime — a reload is how you "restart" the replay.
  const source = useMemo(
    () => new ReplayVarEventSource(sampleEvents as unknown as VarEvent[], { speedMultiplier }),
    [speedMultiplier]
  );
  const ledger = useMemo(() => new DemoLedger(window.localStorage), []);

  // The offside-line tool needs the "stream" box's viewport rect (same
  // coordinate space the extension gets from the real video element).
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageRect, setStageRect] = useState<Rect | null>(null);
  useEffect(() => {
    const update = () => {
      const el = stageRef.current;
      if (el) setStageRect(el.getBoundingClientRect());
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const [offsideLine, setOffsideLine] = useState(false);
  const [featuredVar, setFeaturedVar] = useState<{ varType: string; state: string } | null>(null);
  const isGoalReviewOpen = featuredVar?.varType === "GOAL_REVIEW" && featuredVar.state !== "RESOLVED";
  // Auto-surface the offside-line tool for a goal review — the exact moment
  // it's meant to help with — without fighting a user who dismisses it
  // manually (this only fires on the OFF→ON edge, see the dependency).
  useEffect(() => {
    if (isGoalReviewOpen) setOffsideLine(true);
  }, [isGoalReviewOpen]);

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px 60px" }}>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>
        on<span style={{ color: C.cyan }}>side</span>{" "}
        <span style={{ fontWeight: 400 }}>VAR-moment markets — replay demo</span>
      </h1>
      <p style={{ color: C.dim, fontSize: 13.5, lineHeight: 1.6 }}>
        This page plays back <b style={{ color: C.ink }}>scripted VAR events from a real, finished
        match</b> (France vs England) on a timeline — it is a{" "}
        <b style={{ color: C.ink }}>replay simulation, not live settlement</b>. Each review's outcome
        is the recorded official decision from that match; predictions here spend a separate demo
        balance, never the real on-chain USDC used by Onside's trustless goal/corner/card markets.
        Running at <b style={{ color: C.ink }}>{speedMultiplier}×</b> speed (add <code>?speed=1</code> to
        the URL for real-time pacing).
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
        <button
          onClick={() => setOffsideLine((v) => !v)}
          style={{
            background: offsideLine ? C.cyan : "transparent",
            color: offsideLine ? "#0a1016" : C.ink,
            border: `1px solid ${offsideLine ? C.cyan : C.stroke}`,
            borderRadius: 8,
            padding: "6px 12px",
            fontWeight: 700,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          🚩 Draw offside line
        </button>
        <span style={{ fontSize: 11, color: C.dim }}>
          Available any time — check any onside/offside position for fun. Auto-opens during a goal review.
        </span>
      </div>

      <div
        ref={stageRef}
        style={{
          position: "relative",
          marginTop: 10,
          height: 460,
          borderRadius: 14,
          border: `1px solid ${C.stroke}`,
          background:
            "radial-gradient(120% 140% at 50% 0%, rgba(34,211,238,0.06), rgba(0,0,0,0) 60%), #060a0d",
          overflow: "hidden",
        }}
      >
        {/* Placeholder "stream" — the real thing is a browser-extension overlay on
            top of an actual video element; this stand-in just gives the demo a
            sense of place and a running clock. */}
        <div
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "SFMono-Regular, Consolas, monospace",
            fontSize: 13,
            color: C.ink,
            background: "rgba(0,0,0,0.4)",
            border: `1px solid ${C.stroke}`,
            borderRadius: 8,
            padding: "6px 10px",
          }}
        >
          France 0–0 England · {clock}
        </div>

        {stageRect && offsideLine && (
          <OffsideLineOverlay rect={stageRect} onClose={() => setOffsideLine(false)} />
        )}
        <VarMomentOverlay source={source} ledger={ledger} userId={DEMO_USER_ID} onFeaturedChange={setFeaturedVar} />
      </div>

      <p style={{ color: C.dim, fontSize: 11, marginTop: 24, borderTop: `1px solid ${C.stroke}`, paddingTop: 12 }}>
        Onside — VAR-moment markets, scoped against the txodds-access-audit (World Cup [finished] +
        Friendlies only on our current TxLINE tier). Data model + replay engine:{" "}
        <code>@onside/var-events</code> · sample events:{" "}
        <code>packages/var-events/sample-events/france-england-var-events.json</code> ·{" "}
        <a href="./index.html" style={{ color: C.cyan }}>
          ← back to the markets viewer
        </a>
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
