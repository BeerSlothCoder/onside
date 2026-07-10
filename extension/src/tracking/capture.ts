// Canvas-readback capability probe. Decides whether full CV tracking (Tier A)
// is possible on this stream or we stay on manual pins (Tier B).
import type { ReadbackResult } from "./types";

/**
 * Draw a few frames to a tiny canvas and inspect them:
 *  - SecurityError on getImageData  → tainted (cross-origin non-MSE source)
 *  - near-zero luminance + variance → black (DRM decode surface)
 *  - anything with signal           → ok
 */
export async function probeReadback(video: HTMLVideoElement): Promise<ReadbackResult> {
  if (!video || video.readyState < 2) return "novideo";
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 36;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "novideo";

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      ctx.drawImage(video, 0, 0, 64, 36);
      const data = ctx.getImageData(0, 0, 64, 36).data;
      let sum = 0;
      let sumSq = 0;
      const n = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        sum += y;
        sumSq += y * y;
      }
      const mean = sum / n;
      const variance = sumSq / n - mean * mean;
      if (variance > 20 || mean > 16) return "ok";
    } catch {
      return "tainted";
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return "black";
}
