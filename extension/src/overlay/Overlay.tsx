import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { Keypair } from "@solana/web3.js";
import {
  balances,
  BetView,
  claim,
  fetchMarkets,
  fetchMyBets,
  impliedOdds,
  MarketView,
  placeBet,
} from "../chain/onside";
import { loadWallet, onWalletChange } from "../chain/wallet";

const C = {
  bg: "rgba(10,16,22,0.94)",
  stroke: "rgba(255,255,255,0.14)",
  cyan: "#22d3ee",
  green: "#34d399",
  red: "#f87171",
  dim: "#8aa0af",
  ink: "#eaf2f7",
};

const btn: React.CSSProperties = {
  border: "none",
  borderRadius: 8,
  padding: "7px 10px",
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
};

export function Overlay() {
  const [open, setOpen] = useState(true);
  const [wallet, setWallet] = useState<Keypair | null>(null);
  const [bal, setBal] = useState<{ sol: number; usdc: number } | null>(null);
  const [markets, setMarkets] = useState<MarketView[]>([]);
  const [bets, setBets] = useState<BetView[]>([]);
  const [selected, setSelected] = useState<{ m: MarketView; side: number } | null>(null);
  const [stake, setStake] = useState(5);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const refresh = useCallback(async () => {
    try {
      const w = await loadWallet();
      setWallet(w);
      const ms = await fetchMarkets();
      setMarkets(ms);
      if (w) {
        setBal(await balances(w.publicKey));
        setBets(await fetchMyBets(w.publicKey));
      }
    } catch (e) {
      console.warn("onside refresh failed", e);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    onWalletChange(refresh);
    return () => clearInterval(t);
  }, [refresh]);

  const betByMarket = useMemo(() => {
    const map = new Map<string, BetView>();
    for (const b of bets) map.set(b.market.toBase58(), b);
    return map;
  }, [bets]);

  async function submitBet() {
    if (!wallet || !selected) return;
    setBusy("bet");
    try {
      await placeBet(wallet, selected.m, selected.side, stake);
      flash(`Bet locked: $${stake} on ${selected.m.sideLabels[selected.side]}`);
      setSelected(null);
      await refresh();
    } catch (e: any) {
      flash(`Bet failed: ${(e.message ?? e).slice(0, 60)}`);
    } finally {
      setBusy(null);
    }
  }

  async function submitClaim(m: MarketView) {
    if (!wallet) return;
    setBusy(m.address.toBase58());
    try {
      await claim(wallet, m);
      flash("Winnings claimed 🎉");
      await refresh();
    } catch (e: any) {
      flash(`Claim failed: ${(e.error?.errorMessage ?? e.message ?? e).slice(0, 60)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      style={{
        pointerEvents: "auto",
        margin: 16,
        width: 320,
        maxHeight: "80vh",
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, sans-serif",
        color: C.ink,
        background: C.bg,
        border: `1px solid ${C.stroke}`,
        borderRadius: 14,
        boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
        overflow: "hidden",
        fontSize: 13,
      }}
    >
      {/* header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          cursor: "pointer",
          background: "rgba(255,255,255,0.04)",
          flexShrink: 0,
        }}
        onClick={() => setOpen(!open)}
      >
        <strong style={{ fontSize: 15 }}>
          on<span style={{ color: C.cyan }}>side</span>
        </strong>
        <span style={{ fontSize: 10.5, color: C.dim }}>played live · devnet</span>
        {bal && (
          <span style={{ marginLeft: "auto", fontSize: 12, color: C.green, fontWeight: 700 }}>
            ${bal.usdc.toFixed(2)}
          </span>
        )}
        <span style={{ marginLeft: bal ? 6 : "auto", fontSize: 12 }}>{open ? "−" : "+"}</span>
      </div>

      {open && (
        <div style={{ overflowY: "auto", padding: 12 }}>
          {!wallet && (
            <div style={{ color: C.dim, lineHeight: 1.5 }}>
              No demo wallet yet — click the <b style={{ color: C.ink }}>Onside icon</b> in
              your toolbar and create one (takes ~30 s, free devnet funds included).
            </div>
          )}

          {wallet && markets.length === 0 && (
            <div style={{ color: C.dim }}>No markets published yet — check back at kickoff.</div>
          )}

          {markets.map((m) => {
            const myBet = betByMarket.get(m.address.toBase58());
            const title = m.fixture
              ? `${m.fixture.home} vs ${m.fixture.away}`
              : `Fixture #${m.fixtureId}`;
            const now = Date.now() / 1000;
            const claimable =
              m.state === "settled" &&
              myBet &&
              !myBet.claimed &&
              myBet.side === m.outcome &&
              now >= m.claimAfter;
            return (
              <div
                key={m.address.toBase58()}
                style={{
                  border: `1px solid ${C.stroke}`,
                  borderRadius: 10,
                  padding: 10,
                  marginBottom: 10,
                  background: "rgba(255,255,255,0.03)",
                }}
              >
                <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                  <b style={{ fontSize: 13 }}>{title}</b>
                  <span style={{ marginLeft: "auto", fontSize: 10, color: C.dim, textTransform: "uppercase" }}>
                    {m.state}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: C.dim, margin: "2px 0 8px" }}>
                  {m.kindLabel}
                  {m.kind === "statOver" ? ` ${m.threshold}.5` : ""} · pool ${m.totalPool.toFixed(2)}
                </div>

                {/* sides */}
                <div style={{ display: "flex", gap: 6 }}>
                  {m.sideLabels.map((label, i) => {
                    const odds = impliedOdds(m, i);
                    const isOutcome = m.state === "settled" && m.outcome === i;
                    const sel = selected?.m.address.equals(m.address) && selected.side === i;
                    return (
                      <button
                        key={i}
                        disabled={m.state !== "open" || !wallet}
                        onClick={() => setSelected(sel ? null : { m, side: i })}
                        style={{
                          ...btn,
                          flex: 1,
                          background: sel
                            ? C.cyan
                            : isOutcome
                              ? "rgba(52,211,153,0.2)"
                              : "rgba(255,255,255,0.06)",
                          color: sel ? "#04222a" : isOutcome ? C.green : C.ink,
                          border: `1px solid ${sel ? C.cyan : C.stroke}`,
                          opacity: m.state !== "open" && !isOutcome ? 0.55 : 1,
                        }}
                      >
                        <div>{label}</div>
                        <div style={{ fontSize: 10, opacity: 0.8 }}>
                          ${m.pools[i]?.toFixed(2) ?? "0.00"}
                          {odds ? ` · ${odds.toFixed(2)}x` : ""}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* bet slip */}
                {selected?.m.address.equals(m.address) && m.state === "open" && (
                  <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
                    {[1, 5, 10, 25].map((v) => (
                      <button
                        key={v}
                        onClick={() => setStake(v)}
                        style={{
                          ...btn,
                          padding: "5px 8px",
                          background: stake === v ? C.cyan : "rgba(255,255,255,0.06)",
                          color: stake === v ? "#04222a" : C.ink,
                        }}
                      >
                        ${v}
                      </button>
                    ))}
                    <button
                      onClick={submitBet}
                      disabled={busy === "bet"}
                      style={{ ...btn, marginLeft: "auto", background: C.green, color: "#022" }}
                    >
                      {busy === "bet" ? "…" : "PLACE BET"}
                    </button>
                  </div>
                )}

                {/* my bet status */}
                {myBet && (
                  <div style={{ marginTop: 8, fontSize: 11.5, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: C.dim }}>
                      Your bet: ${myBet.amount.toFixed(2)} on {m.sideLabels[myBet.side]}
                    </span>
                    {m.state === "settled" && (
                      <span style={{ color: myBet.side === m.outcome ? C.green : C.red, fontWeight: 700 }}>
                        {myBet.claimed ? "PAID" : myBet.side === m.outcome ? "WON" : "LOST"}
                      </span>
                    )}
                    {claimable && (
                      <button
                        onClick={() => submitClaim(m)}
                        disabled={busy === m.address.toBase58()}
                        style={{ ...btn, marginLeft: "auto", background: C.green, color: "#022", padding: "4px 10px" }}
                      >
                        {busy === m.address.toBase58() ? "…" : "CLAIM"}
                      </button>
                    )}
                    {m.state === "settled" &&
                      myBet.side === m.outcome &&
                      !myBet.claimed &&
                      now < m.claimAfter && (
                        <span style={{ color: C.dim, marginLeft: "auto", fontSize: 10 }}>
                          claim opens {new Date(m.claimAfter * 1000).toLocaleTimeString()}
                        </span>
                      )}
                  </div>
                )}
              </div>
            );
          })}

          <div style={{ fontSize: 10, color: C.dim, textAlign: "center", marginTop: 4 }}>
            settled trustlessly by TxLINE Merkle proofs on Solana
          </div>
        </div>
      )}

      {toast && (
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 12,
            right: 12,
            background: "rgba(4,34,42,0.95)",
            border: `1px solid ${C.cyan}`,
            color: C.ink,
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 12,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
