// ByteTrack-lite: persistent player identities from per-frame detections.
// Greedy IoU association with high/low confidence buckets (the ByteTrack
// insight: low-confidence boxes "rescue" briefly-occluded tracks), simple
// constant-velocity prediction, and an occlusion buffer so identities
// survive players crossing or being blocked for a few seconds.
// Dependency-free, all coordinates normalized (0..1).
import type { BallTrack, Detection, Track } from "./types";

const HIGH_CONF = 0.5;
const IOU_MATCH = 0.2; // generous — boxes are small and fast on wide shots
const CONFIRM_HITS = 2; // detections needed before a track renders
const RENDER_MISSED = 4; // cycles a track keeps rendering while coasting
const MAX_MISSED = 30; // cycles a lost track stays eligible for re-match
const VELOCITY_BLEND = 0.5;

interface TState {
  id: number;
  u: number;
  v: number;
  w: number;
  h: number;
  vu: number; // center velocity, units/sec
  vv: number;
  score: number;
  hits: number;
  missed: number;
  lastTs: number;
}

function iou(a: { u: number; v: number; w: number; h: number }, b: typeof a): number {
  const x1 = Math.max(a.u, b.u);
  const y1 = Math.max(a.v, b.v);
  const x2 = Math.min(a.u + a.w, b.u + b.w);
  const y2 = Math.min(a.v + a.h, b.v + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter <= 0) return 0;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

/** Predicted box for a track at time `now` (center moves, size held). */
function predict(t: TState, now: number) {
  const dt = Math.min(Math.max((now - t.lastTs) / 1000, 0), 0.6);
  return { u: t.u + t.vu * dt, v: t.v + t.vv * dt, w: t.w, h: t.h };
}

/** Greedy best-IoU matching between track predictions and detections. */
function greedyMatch(
  tracks: TState[],
  dets: Detection[],
  now: number
): Array<[TState, Detection]> {
  const pairs: Array<{ t: TState; d: Detection; iou: number }> = [];
  for (const t of tracks) {
    const p = predict(t, now);
    for (const d of dets) {
      const s = iou(p, d);
      if (s >= IOU_MATCH) pairs.push({ t, d, iou: s });
    }
  }
  pairs.sort((a, b) => b.iou - a.iou);
  const usedT = new Set<TState>();
  const usedD = new Set<Detection>();
  const out: Array<[TState, Detection]> = [];
  for (const p of pairs) {
    if (usedT.has(p.t) || usedD.has(p.d)) continue;
    usedT.add(p.t);
    usedD.add(p.d);
    out.push([p.t, p.d]);
  }
  return out;
}

export class ByteTracker {
  private tracks: TState[] = [];
  private nextId = 1;

  reset(): void {
    this.tracks = [];
  }

  update(dets: Detection[], now: number): Track[] {
    const high = dets.filter((d) => d.score >= HIGH_CONF);
    const low = dets.filter((d) => d.score < HIGH_CONF);

    // stage 1: everyone vs high-confidence detections
    const matched = new Set<TState>();
    const usedDets = new Set<Detection>();
    for (const [t, d] of greedyMatch(this.tracks, high, now)) {
      this.applyMatch(t, d, now);
      matched.add(t);
      usedDets.add(d);
    }
    // stage 2: rescue remaining tracks with low-confidence detections
    const rest = this.tracks.filter((t) => !matched.has(t));
    for (const [t, d] of greedyMatch(rest, low, now)) {
      this.applyMatch(t, d, now);
      matched.add(t);
      usedDets.add(d);
    }

    // stage 3: re-capture LOST tracks by center proximity — after ~1 s of
    // occlusion the coasted prediction rarely overlaps a 3 %-wide box, so
    // IoU alone would mint a new identity for every returning player.
    {
      const lost = this.tracks.filter((t) => !matched.has(t) && t.missed > 0);
      const freeDets = high.filter((d) => !usedDets.has(d));
      const pairs: Array<{ t: TState; d: Detection; dist: number }> = [];
      for (const t of lost) {
        const p = predict(t, now);
        const maxDist = Math.max(0.06, 2.5 * t.w);
        for (const d of freeDets) {
          const dist = Math.hypot(
            p.u + p.w / 2 - (d.u + d.w / 2),
            p.v + p.h / 2 - (d.v + d.h / 2)
          );
          if (dist <= maxDist) pairs.push({ t, d, dist });
        }
      }
      pairs.sort((a, b) => a.dist - b.dist);
      const usedT = new Set<TState>();
      for (const p of pairs) {
        if (usedT.has(p.t) || usedDets.has(p.d)) continue;
        usedT.add(p.t);
        usedDets.add(p.d);
        this.applyMatch(p.t, p.d, now);
        matched.add(p.t);
      }
    }

    // unmatched tracks: keep coasting on decaying velocity for the whole
    // buffer so the prediction stays near a player who kept moving
    for (const t of this.tracks) {
      if (matched.has(t)) continue;
      t.missed += 1;
      const dt = Math.min((now - t.lastTs) / 1000, 0.6);
      t.u += t.vu * dt;
      t.v += t.vv * dt;
      t.lastTs = now;
      t.vu *= 0.95;
      t.vv *= 0.95;
    }
    this.tracks = this.tracks.filter((t) => t.missed <= MAX_MISSED);

    // fresh tracks from unmatched high-confidence detections
    for (const d of high) {
      if (usedDets.has(d)) continue;
      this.tracks.push({
        id: this.nextId++,
        u: d.u,
        v: d.v,
        w: d.w,
        h: d.h,
        vu: 0,
        vv: 0,
        score: d.score,
        hits: 1,
        missed: 0,
        lastTs: now,
      });
    }

    return this.tracks
      .filter((t) => t.hits >= CONFIRM_HITS && t.missed <= RENDER_MISSED)
      .map((t) => ({
        id: t.id,
        u: t.u,
        v: t.v,
        w: t.w,
        h: t.h,
        score: t.score,
        coasting: t.missed > 0,
      }));
  }

  private applyMatch(t: TState, d: Detection, now: number): void {
    const dt = (now - t.lastTs) / 1000;
    if (dt > 0.03) {
      const nvu = (d.u + d.w / 2 - (t.u + t.w / 2)) / dt;
      const nvv = (d.v + d.h / 2 - (t.v + t.h / 2)) / dt;
      t.vu = t.vu * (1 - VELOCITY_BLEND) + nvu * VELOCITY_BLEND;
      t.vv = t.vv * (1 - VELOCITY_BLEND) + nvv * VELOCITY_BLEND;
    }
    t.u = d.u;
    t.v = d.v;
    t.w = d.w;
    t.h = d.h;
    t.score = d.score;
    t.hits += 1;
    t.missed = 0;
    t.lastTs = now;
  }
}

// Single-target ball tracker. There's only ever one real ball, so this
// skips ByteTracker's multi-object identity/association machinery entirely:
// pick the best candidate each frame, prefer one near the current
// prediction (so a stray high-scoring look-alike elsewhere in frame doesn't
// steal lock away from the real ball), and coast briefly through misses —
// the ball going behind players or briefly out of frame is constant in a
// real match.
const BALL_MAX_MISSED = 20; // ~2.6s at ~7.7Hz before the ball is considered fully lost
const BALL_RENDER_MISSED = 8; // keep rendering (coasting) through short occlusions
const BALL_REACQUIRE_DIST = 0.12; // normalized distance — prefer detections near the prediction
const BALL_VELOCITY_BLEND = 0.6;

interface BState {
  u: number;
  v: number;
  w: number;
  h: number;
  vu: number;
  vv: number;
  score: number;
  missed: number;
  lastTs: number;
}

export class BallTracker {
  private t: BState | null = null;

  reset(): void {
    this.t = null;
  }

  update(dets: Detection[], now: number): BallTrack | null {
    if (dets.length === 0) return this.coast(now);

    const pick = this.selectBest(dets, now);

    if (!this.t) {
      this.t = { u: pick.u, v: pick.v, w: pick.w, h: pick.h, vu: 0, vv: 0, score: pick.score, missed: 0, lastTs: now };
      return { u: pick.u, v: pick.v, w: pick.w, h: pick.h, score: pick.score, coasting: false };
    }

    const dt = (now - this.t.lastTs) / 1000;
    if (dt > 0.03) {
      const nvu = (pick.u + pick.w / 2 - (this.t.u + this.t.w / 2)) / dt;
      const nvv = (pick.v + pick.h / 2 - (this.t.v + this.t.h / 2)) / dt;
      this.t.vu = this.t.vu * (1 - BALL_VELOCITY_BLEND) + nvu * BALL_VELOCITY_BLEND;
      this.t.vv = this.t.vv * (1 - BALL_VELOCITY_BLEND) + nvv * BALL_VELOCITY_BLEND;
    }
    this.t.u = pick.u;
    this.t.v = pick.v;
    this.t.w = pick.w;
    this.t.h = pick.h;
    this.t.score = pick.score;
    this.t.missed = 0;
    this.t.lastTs = now;

    return { u: this.t.u, v: this.t.v, w: this.t.w, h: this.t.h, score: this.t.score, coasting: false };
  }

  private selectBest(dets: Detection[], now: number): Detection {
    if (!this.t) return dets.reduce((a, b) => (b.score > a.score ? b : a));
    const dt = Math.min(Math.max((now - this.t.lastTs) / 1000, 0), 0.6);
    const pu = this.t.u + this.t.vu * dt + this.t.w / 2;
    const pv = this.t.v + this.t.vv * dt + this.t.h / 2;
    const near = dets.filter((d) => Math.hypot(d.u + d.w / 2 - pu, d.v + d.h / 2 - pv) <= BALL_REACQUIRE_DIST);
    const pool = near.length > 0 ? near : dets;
    return pool.reduce((a, b) => (b.score > a.score ? b : a));
  }

  private coast(now: number): BallTrack | null {
    if (!this.t) return null;
    this.t.missed += 1;
    if (this.t.missed > BALL_MAX_MISSED) {
      this.t = null;
      return null;
    }
    const dt = Math.min((now - this.t.lastTs) / 1000, 0.6);
    this.t.u += this.t.vu * dt;
    this.t.v += this.t.vv * dt;
    this.t.lastTs = now;
    this.t.vu *= 0.9;
    this.t.vv *= 0.9;
    if (this.t.missed > BALL_RENDER_MISSED) return null; // still tracked internally, just not rendered
    return { u: this.t.u, v: this.t.v, w: this.t.w, h: this.t.h, score: this.t.score, coasting: true };
  }
}
