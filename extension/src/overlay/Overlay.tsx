import React, { useState } from "react";

/**
 * Onside overlay shell — market widget rendered over the stream.
 * v0: static placeholder proving the mount; markets/live data land next.
 */
export function Overlay() {
  const [open, setOpen] = useState(true);

  return (
    <div
      style={{
        pointerEvents: "auto",
        margin: 16,
        width: 300,
        fontFamily: "system-ui, sans-serif",
        color: "#eaf2f7",
        background: "rgba(10,16,22,0.92)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 12,
        boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          cursor: "pointer",
          background: "rgba(255,255,255,0.04)",
        }}
        onClick={() => setOpen(!open)}
      >
        <strong style={{ fontSize: 15 }}>
          on<span style={{ color: "#22d3ee" }}>side</span>
        </strong>
        <span style={{ fontSize: 11, color: "#8aa0af" }}>
          prediction markets, played live
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12 }}>{open ? "−" : "+"}</span>
      </div>
      {open && (
        <div style={{ padding: 14, fontSize: 13, lineHeight: 1.5 }}>
          <p style={{ margin: 0, color: "#8aa0af" }}>
            Markets load here once the crank publishes fixtures from TxLINE.
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 11, color: "#5f7280" }}>
            devnet · settled by TxLINE Merkle proofs
          </p>
        </div>
      )}
    </div>
  );
}
