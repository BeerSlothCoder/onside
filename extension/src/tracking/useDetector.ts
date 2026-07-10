// Detection loop hook: runs YOLO on the anchored <video> at ~5–8 Hz,
// skip-if-busy, feeds detections through the ByteTrack-lite tracker and
// exposes tracks with persistent identities.
import { useEffect, useRef, useState } from "react";
import type { Track } from "./types";
import { detect, initDetector } from "./detector";
import { ByteTracker } from "./tracker";

export type DetectorState = "off" | "loading" | "running" | "error";

const MIN_INTERVAL_MS = 130; // ≈7.7 Hz ceiling

export function useDetector(video: HTMLVideoElement | null, enabled: boolean) {
  const [state, setState] = useState<DetectorState>("off");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [inferMs, setInferMs] = useState(0);
  const errors = useRef(0);
  const tracker = useRef(new ByteTracker());

  useEffect(() => {
    if (!enabled || !video) {
      setState("off");
      setTracks([]);
      return;
    }
    let stopped = false;
    errors.current = 0;
    tracker.current.reset();
    setState("loading");

    (async () => {
      try {
        await initDetector();
      } catch (e) {
        console.warn("onside: detector init failed", e);
        if (!stopped) setState("error");
        return;
      }
      if (stopped) return;
      setState("running");

      while (!stopped) {
        const t0 = performance.now();
        try {
          if (video.readyState >= 2 && !video.ended) {
            const d = await detect(video);
            if (stopped) break;
            setTracks(tracker.current.update(d, performance.now()));
            setInferMs(Math.round(performance.now() - t0));
            errors.current = 0;
          }
        } catch (e) {
          if (++errors.current > 3) {
            console.warn("onside: detector failing repeatedly", e);
            if (!stopped) setState("error");
            break;
          }
        }
        const elapsed = performance.now() - t0;
        await new Promise((r) => setTimeout(r, Math.max(MIN_INTERVAL_MS - elapsed, 16)));
      }
    })();

    return () => {
      stopped = true;
    };
  }, [enabled, video]);

  return { state, tracks, inferMs };
}
