// Pure coordinate math: where the actual video picture sits inside the <video>
// element box (letterboxing), and mapping between normalized video-content
// coordinates (0..1) and viewport pixels.

import type { Anchor } from "./types";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Layer rect for whatever we're anchored to: letterbox-aware for <video>, plain box for iframes. */
export function anchorRect(anchor: Anchor): Rect | null {
  if (anchor.kind === "video") return contentRect(anchor.el as HTMLVideoElement);
  const box = anchor.el.getBoundingClientRect();
  if (box.width < 2 || box.height < 2) return null;
  return { left: box.left, top: box.top, width: box.width, height: box.height };
}

/**
 * Displayed video-content area in viewport px. The UA default for <video> is
 * object-fit: contain, so a 16:9 stream inside a wider element gets pillarboxed —
 * chips must anchor to the picture, not the element box.
 */
export function contentRect(video: HTMLVideoElement): Rect | null {
  const box = video.getBoundingClientRect();
  if (box.width < 2 || box.height < 2) return null;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return { left: box.left, top: box.top, width: box.width, height: box.height };

  const fit = getComputedStyle(video).objectFit;
  if (fit === "fill" || fit === "none") {
    return { left: box.left, top: box.top, width: box.width, height: box.height };
  }
  const scale =
    fit === "cover"
      ? Math.max(box.width / vw, box.height / vh)
      : Math.min(box.width / vw, box.height / vh); // contain / scale-down (default)
  const width = vw * scale;
  const height = vh * scale;
  return {
    left: box.left + (box.width - width) / 2,
    top: box.top + (box.height - height) / 2,
    width,
    height,
  };
}

/** Viewport px → normalized content coords; null when the point is outside the picture. */
export function viewportToNorm(x: number, y: number, r: Rect): { u: number; v: number } | null {
  const u = (x - r.left) / r.width;
  const v = (y - r.top) / r.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u, v };
}

export function rectsDiffer(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a !== b;
  return (
    Math.abs(a.left - b.left) > 0.5 ||
    Math.abs(a.top - b.top) > 0.5 ||
    Math.abs(a.width - b.width) > 0.5 ||
    Math.abs(a.height - b.height) > 0.5
  );
}
