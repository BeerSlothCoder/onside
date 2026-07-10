import React, { useState } from "react";
import { VideoOverlay } from "./VideoOverlay";

/**
 * Minimal tracker UI for player IFRAMES (e.g. media.cms.nova.cz embeds).
 * Inside the frame we can reach the real <video>, so pins anchor to the
 * picture and the readback probe gives a real verdict. Market data / lineups
 * live in the top frame — this uses placeholder XIs until state is shared.
 */
export function FrameTracker() {
  const [on, setOn] = useState(false);

  if (!on) {
    return (
      <button
        onClick={() => setOn(true)}
        title="Onside — pin players on the video"
        style={{
          position: "fixed",
          left: 12,
          bottom: 12,
          zIndex: 2147483646,
          pointerEvents: "auto",
          border: "1px solid rgba(255,255,255,0.25)",
          background: "rgba(10,16,22,0.85)",
          color: "#eaf2f7",
          borderRadius: 999,
          width: 34,
          height: 34,
          fontSize: 15,
          cursor: "pointer",
          boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
        }}
      >
        🎯
      </button>
    );
  }

  return (
    <VideoOverlay
      lineups={{ home: [], away: [] }}
      teams={{ home: "Home", away: "Away" }}
      flash={() => undefined}
      onClose={() => setOn(false)}
    />
  );
}
