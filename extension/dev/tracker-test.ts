// Synthetic sanity test for ByteTracker — run: npx tsx extension/dev/tracker-test.ts
// Scenarios: two players crossing, occlusion re-match, low-confidence rescue.
import { ByteTracker } from "../src/tracking/tracker";

const box = (u: number, v: number) => ({ u, v, w: 0.03, h: 0.08, score: 0.85 });
let t = 0;
const step = () => (t += 140); // ~7 Hz

// --- scenario 1: two players crossing horizontally ---
{
  const tr = new ByteTracker();
  const seen = new Set<number>();
  for (let i = 0; i < 30; i++) {
    const a = box(0.2 + i * 0.02, 0.5); // left → right
    const b = box(0.8 - i * 0.02, 0.52); // right → left
    tr.update([a, b], step()).forEach((x) => seen.add(x.id));
  }
  console.log("crossing: distinct ids =", seen.size, "(want 2 — id swap at cross acceptable, churn not)");
  if (seen.size !== 2) throw new Error("crossing scenario churned track ids");
}

// --- scenario 2: occlusion — player vanishes 12 cycles, reappears on path ---
{
  const tr = new ByteTracker();
  let id0 = -1;
  for (let i = 0; i < 10; i++) {
    const tracks = tr.update([box(0.3 + i * 0.01, 0.4)], step());
    if (tracks.length) id0 = tracks[0].id;
  }
  for (let i = 0; i < 12; i++) tr.update([], step()); // occluded ~1.7 s
  let idBack = -2;
  for (let i = 0; i < 4; i++) {
    const tracks = tr.update([box(0.3 + (10 + 12 + i) * 0.01, 0.4)], step());
    if (tracks.length) idBack = tracks[0].id;
  }
  console.log("occlusion: id before =", id0, "after =", idBack, id0 === idBack ? "✅" : "❌");
  if (id0 !== idBack) throw new Error("occlusion re-match failed");
}

// --- scenario 3: low-confidence rescue (partial occlusion) ---
{
  const tr = new ByteTracker();
  let id0 = -1;
  for (let i = 0; i < 5; i++) {
    const tracks = tr.update([box(0.5, 0.5)], step());
    if (tracks.length) id0 = tracks[0].id;
  }
  let stillThere = false;
  for (let i = 0; i < 5; i++) {
    const tracks = tr.update([{ ...box(0.5, 0.5), score: 0.3 }], step());
    stillThere = tracks.some((x) => x.id === id0 && !x.coasting);
  }
  console.log("low-conf rescue:", stillThere ? "✅" : "❌");
  if (!stillThere) throw new Error("low-confidence rescue failed");
}

console.log("\nAll tracker scenarios passed ✅");
