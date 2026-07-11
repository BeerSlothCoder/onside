import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  explorerAddr,
  explorerTx,
  fetchMarkets,
  findSettlement,
  impliedOdds,
  MarketRow,
  ONSIDE_PROGRAM_ID,
  Settlement,
  TXORACLE_PROGRAM_ID,
} from "./chain";

const C = {
  stroke: "rgba(255,255,255,0.14)",
  cyan: "#22d3ee",
  green: "#34d399",
  red: "#f87171",
  dim: "#8aa0af",
  ink: "#eaf2f7",
  card: "rgba(255,255,255,0.03)",
};

interface LiveScore {
  phaseLabel: string;
  final: boolean;
  score: { home: number; away: number };
  corners: { home: number; away: number };
  clock: { running: boolean; seconds: number };
  phase: number;
}

// live scores come from the local Onside data proxy when one is running
// (override with ?proxy=https://…); the page works fine without it
const PROXY =
  new URLSearchParams(location.search).get("proxy")?.replace(/\/$/, "") ??
  "http://127.0.0.1:8787";

function marketLabel(m: MarketRow): string {
  if (m.kind === "matchResult") return "Match result (1X2)";
  const side = m.statKey === 7 ? "Home" : m.statKey === 8 ? "Away" : `stat ${m.statKey}`;
  return `${side} corners over ${m.threshold}.5`;
}

function sideLabels(m: MarketRow): string[] {
  if (m.kind === "matchResult")
    return [m.fixture?.home ?? "Home", "Draw", m.fixture?.away ?? "Away"];
  return ["Over", "Under"];
}

function ProofBlock({ market }: { market: MarketRow }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "none">("idle");
  const [proof, setProof] = useState<Settlement | null>(null);

  const load = async () => {
    setState("loading");
    try {
      const p = await findSettlement(market.address);
      setProof(p);
      setState(p ? "done" : "none");
    } catch {
      setState("none");
    }
  };

  if (state === "idle") {
    return (
      <button
        onClick={load}
        style={{
          marginTop: 8,
          border: `1px solid ${C.cyan}`,
          background: "transparent",
          color: C.cyan,
          borderRadius: 7,
          padding: "4px 10px",
          fontSize: 11.5,
          cursor: "pointer",
        }}
      >
        🧾 verify settlement on-chain
      </button>
    );
  }
  if (state === "loading")
    return <div style={{ marginTop: 8, fontSize: 11.5, color: C.dim }}>reading settlement transaction…</div>;
  if (state === "none" || !proof)
    return (
      <div style={{ marginTop: 8, fontSize: 11.5, color: C.dim }}>
        settlement tx not found in recent history (RPC limit) — check the market address on the explorer.
      </div>
    );

  const oracleLines = proof.logs.filter(
    (l) =>
      l.includes(TXORACLE_PROGRAM_ID.toBase58()) ||
      l.includes("Program log:") ||
      l.includes("Instruction: Settle")
  );
  return (
    <div style={{ marginTop: 8, fontSize: 11.5 }}>
      <div>
        <a href={explorerTx(proof.signature)} target="_blank" rel="noreferrer" style={{ color: C.cyan }}>
          settle tx {proof.signature.slice(0, 8)}…{proof.signature.slice(-8)} ↗
        </a>
        {proof.blockTime && (
          <span style={{ color: C.dim }}> · {new Date(proof.blockTime * 1000).toUTCString()}</span>
        )}
      </div>
      <div style={{ color: C.dim, margin: "6px 0 4px" }}>
        The settle instruction carries the TxLINE fixture summary and Merkle paths; the Onside
        program CPIs into the txoracle program, which verifies them against its on-chain daily
        roots before the outcome is accepted:
      </div>
      <pre
        style={{
          background: "rgba(0,0,0,0.45)",
          border: `1px solid ${C.stroke}`,
          borderRadius: 8,
          padding: 10,
          overflowX: "auto",
          maxHeight: 260,
          fontSize: 10.5,
          lineHeight: 1.5,
          color: "#b9d6e2",
        }}
      >
        {oracleLines.join("\n")}
      </pre>
    </div>
  );
}

function MarketCard({ m }: { m: MarketRow }) {
  const labels = sideLabels(m);
  const stateColor = m.state === "open" ? C.green : m.state === "locked" ? C.cyan : C.dim;
  return (
    <div style={{ border: `1px solid ${C.stroke}`, borderRadius: 10, padding: "10px 12px", marginBottom: 8, background: C.card }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
        <b style={{ fontSize: 13 }}>{marketLabel(m)}</b>
        <span style={{ fontSize: 10, color: stateColor, textTransform: "uppercase", fontWeight: 700 }}>{m.state}</span>
        <a
          href={explorerAddr(m.address.toBase58())}
          target="_blank"
          rel="noreferrer"
          style={{ marginLeft: "auto", fontSize: 10.5, color: C.dim, textDecoration: "none" }}
          title={m.address.toBase58()}
        >
          {m.address.toBase58().slice(0, 4)}…{m.address.toBase58().slice(-4)} ↗
        </a>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        {labels.map((label, side) => {
          const odds = impliedOdds(m, side);
          const won = m.state === "settled" && m.outcome === side;
          return (
            <div
              key={side}
              style={{
                flex: 1,
                border: `1px solid ${won ? C.green : C.stroke}`,
                background: won ? "rgba(52,211,153,0.14)" : "rgba(255,255,255,0.04)",
                color: won ? C.green : C.ink,
                borderRadius: 8,
                padding: "6px 8px",
                fontSize: 12,
                textAlign: "center",
              }}
            >
              <div style={{ fontWeight: 700 }}>
                {label}
                {won ? " ✓" : ""}
              </div>
              <div style={{ fontSize: 10.5, color: won ? C.green : C.dim }}>
                ${m.pools[side].toFixed(0)}
                {odds ? ` · ${odds.toFixed(2)}x` : ""}
              </div>
            </div>
          );
        })}
      </div>
      {m.state === "settled" && <ProofBlock market={m} />}
    </div>
  );
}

function App() {
  const [markets, setMarkets] = useState<MarketRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, LiveScore>>({});

  useEffect(() => {
    fetchMarkets().then(setMarkets, (e) => setError(String(e?.message ?? e)));
    const t = setInterval(() => fetchMarkets().then(setMarkets, () => {}), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const poll = () =>
      fetch(`${PROXY}/live`)
        .then((r) => r.json())
        .then(setLive)
        .catch(() => {});
    poll();
    const t = setInterval(poll, 15_000);
    return () => clearInterval(t);
  }, []);

  const groups = useMemo(() => {
    const map = new Map<number, MarketRow[]>();
    for (const m of markets ?? []) {
      map.set(m.fixtureId, [...(map.get(m.fixtureId) ?? []), m]);
    }
    return [...map.entries()].sort(
      (a, b) => (b[1][0].fixture?.start ?? 0) - (a[1][0].fixture?.start ?? 0)
    );
  }, [markets]);

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px 60px" }}>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>
        on<span style={{ color: C.cyan }}>side</span> <span style={{ fontWeight: 400 }}>viewer</span>
      </h1>
      <p style={{ color: C.dim, fontSize: 13.5, lineHeight: 1.6 }}>
        Read-only view of every Onside market on Solana devnet. Prediction markets over live
        World Cup streams, settled <b style={{ color: C.ink }}>trustlessly</b>: outcomes are
        proven with TxODDS TxLINE Merkle proofs verified on-chain — no oracle multisig, no
        admin key. Programs:{" "}
        <a href={explorerAddr(ONSIDE_PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer" style={{ color: C.cyan }}>
          onside ↗
        </a>{" "}
        ·{" "}
        <a href={explorerAddr(TXORACLE_PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer" style={{ color: C.cyan }}>
          txoracle ↗
        </a>
      </p>

      {error && <p style={{ color: C.red }}>RPC error: {error}</p>}
      {!markets && !error && <p style={{ color: C.dim }}>loading markets from devnet…</p>}

      {groups.map(([fixtureId, ms]) => {
        const fx = ms[0].fixture;
        const lv = live[String(fixtureId)];
        const started = lv && lv.phase > 1;
        return (
          <section key={fixtureId} style={{ marginTop: 26 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
              <h2 style={{ fontSize: 17, margin: 0 }}>
                {fx ? `${fx.home} vs ${fx.away}` : `Fixture #${fixtureId}`}
              </h2>
              {started && (
                <b style={{ color: lv.final ? C.dim : C.green, fontSize: 15 }}>
                  {lv.score.home}–{lv.score.away}
                  <span style={{ fontWeight: 400, fontSize: 12 }}> · {lv.phaseLabel}</span>
                </b>
              )}
              <span style={{ marginLeft: "auto", fontSize: 11, color: C.dim }}>
                {fx && new Date(fx.start).toUTCString().replace(":00 GMT", " UTC")}
              </span>
            </div>
            {ms.map((m) => (
              <MarketCard key={m.address.toBase58()} m={m} />
            ))}
          </section>
        );
      })}

      <p style={{ color: C.dim, fontSize: 11, marginTop: 40, borderTop: `1px solid ${C.stroke}`, paddingTop: 12 }}>
        Onside — TxODDS World Cup Hackathon 2026 · markets live in a browser extension over
        ceskatelevize.cz / tv.nova.cz / tipsport.cz / YouTube streams · fixture data &amp;
        settlement proofs by TxLINE · live scores appear when a local data proxy is running
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
