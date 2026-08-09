// Detection loop hook: runs YOLO on the anchored <video> at ~5–8 Hz,
// skip-if-busy, feeds person detections through the ByteTrack-lite tracker
// and ball detections through the single-target BallTracker, exposing both.
import { useEffect, useRef, useState } from "react";
import type { BallTrack, Track } from "./types";
import { detect, initDetector } from "./detector";
import { ByteTracker, BallTracker } from "./tracker";

export type DetectorState = "off" | "loading" | "running" | "error";

const MIN_INTERVAL_MS = 130; // ≈7.7 Hz ceiling

export function useDetector(video: HTMLVideoElement | null, enabled: boolean) {
  const [state, setState] = useState<DetectorState>("off");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [ball, setBall] = useState<BallTrack | null>(null);
  const [inferMs, setInferMs] = useState(0);
  const errors = useRef(0);
  const tracker = useRef(new ByteTracker());
  const ballTracker = useRef(new BallTracker());

  useEffect(() => {
    if (!enabled || !video) {
      setState("off");
      setTracks([]);
      setBall(null);
      return;
    }
    let stopped = false;
    errors.current = 0;
    tracker.current.reset();
    ballTracker.current.reset();
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
            const now = performance.now();
            setTracks(tracker.current.update(d.persons, now));
            setBall(ballTracker.current.update(d.balls, now));
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

  return { state, tracks, ball, inferMs };
}
