import React from "react";
import { createRoot } from "react-dom/client";

/**
 * Onside viewer — read-only judge aid.
 * Lists on-chain markets, pool states and, for settled markets, the
 * settlement transaction with its decoded TxLINE Merkle validation.
 */
function App() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 32 }}>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>
        on<span style={{ color: "#22d3ee" }}>side</span> viewer
      </h1>
      <p style={{ color: "#8aa0af" }}>
        Read-only view of Onside devnet markets and their TxLINE
        Merkle-proof settlements. Market list loads here once the program is
        deployed and the crank publishes fixtures.
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
