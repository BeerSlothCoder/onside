import React, { useEffect, useState } from "react";
import type { ReadbackResult } from "../types";
import type { DetectorState } from "../useDetector";
import { detectorReady, tensorCount } from "../detector";
import { BRAND, MONO_FONT } from "../../overlay/brand";

/**
 * Tiny diagnostics panel (shift-click the 🎯 label to toggle):
 * probe verdict, detector state, track count, inference time / rate,
 * and the tfjs tensor count — if that number climbs over time we leak GPU memory.
 */
export function DebugHud(props: {
  probe: ReadbackResult | null;
  detState: DetectorState;
  trackCount: number;
  inferMs: number;
}) {
  const [tensors, setTensors] = useState<number | null>(null);

  useEffect(() => {
    const iv = setInterval(() => {
      setTensors(detectorReady() ? tensorCount() : null);
    }, 2000);
    return () => clearInterval(iv);
  }, []);

  const cycleMs = Math.max(130, props.inferMs + 16);
  return (
    <div
      style={{
        position: "absolute",
        left: 16,
        bottom: 64,
        zIndex: 2147483646,
        pointerEvents: "none",
        background: BRAND.panel,
        border: `1px solid ${BRAND.border}`,
        color: BRAND.cyan,
        fontFamily: MONO_FONT,
        fontSize: 10.5,
        padding: "7px 10px",
        borderRadius: BRAND.radiusControl,
        lineHeight: 1.65,
        whiteSpace: "nowrap",
      }}
    >
      probe: {props.probe ?? "…"} · det: {props.detState}
      <br />
      tracks: {props.trackCount} · infer: {props.inferMs}ms (~{(1000 / cycleMs).toFixed(1)} Hz)
      <br />
      tf tensors: {tensors ?? "—"}
      <br />
      frame: {window.top === window ? "top" : "iframe"} · {location.hostname}
    </div>
  );
}
