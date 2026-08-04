import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  DemoLedger,
  VarEventSource,
  VarMarketController,
  VarMarketSession,
  VAR_OUTCOME_LABEL,
  VAR_TYPE_LABEL,
} from "@onside/var-events";
import { BRAND, monoData, monoLabel, UI_FONT } from "./brand";

/**
 * VAR-moment markets — REPLAY / ADMIN DEMO ONLY.
 *
 * This overlay drives entirely off a `VarEventSource` (see
 * @onside/var-events/src/source.ts) — either a scripted replay of an
 * already-played match, or an admin reporting VAR moments by hand while
 * watching a real one. Either way, every review here resolves against a
 * *reported* decision, never live trustless settlement. The
 * "REPLAY/ADMIN — not live settlement" badge below must stay visible any
 * time this component is mounted; do not hide it to make a demo look more
 * "live" than it is (see the honesty framing in
 * onside/Submission/txline_api_experience.md and the txodds-access-audit
 * memory this feature was scoped against).
 *
 * Settlement here comes from a reported VarResolution (see
 * VarMarketController.resolve()) — a market type kept architecturally
 * separate from the Merkle-proof-settled goal/corner/card markets. Balance
 * is a separate demo ledger (DemoLedger), never the real on-chain USDC vault.
 */

const STAKES = [10, 25, 50, 100];

interface Props {
  source: VarEventSource;
  ledger: DemoLedger;
  userId: string;
  /** Label for the persistent honesty badge — defaults to the replay wording;
   *  pass "ADMIN · reported live" from the admin tool's preview pane. */
  badgeLabel?: string;
  /** Fires whenever the prominent (featured) market changes — e.g. so a
   *  parent page can auto-surface the offside-line tool while a
   *  GOAL_REVIEW is OPEN. Not used for settlement, display only. */
  onFeaturedChange?: (featured: { varType: string; state: string } | null) => void;
}

export function VarMomentOverlay({
  source,
  ledger,
  userId,
  badgeLabel = "REPLAY · recorded match",
  onFeaturedChange,
}: Props) {
  const [markets, setMarkets] = useState<VarMarketController[]>([]);
  const [balance, setBalance] = useState(ledger.balanceOf(userId));
  const [stake, setStake] = useState(25);
  const sessionRef = useRef<VarMarketSession | null>(null);

  useEffect(() => {
    const session = new VarMarketSession(source, ledger);
    sessionRef.current = session;
    const unsubscribe = session.onChange((ms) => {
      setMarkets(ms);
      setBalance(ledger.balanceOf(userId));
    });
    return () => {
      unsubscribe();
      session.dispose();
    };
    // source/ledger/userId are expected to be stable for the lifetime of a
    // single demo/admin session — this effect wires up once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Most recently triggered market that isn't RESOLVED drives the prominent
  // prompt; everything else falls into the history strip.
  const ordered = useMemo(
    () => [...markets].sort((a, b) => b.snapshot().openedAtMs - a.snapshot().openedAtMs),
    [markets]
  );
  const featured = ordered.find((m) => m.snapshot().state !== "RESOLVED") ?? ordered[0];
  const history = ordered.filter((m) => m !== featured);
  const featuredSnapshot = featured?.snapshot();

  // Depend on primitive fields, not the controller reference: `featured` can
  // stay the SAME controller across an OPEN→LOCKED→RESOLVED transition, and
  // a plain object dependency wouldn't re-fire when only its internal state changes.
  useEffect(() => {
    if (!onFeaturedChange) return;
    onFeaturedChange(featuredSnapshot ? { varType: featuredSnapshot.trigger.varType, state: featuredSnapshot.state } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featuredSnapshot?.trigger.id, featuredSnapshot?.state, onFeaturedChange]);

  const panel: React.CSSProperties = {
    background: BRAND.panel,
    border: `1px solid ${BRAND.border}`,
    borderRadius: BRAND.radiusCard,
    fontFamily: UI_FONT,
    color: BRAND.text,
    boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
    pointerEvents: "auto",
  };

  return (
    <div style={{ position: "absolute", top: 16, left: 16, zIndex: 2147483647, display: "flex", flexDirection: "column", gap: 8, width: 300 }}>
      {/* Persistent honesty badge — always visible while this feature is mounted. */}
      <div
        style={{
          ...panel,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          border: `1px solid ${BRAND.cyan}`,
        }}
        title="VAR-moment markets resolve against a reported decision (replay script or admin report) — never live trustless settlement."
      >
        <span style={{ width: 6, height: 6, borderRadius: 999, background: BRAND.cyan, flexShrink: 0 }} />
        <span style={{ ...monoLabel, fontSize: 9.5, fontWeight: 700, color: BRAND.cyan, whiteSpace: "nowrap" }}>
          {badgeLabel}
        </span>
        <span style={{ ...monoData, marginLeft: "auto", fontSize: 12, fontWeight: 700, color: BRAND.text }}>
          {balance.toFixed(0)}
        </span>
      </div>

      {featured && (
        <VarMarketCard market={featured} panel={panel} stake={stake} setStake={setStake} userId={userId} />
      )}

      {history.length > 0 && (
        <div style={{ ...panel, padding: "6px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ ...monoLabel, fontSize: 8, color: BRAND.textMuted }}>earlier</span>
          {history.map((m) => (
            <HistoryRow key={m.trigger.id} market={m} userId={userId} />
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryRow({ market, userId }: { market: VarMarketController; userId: string }) {
  const { trigger, resolvedOutcome, predictions } = market.snapshot();
  const mine = predictions.find((p) => p.userId === userId);
  const won = mine && resolvedOutcome && mine.outcome === resolvedOutcome;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5 }}>
      <span style={{ color: BRAND.textMuted, whiteSpace: "nowrap" }}>{trigger.timestamp}</span>
      <span style={{ color: BRAND.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {VAR_TYPE_LABEL[trigger.varType]}
      </span>
      <span style={{ ...monoData, fontWeight: 700, color: resolvedOutcome ? BRAND.lime : BRAND.textMuted }}>
        {resolvedOutcome ? VAR_OUTCOME_LABEL[resolvedOutcome] ?? resolvedOutcome : "…"}
      </span>
      {mine && (
        <span style={{ ...monoData, fontWeight: 700, color: won ? BRAND.lime : BRAND.danger }}>
          {won ? "✓" : "✕"}
        </span>
      )}
    </div>
  );
}

function VarMarketCard({
  market,
  panel,
  stake,
  setStake,
  userId,
}: {
  market: VarMarketController;
  panel: React.CSSProperties;
  stake: number;
  setStake: (n: number) => void;
  userId: string;
}) {
  const [snapshot, setSnapshot] = useState(market.snapshot());
  useEffect(() => market.onChange(setSnapshot), [market]);
  const { trigger, state, predictions, resolvedOutcome } = snapshot;

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (state !== "OPEN") return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - snapshot.openedAtMs) / 1000)), 250);
    return () => clearInterval(t);
  }, [state, snapshot.openedAtMs]);

  const mine = predictions.find((p) => p.userId === userId);

  const stateLabel = state === "OPEN" ? `OPEN · ${elapsed}s` : state === "LOCKED" ? "REVIEWING…" : "DECIDED";
  const stateColor = state === "OPEN" ? BRAND.cyan : state === "LOCKED" ? BRAND.textMuted : BRAND.lime;

  return (
    <div style={{ ...panel, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ ...monoLabel, fontSize: 9, color: BRAND.cyan }}>VAR · {trigger.timestamp}</span>
        <span style={{ ...monoLabel, marginLeft: "auto", fontSize: 9, fontWeight: 700, color: stateColor }}>
          {stateLabel}
        </span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{VAR_TYPE_LABEL[trigger.varType]}</div>
      <div style={{ fontSize: 11.5, color: BRAND.textMuted, lineHeight: 1.4 }}>{trigger.context}</div>

      <div style={{ display: "flex", gap: 6 }}>
        {trigger.outcomeOptions.map((outcome) => {
          const label = VAR_OUTCOME_LABEL[outcome] ?? outcome;
          const picked = mine?.outcome === outcome;
          const isDecision = resolvedOutcome === outcome;
          const disabled = state !== "OPEN" || !!mine;
          return (
            <button
              key={outcome}
              disabled={disabled}
              onClick={() => market.predict(userId, outcome, stake)}
              style={{
                flex: 1,
                padding: "8px 6px",
                borderRadius: BRAND.radiusControl,
                border: `1px solid ${isDecision || picked ? BRAND.lime : BRAND.border}`,
                background: isDecision || picked ? BRAND.lime : "transparent",
                color: isDecision || picked ? BRAND.bg : BRAND.text,
                fontFamily: UI_FONT,
                fontSize: 11.5,
                fontWeight: 700,
                cursor: disabled ? "default" : "pointer",
                opacity: disabled && !picked && !isDecision ? 0.55 : 1,
              }}
            >
              {label}
              {isDecision ? " ✓" : ""}
            </button>
          );
        })}
      </div>

      {state === "OPEN" && !mine && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ ...monoLabel, fontSize: 8, color: BRAND.textMuted }}>stake</span>
          {STAKES.map((v) => (
            <button
              key={v}
              onClick={() => setStake(v)}
              style={{
                ...monoData,
                background: stake === v ? BRAND.cyan : "transparent",
                color: stake === v ? BRAND.bg : BRAND.text,
                border: `1px solid ${stake === v ? BRAND.cyan : BRAND.border}`,
                borderRadius: BRAND.radiusControl,
                padding: "3px 8px",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {v}
            </button>
          ))}
        </div>
      )}

      {mine && (
        <div style={{ fontSize: 10.5, color: BRAND.textMuted }}>
          your call: <b style={{ color: BRAND.text }}>{VAR_OUTCOME_LABEL[mine.outcome] ?? mine.outcome}</b> for {mine.stake}
          {state === "RESOLVED" && (
            <span style={{ color: resolvedOutcome === mine.outcome ? BRAND.lime : BRAND.danger, fontWeight: 700 }}>
              {" "}
              · {resolvedOutcome === mine.outcome ? "won" : "lost"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
