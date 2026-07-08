import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Keypair } from "@solana/web3.js";
import { airdropSol, balances, faucet } from "../chain/onside";
import { createWallet, loadWallet } from "../chain/wallet";

const cyan = "#22d3ee";
const green = "#34d399";
const dim = "#8aa0af";

const btn: React.CSSProperties = {
  width: "100%",
  border: "none",
  borderRadius: 10,
  padding: "11px 12px",
  fontWeight: 800,
  fontSize: 13,
  cursor: "pointer",
  marginTop: 8,
};

function Popup() {
  const [wallet, setWallet] = useState<Keypair | null>(null);
  const [bal, setBal] = useState<{ sol: number; usdc: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const w = await loadWallet();
    setWallet(w);
    if (w) setBal(await balances(w.publicKey));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function run(name: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(name);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      await refresh();
    } catch (e: any) {
      setMsg(`${name} failed: ${(e.error?.errorMessage ?? e.message ?? e).slice(0, 80)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 19, margin: "0 0 2px" }}>
        on<span style={{ color: cyan }}>side</span>
      </h1>
      <p style={{ fontSize: 11.5, color: dim, margin: "0 0 12px" }}>
        Prediction markets, played live · Solana devnet
      </p>

      {!wallet ? (
        <>
          <p style={{ fontSize: 12.5, color: dim, lineHeight: 1.5 }}>
            Create a <b style={{ color: "#eaf2f7" }}>demo wallet</b> — a throwaway devnet
            keypair stored in this extension. Free devnet SOL + test USDC included.
            No real money anywhere.
          </p>
          <button
            style={{ ...btn, background: cyan, color: "#04222a" }}
            disabled={busy !== null}
            onClick={() =>
              run(
                "create",
                async () => {
                  const w = await createWallet();
                  await airdropSol(w.publicKey).catch(() => {
                    throw new Error(
                      "wallet created, but devnet SOL airdrop is rate-limited — use faucet.solana.com"
                    );
                  });
                  await faucet(w, 100);
                },
                "Demo wallet ready: 1 SOL + 100 tUSDC ✅ Open a match stream!"
              )
            }
          >
            {busy === "create" ? "Setting up…" : "CREATE DEMO WALLET"}
          </button>
        </>
      ) : (
        <>
          <div
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 10,
              padding: 12,
            }}
          >
            <div style={{ fontSize: 10.5, color: dim, letterSpacing: 1 }}>DEMO WALLET</div>
            <div style={{ fontSize: 11, wordBreak: "break-all", margin: "4px 0 8px" }}>
              {wallet.publicKey.toBase58()}
            </div>
            <div style={{ display: "flex", gap: 16 }}>
              <div>
                <div style={{ fontSize: 10.5, color: dim }}>SOL</div>
                <div style={{ fontWeight: 800 }}>{bal ? bal.sol.toFixed(3) : "…"}</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: dim }}>test USDC</div>
                <div style={{ fontWeight: 800, color: green }}>
                  {bal ? `$${bal.usdc.toFixed(2)}` : "…"}
                </div>
              </div>
            </div>
          </div>

          <button
            style={{ ...btn, background: green, color: "#022" }}
            disabled={busy !== null}
            onClick={() => run("faucet", () => faucet(wallet, 100), "+100 tUSDC minted ✅")}
          >
            {busy === "faucet" ? "Minting…" : "GET 100 TEST USDC"}
          </button>
          <button
            style={{ ...btn, background: "rgba(255,255,255,0.08)", color: "#eaf2f7" }}
            disabled={busy !== null}
            onClick={() =>
              run("airdrop", () => airdropSol(wallet.publicKey), "+1 devnet SOL ✅")
            }
          >
            {busy === "airdrop" ? "Requesting…" : "AIRDROP 1 SOL (fees)"}
          </button>

          <p style={{ fontSize: 11, color: dim, marginTop: 12, lineHeight: 1.5 }}>
            Now open a football stream (e.g. a YouTube match) — the Onside overlay
            appears on the page. Bet, watch, claim.
          </p>
        </>
      )}

      {msg && (
        <div
          style={{
            marginTop: 10,
            fontSize: 11.5,
            border: `1px solid ${cyan}`,
            borderRadius: 8,
            padding: "8px 10px",
            color: "#eaf2f7",
          }}
        >
          {msg}
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Popup />);
