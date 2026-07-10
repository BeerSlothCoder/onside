// Onside Day-0 feasibility probe — CAN WE READ VIDEO FRAMES ON THIS SITE?
//
// How to use: open a playing stream (ČT24 live, iVysílání, Voyo, YouTube match
// replay), press F12 → Console, paste this whole file, press Enter.
//
// Result meanings:
//   OK ✅      → frames readable → full CV player tracking (Tier A) works here
//   BLACK ⬛   → DRM (Widevine) → manual pins only (Tier B)
//   TAINTED 🚫 → cross-origin source → manual pins only (Tier B)
//
// Please run it on: ceskatelevize.cz (ČT24 live + a sport archive video),
// tv.nova.cz / Voyo, tipsport.cz TV, and a YouTube full-match replay —
// and report the console output for each.
(async () => {
  const v = [...document.querySelectorAll("video")].sort(
    (a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight
  )[0];
  if (!v) return console.log("ONSIDE PROBE: no <video> found on this page");
  console.log(
    "ONSIDE PROBE:", location.hostname,
    "| video", v.videoWidth + "x" + v.videoHeight,
    "| readyState", v.readyState,
    "| playing", !v.paused,
    "| rVFC", "requestVideoFrameCallback" in v
  );
  const c = document.createElement("canvas");
  c.width = 64; c.height = 36;
  const x = c.getContext("2d", { willReadFrequently: true });
  for (let i = 0; i < 3; i++) {
    try {
      x.drawImage(v, 0, 0, 64, 36);
      const d = x.getImageData(0, 0, 64, 36).data;
      let s = 0, q = 0;
      const n = d.length / 4;
      for (let j = 0; j < d.length; j += 4) {
        const y = 0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2];
        s += y; q += y * y;
      }
      const mean = s / n, variance = q / n - mean * mean;
      const ok = variance > 20 || mean > 16;
      console.log(
        `  frame ${i}: mean=${mean.toFixed(1)} var=${variance.toFixed(1)} →`,
        ok ? "OK ✅ (readback works — CV tracking possible)" : "BLACK ⬛ (likely DRM)"
      );
      if (ok) return;
    } catch (e) {
      return console.log("  TAINTED 🚫 (cross-origin, canvas blocked):", e.name);
    }
    await new Promise((r) => setTimeout(r, 700));
  }
})();
