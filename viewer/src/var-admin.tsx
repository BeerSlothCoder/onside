import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AdminVarEventSource,
  DemoLedger,
  VarMarketController,
  VarMarketSession,
  VarType,
  VAR_OUTCOME_LABEL,
  VAR_OUTCOME_OPTIONS,
  VAR_TYPE_LABEL,
} from "@onside/var-events";
// Same overlay component viewers would see live on the stream — embedding it
// here means this preview is faithful, not a mockup. See
// extension/src/overlay/VarMomentOverlay.tsx.
import { VarMomentOverlay } from "../../extension/src/overlay/VarMomentOverlay";
import { OffsideLineOverlay } from "../../extension/src/tracking/ui/OffsideLineOverlay";
import type { Rect } from "../../extension/src/tracking/geometry";

/**
 * Admin tool for VAR-moment markets — this is the "simulate txodds/oracles"
 * page. An admin watching ANY match (including leagues our TxLINE tier
 * doesn't cover — Czech Fortuna Liga, EU qualifiers, whatever's on TV)
 * reports VAR moments by hand, in the same two-phase shape a real live feed
 * would eventually produce:
 *
 *   1. TRIGGER — the instant VAR enters the game: match, situation
 *      (goal/red-card/penalty review), a short context note, and the
 *      match-clock timestamp VAR was called.
 *   2. RESOLUTION — once the review concludes: which of the two outcomes
 *      actually happened, and the exact match-clock timestamp VAR announced
 *      it.
 *
 * Every trigger/resolution pair is exactly a `VarTrigger` + `VarResolution`
 * (@onside/var-events) — the same shape `TxlineVarEventSource` will produce
 * the day real VAR data is available, so this tool doubles as a way to grow
 * the sample-events dataset (see "export" below) from real, admin-observed
 * matches in the meantime.
 */

const C = {
  stroke: "rgba(255,255,255,0.14)",
  cyan: "#22d3ee",
  lime: "#BCF13B",
  dim: "#8aa0af",
  ink: "#eaf2f7",
  card: "rgba(255,255,255,0.03)",
  danger: "#f87171",
};

const VAR_TYPES: VarType[] = ["GOAL_REVIEW", "RED_CARD_REVIEW", "PENALTY_REVIEW"];
const PREVIEW_USER_ID = "demo-viewer";

const input: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: `1px solid ${C.stroke}`,
  borderRadius: 8,
  color: C.ink,
  padding: "7px 9px",
  fontSize: 13,
  fontFamily: "inherit",
};
const label: React.CSSProperties = { fontSize: 11, color: C.dim, marginBottom: 4, display: "block" };
const btnPrimary: React.CSSProperties = {
  background: C.cyan,
  color: "#0a1016",
  border: "none",
  borderRadius: 8,
  padding: "9px 16px",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};
const btnSecondary: React.CSSProperties = {
  background: "transparent",
  color: C.ink,
  border: `1px solid ${C.stroke}`,
  borderRadius: 8,
  padding: "6px 12px",
  fontWeight: 600,
  fontSize: 12,
  cursor: "pointer",
};

function TriggerForm({ onTrigger }: { onTrigger: (input: { matchId: string; timestamp: string; varType: VarType; context: string }) => void }) {
  const [matchId, setMatchId] = useState("Czech Fortuna Liga: Slavia Praha vs Sparta Praha");
  const [varType, setVarType] = useState<VarType>("GOAL_REVIEW");
  const [context, setContext] = useState("");
  const [timestamp, setTimestamp] = useState("");

  const submit = () => {
    if (!matchId.trim() || !timestamp.trim()) return;
    onTrigger({ matchId: matchId.trim(), timestamp: timestamp.trim(), varType, context: context.trim() || VAR_TYPE_LABEL[varType] });
    setContext("");
    setTimestamp("");
  };

  return (
    <div style={{ border: `1px solid ${C.stroke}`, borderRadius: 10, padding: 14, background: C.card }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>1 · VAR entered the game</div>
      <label style={label}>Match</label>
      <input style={{ ...input, width: "100%", marginBottom: 8 }} value={matchId} onChange={(e) => setMatchId(e.target.value)} placeholder="Team A vs Team B" />
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={label}>VAR type</label>
          <select style={{ ...input, width: "100%" }} value={varType} onChange={(e) => setVarType(e.target.value as VarType)}>
            {VAR_TYPES.map((t) => (
              <option key={t} value={t}>{VAR_TYPE_LABEL[t]}</option>
            ))}
          </select>
        </div>
        <div style={{ width: 110 }}>
          <label style={label}>Match clock</label>
          <input style={{ ...input, width: "100%" }} value={timestamp} onChange={(e) => setTimestamp(e.target.value)} placeholder="67:14" />
        </div>
      </div>
      <label style={label}>Situation (context)</label>
      <input style={{ ...input, width: "100%", marginBottom: 10 }} value={context} onChange={(e) => setContext(e.target.value)} placeholder="Offside check on the goal" />
      <button style={btnPrimary} onClick={submit} disabled={!matchId.trim() || !timestamp.trim()}>
        Trigger VAR
      </button>
    </div>
  );
}

function ResolveRow({ market, onResolve }: { market: VarMarketController; onResolve: (triggerId: string, outcome: string, timestamp: string) => void }) {
  const [snapshot, setSnapshot] = useState(market.snapshot());
  useEffect(() => market.onChange(setSnapshot), [market]);
  const { trigger } = snapshot;
  const [outcome, setOutcome] = useState(trigger.outcomeOptions[0]);
  const [timestamp, setTimestamp] = useState("");

  return (
    <div style={{ border: `1px solid ${C.stroke}`, borderRadius: 8, padding: 10, marginBottom: 8, background: C.card }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 6 }}>
        <b style={{ fontSize: 12.5 }}>{VAR_TYPE_LABEL[trigger.varType]}</b>
        <span style={{ fontSize: 11, color: C.dim }}>{String(trigger.matchId)}</span>
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: C.cyan, fontWeight: 700, textTransform: "uppercase" }}>
          entered {trigger.timestamp}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: C.dim, marginBottom: 8 }}>{trigger.context}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <label style={label}>Real outcome</label>
          <select style={{ ...input, width: "100%" }} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {trigger.outcomeOptions.map((o) => (
              <option key={o} value={o}>{VAR_OUTCOME_LABEL[o] ?? o}</option>
            ))}
          </select>
        </div>
        <div style={{ width: 110 }}>
          <label style={label}>Announced at</label>
          <input style={{ ...input, width: "100%" }} value={timestamp} onChange={(e) => setTimestamp(e.target.value)} placeholder="69:02" />
        </div>
        <button
          style={{ ...btnPrimary, padding: "7px 14px" }}
          disabled={!timestamp.trim()}
          onClick={() => onResolve(trigger.id, outcome, timestamp.trim())}
        >
          Resolve
        </button>
      </div>
    </div>
  );
}

function ResolvedRow({ market }: { market: VarMarketController }) {
  const [snapshot, setSnapshot] = useState(market.snapshot());
  useEffect(() => market.onChange(setSnapshot), [market]);
  const { trigger, resolvedOutcome, resolvedTimestamp, predictions } = snapshot;
  const wins = predictions.filter((p) => p.outcome === resolvedOutcome).length;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, padding: "6px 0", borderBottom: `1px solid ${C.stroke}` }}>
      <span style={{ color: C.dim, whiteSpace: "nowrap" }}>{trigger.timestamp} → {resolvedTimestamp}</span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{VAR_TYPE_LABEL[trigger.varType]}</span>
      <span style={{ color: C.lime, fontWeight: 700 }}>{resolvedOutcome ? VAR_OUTCOME_LABEL[resolvedOutcome] ?? resolvedOutcome : ""}</span>
      <span style={{ color: C.dim }}>{predictions.length} bet{predictions.length === 1 ? "" : "s"} · {wins} won</span>
    </div>
  );
}

function App() {
  const adminSource = useMemo(() => new AdminVarEventSource(), []);
  const adminLedger = useMemo(() => new DemoLedger(), []); // admin's own ledger — never shown, only predictions matter for export
  const previewLedger = useMemo(() => new DemoLedger(window.localStorage, "onside_var_admin_preview_ledger"), []);
  const session = useMemo(() => new VarMarketSession(adminSource, adminLedger), [adminSource, adminLedger]);

  const [markets, setMarkets] = useState<VarMarketController[]>([]);
  useEffect(() => session.onChange(setMarkets), [session]);
  const [exported, setExported] = useState<string | null>(null);

  const awaiting = markets.filter((m) => m.snapshot().state !== "RESOLVED");
  const resolved = [...markets.filter((m) => m.snapshot().state === "RESOLVED")].reverse();

  // Offside-line tool, mirrored in the "what viewers see" preview — same
  // component + coordinate space the extension uses on a real stream.
  const previewStageRef = useRef<HTMLDivElement>(null);
  const [previewStageRect, setPreviewStageRect] = useState<Rect | null>(null);
  useEffect(() => {
    const update = () => {
      const el = previewStageRef.current;
      if (el) setPreviewStageRect(el.getBoundingClientRect());
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const [offsideLine, setOffsideLine] = useState(false);
  const [featuredVar, setFeaturedVar] = useState<{ varType: string; state: string } | null>(null);
  const isGoalReviewOpen = featuredVar?.varType === "GOAL_REVIEW" && featuredVar.state !== "RESOLVED";
  useEffect(() => {
    if (isGoalReviewOpen) setOffsideLine(true);
  }, [isGoalReviewOpen]);

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 20px 60px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>
        on<span style={{ color: C.cyan }}>side</span> <span style={{ fontWeight: 400 }}>VAR admin — report live moments</span>
      </h1>
      <p style={{ color: C.dim, fontSize: 13, lineHeight: 1.6, maxWidth: 760 }}>
        Watching a match yourself (any league — this doesn't need TxLINE coverage)? Report each VAR
        review as it happens: trigger it the moment VAR is called, resolve it once the decision is
        announced. This stands in for a live oracle feed — the "viewers see" preview on the right
        updates in real time, exactly as it would from a real TxODDS VAR signal.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20, marginTop: 20, alignItems: "start" }}>
        <div>
          <TriggerForm onTrigger={(input) => adminSource.triggerVar({ ...input, outcomeOptions: VAR_OUTCOME_OPTIONS[input.varType] })} />

          {awaiting.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>2 · Awaiting resolution</div>
              {awaiting.map((m) => (
                <ResolveRow key={m.trigger.id} market={m} onResolve={(id, outcome, ts) => adminSource.resolveVar(id, outcome, ts)} />
              ))}
            </div>
          )}

          {resolved.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>Resolved this session</div>
              {resolved.map((m) => <ResolvedRow key={m.trigger.id} market={m} />)}
              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  style={btnSecondary}
                  onClick={() => setExported(JSON.stringify(session.toVarEvents(), null, 2))}
                >
                  Export as VarEvent[] JSON
                </button>
                <span style={{ fontSize: 10.5, color: C.dim }}>
                  → save as a new file under packages/var-events/sample-events/
                </span>
              </div>
              {exported && (
                <textarea
                  readOnly
                  value={exported}
                  style={{ ...input, width: "100%", height: 180, marginTop: 8, fontFamily: "SFMono-Regular, Consolas, monospace", fontSize: 11 }}
                  onFocus={(e) => e.currentTarget.select()}
                />
              )}
            </div>
          )}
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              what viewers see
            </span>
            <button
              onClick={() => setOffsideLine((v) => !v)}
              title="Draw offside line — available any time, auto-opens on a goal review"
              style={{
                background: offsideLine ? C.cyan : "transparent",
                color: offsideLine ? "#0a1016" : C.ink,
                border: `1px solid ${offsideLine ? C.cyan : C.stroke}`,
                borderRadius: 8,
                padding: "3px 9px",
                fontWeight: 700,
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              🚩 offside line
            </button>
          </div>
          <div
            ref={previewStageRef}
            style={{ position: "relative", height: 420, borderRadius: 12, border: `1px solid ${C.stroke}`, background: "#060a0d", overflow: "hidden" }}
          >
            {previewStageRect && offsideLine && (
              <OffsideLineOverlay rect={previewStageRect} onClose={() => setOffsideLine(false)} />
            )}
            <VarMomentOverlay
              source={adminSource}
              ledger={previewLedger}
              userId={PREVIEW_USER_ID}
              badgeLabel="ADMIN · reported live"
              onFeaturedChange={setFeaturedVar}
            />
          </div>
        </div>
      </div>

      <p style={{ color: C.dim, fontSize: 11, marginTop: 30, borderTop: `1px solid ${C.stroke}`, paddingTop: 12 }}>
        Onside — VAR-moment markets. This admin tool and the scripted replay demo (
        <a href="./var-replay.html" style={{ color: C.cyan }}>var-replay.html</a>) both feed the same
        VarMarketController/VarMarketSession (<code>@onside/var-events</code>) — the only difference is
        who reports the trigger/resolution. ·{" "}
        <a href="./index.html" style={{ color: C.cyan }}>← back to the markets viewer</a>
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
