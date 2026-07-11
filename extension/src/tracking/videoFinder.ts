// Locate the page's main <video> (the stream) and notice when it changes —
// stream sites swap player elements on route changes and quality switches.
// Some sites (Nova) embed the player in a cross-origin iframe: we can't reach
// the video inside it, but we can still anchor pins to the iframe's box.
import type { Anchor } from "./types";

export function findMainVideo(): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  let bestScore = 0;
  for (const v of Array.from(document.querySelectorAll("video"))) {
    const r = v.getBoundingClientRect();
    const area = r.width * r.height;
    if (area < 200 * 112) continue; // ignore thumbnails / preview tiles
    let score = area;
    if (!v.paused && !v.ended) score *= 4;
    if (v.readyState >= 2) score *= 2;
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return best;
}

function findMainIframe(): HTMLIFrameElement | null {
  let best: HTMLIFrameElement | null = null;
  let bestScore = 0;
  for (const f of Array.from(document.querySelectorAll("iframe"))) {
    const r = f.getBoundingClientRect();
    const area = r.width * r.height;
    if (area < 320 * 180) continue; // ignore ads / widgets
    // page-sized containers (consent walls, ad wrappers) are not the player
    if (r.width > innerWidth * 0.95 && r.height > innerHeight * 0.9) continue;
    let score = area;
    const ratio = r.width / Math.max(r.height, 1);
    if (ratio > 1.3 && ratio < 2.2) score *= 3; // video-shaped
    if (/player|embed|media|video|stream|live/i.test(f.src)) score *= 3;
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}

export function findAnchor(): Anchor | null {
  const v = findMainVideo();
  if (v) return { el: v, kind: "video" };
  const f = findMainIframe();
  if (f) return { el: f, kind: "iframe" };
  return null;
}

/** Poll for the anchor element; fires cb whenever it changes. Returns a stop function. */
export function watchAnchor(cb: (anchor: Anchor | null) => void): () => void {
  let current: Anchor["el"] | null = null;
  const check = () => {
    const a = findAnchor();
    if ((a?.el ?? null) !== current) {
      current = a?.el ?? null;
      cb(a);
    }
  };
  check();
  const iv = setInterval(check, 2000);
  return () => clearInterval(iv);
}
