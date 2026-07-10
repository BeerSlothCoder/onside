// Locate the page's main <video> (the stream) and notice when it changes —
// stream sites swap player elements on route changes and quality switches.

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

/** Poll for the main video; fires cb whenever it changes. Returns a stop function. */
export function watchMainVideo(cb: (video: HTMLVideoElement | null) => void): () => void {
  let current: HTMLVideoElement | null = null;
  const check = () => {
    const v = findMainVideo();
    if (v !== current) {
      current = v;
      cb(v);
    }
  };
  check();
  const iv = setInterval(check, 2000);
  return () => clearInterval(iv);
}
