import React, { useEffect, useState } from "react";
import type { Lineups } from "../types";
import { VideoOverlay } from "./VideoOverlay";
import { BRAND } from "../../overlay/brand";

interface MatchCtx {
  fixtureId: number;
  teams: { home: string; away: string };
  lineups: Lineups | null;
}

/**
 * Minimal tracker UI for player IFRAMES (e.g. media.cms.nova.cz embeds).
 * Inside the frame we can reach the real <video>, so pins anchor to the
 * picture and the readback probe gives a real verdict. The active match
 * (teams + lineups) is shared by the top-frame panel via extension storage.
 */
export function FrameTracker() {
  const [on, setOn] = useState(false);
  const [ctx, setCtx] = useState<MatchCtx | null>(null);

  useEffect(() => {
    const apply = (v: unknown) => setCtx((v as MatchCtx) ?? null);
    try {
      chrome.storage.local.get("onside_match_ctx").then((r) => apply(r.onside_match_ctx));
      const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area === "local" && changes.onside_match_ctx) apply(changes.onside_match_ctx.newValue);
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    } catch {
      /* orphaned script after extension reload */
    }
  }, []);

  if (!on) {
    return (
      <button
        onClick={() => setOn(true)}
        title="Onside — pin players on the video"
        style={{
          position: "absolute",
          left: 12,
          bottom: 12,
          zIndex: 2147483646,
          pointerEvents: "auto",
          border: `1px solid ${BRAND.border}`,
          background: BRAND.panel,
          color: BRAND.text,
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
      lineups={ctx?.lineups ?? { home: [], away: [] }}
      teams={ctx?.teams ?? { home: "Home", away: "Away" }}
      flash={() => undefined}
      onClose={() => setOn(false)}
    />
  );
}
