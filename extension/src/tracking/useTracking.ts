// State owner for the sticky-chips feature: main video, readback probe result,
// and the manual pin list. The CV engine (detector + tracker) plugs in here later.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Assignment, Pin, ReadbackResult } from "./types";
import { probeReadback } from "./capture";
import { watchMainVideo } from "./videoFinder";

export function useTracking(active: boolean) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [probe, setProbe] = useState<ReadbackResult | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const nextId = useRef(1);

  useEffect(() => {
    if (!active) {
      setVideo(null);
      setProbe(null);
      return;
    }
    return watchMainVideo(setVideo);
  }, [active]);

  useEffect(() => {
    if (!active || !video) return;
    let cancelled = false;
    setProbe(null);
    // give a just-swapped video a moment to start decoding
    const t = setTimeout(() => {
      probeReadback(video).then((r) => {
        if (!cancelled) setProbe(r);
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [active, video]);

  const addPin = useCallback((u: number, v: number): number => {
    const id = nextId.current++;
    setPins((ps) => [...ps, { id, u, v, assignment: null }]);
    return id;
  }, []);

  const assignPin = useCallback((id: number, assignment: Assignment | null) => {
    setPins((ps) => ps.map((p) => (p.id === id ? { ...p, assignment } : p)));
  }, []);

  const removePin = useCallback((id: number) => {
    setPins((ps) => ps.filter((p) => p.id !== id));
  }, []);

  const clearPins = useCallback(() => setPins([]), []);

  return { video, probe, pins, addPin, assignPin, removePin, clearPins };
}
