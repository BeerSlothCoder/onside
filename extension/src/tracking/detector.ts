// YOLOv8n person+ball detector running fully in-browser via TensorFlow.js.
// WebGL backend only needs JS + GLSL shaders — no WASM, no workers, no eval —
// so it works in MV3 content scripts (and player iframes) regardless of page CSP.
//
// The bundled model is the STOCK 80-class COCO YOLOv8n — we were already
// only reading class 0 ("person") out of its output; "sports ball" is COCO
// class 32, already in every forward pass. No new/retrained model needed to
// track the ball, just a second score channel read from the same inference.
//
// Ball detection is honestly much less reliable than person detection: COCO's
// "sports ball" training data skews toward large balls at close range
// (basketball, tennis), not a small football seen from a wide broadcast
// camera. Expect more misses and more false positives than the person
// detector — the thresholds below are a starting guess, not a tuned/eval'd
// result (no football-broadcast eval set exists in this repo for this class).
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-core/dist/public/chained_ops/register_all_chained_ops";
import "@tensorflow/tfjs-backend-webgl";
import "@tensorflow/tfjs-backend-cpu";
import { loadGraphModel, type GraphModel } from "@tensorflow/tfjs-converter";
import type { Detection } from "./types";

const MODEL_URL = () => chrome.runtime.getURL("models/yolov8n-640/model.json");
const INPUT = 640;
const SCORE_THRESHOLD = 0.25;
const IOU_THRESHOLD = 0.45;
const MAX_DETECTIONS = 26; // 22 players + refs, roughly
const MIN_BOX_HEIGHT = 0.02; // 2% of video height — drop crowd specks

// COCO class 32 ("sports ball"); row index into the 84-row output is 4 + class.
const BALL_CLASS_ROW = 4 + 32;
const BALL_SCORE_THRESHOLD = 0.15; // lower bar — small/distant balls score poorly
const BALL_MAX_DETECTIONS = 3; // only ever one real ball; keep a few candidates for the tracker to pick from
const BALL_MIN_BOX_HEIGHT = 0.004; // a ball is tiny relative to frame, unlike a person
const BALL_MAX_BOX_HEIGHT = 0.08; // reject implausibly large "ball" boxes (near-certain false positives)

export interface RawDetections {
  persons: Detection[];
  balls: Detection[];
}

let model: GraphModel | null = null;
let loading: Promise<void> | null = null;

export async function initDetector(): Promise<void> {
  if (model) return;
  if (!loading) {
    loading = (async () => {
      try {
        await tf.setBackend("webgl");
      } catch {
        await tf.setBackend("cpu");
      }
      await tf.ready();
      const m = await loadGraphModel(MODEL_URL());
      // shader warm-up so the first real frame isn't multi-second
      const warm = tf.zeros([1, INPUT, INPUT, 3]);
      const out = m.execute(warm) as tf.Tensor;
      await out.data();
      warm.dispose();
      out.dispose();
      model = m;
    })();
    loading.catch(() => {
      loading = null; // allow retry after a transient failure
    });
  }
  return loading;
}

export function detectorReady(): boolean {
  return model !== null;
}

export function tensorCount(): number {
  return tf.memory().numTensors;
}

/**
 * Detect persons AND the ball in the current video frame, from a single
 * inference pass. Returns boxes in normalized video coordinates (0..1),
 * bucketed by class — NMS runs once per class against the same box tensor
 * since suppressing across classes would incorrectly drop a ball box that
 * overlaps a nearby player box.
 */
export async function detect(video: HTMLVideoElement): Promise<RawDetections> {
  if (!model) throw new Error("detector not initialized");
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return { persons: [], balls: [] };

  // letterbox to 640×640: content at top-left, gray pad right/bottom
  const scale = INPUT / Math.max(vw, vh);
  const nw = Math.round(vw * scale);
  const nh = Math.round(vh * scale);

  const input = tf.tidy(() => {
    const img = tf.browser.fromPixels(video);
    const resized = tf.image.resizeBilinear(img, [nh, nw]);
    const padded = resized.pad(
      [
        [0, INPUT - nh],
        [0, INPUT - nw],
        [0, 0],
      ],
      114
    );
    return padded.div(255).expandDims(0); // [1,640,640,3]
  });

  const raw = model.execute(input) as tf.Tensor; // [1,84,8400]
  input.dispose();

  // rows: cx,cy,w,h + 80 class scores; person = class 0, sports ball = class 32
  const { boxes, personScores, ballScores } = tf.tidy(() => {
    const pred = tf.transpose(tf.squeeze(raw, [0])); // [8400,84]
    const cx = pred.slice([0, 0], [-1, 1]);
    const cy = pred.slice([0, 1], [-1, 1]);
    const w = pred.slice([0, 2], [-1, 1]);
    const h = pred.slice([0, 3], [-1, 1]);
    const halfW = w.div(2);
    const halfH = h.div(2);
    // NMS wants [y1,x1,y2,x2] — shared geometry, both classes read the same boxes
    const nmsBoxes = tf.concat(
      [cy.sub(halfH), cx.sub(halfW), cy.add(halfH), cx.add(halfW)],
      1
    ) as tf.Tensor2D;
    const person = pred.slice([0, 4], [-1, 1]).squeeze([1]) as tf.Tensor1D;
    const ball = pred.slice([0, BALL_CLASS_ROW], [-1, 1]).squeeze([1]) as tf.Tensor1D;
    return { boxes: tf.keep(nmsBoxes), personScores: tf.keep(person), ballScores: tf.keep(ball) };
  });
  raw.dispose();

  const unletterbox = (
    boxData: Float32Array,
    i: number
  ): { u: number; v: number; w: number; h: number } => {
    const y1 = boxData[i * 4];
    const x1 = boxData[i * 4 + 1];
    const y2 = boxData[i * 4 + 2];
    const x2 = boxData[i * 4 + 3];
    return {
      u: Math.max(0, Math.min(1, x1 / scale / vw)),
      v: Math.max(0, Math.min(1, y1 / scale / vh)),
      w: Math.min((x2 - x1) / scale / vw, 1),
      h: Math.min((y2 - y1) / scale / vh, 1),
    };
  };

  try {
    const [personNms, ballNms] = await Promise.all([
      tf.image.nonMaxSuppressionAsync(boxes, personScores, MAX_DETECTIONS, IOU_THRESHOLD, SCORE_THRESHOLD),
      tf.image.nonMaxSuppressionAsync(boxes, ballScores, BALL_MAX_DETECTIONS, IOU_THRESHOLD, BALL_SCORE_THRESHOLD),
    ]);
    const [personPicked, ballPicked, boxData, personScoreData, ballScoreData] = await Promise.all([
      personNms.data() as Promise<Int32Array>,
      ballNms.data() as Promise<Int32Array>,
      boxes.data() as Promise<Float32Array>,
      personScores.data() as Promise<Float32Array>,
      ballScores.data() as Promise<Float32Array>,
    ]);
    personNms.dispose();
    ballNms.dispose();

    const persons: Detection[] = [];
    for (const i of personPicked) {
      const box = unletterbox(boxData, i);
      if (box.h < MIN_BOX_HEIGHT) continue;
      persons.push({ ...box, score: personScoreData[i] });
    }

    const balls: Detection[] = [];
    for (const i of ballPicked) {
      const box = unletterbox(boxData, i);
      if (box.h < BALL_MIN_BOX_HEIGHT || box.h > BALL_MAX_BOX_HEIGHT) continue;
      balls.push({ ...box, score: ballScoreData[i] });
    }

    return { persons, balls };
  } finally {
    boxes.dispose();
    personScores.dispose();
    ballScores.dispose();
  }
}
