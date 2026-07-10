// YOLOv8n person detector running fully in-browser via TensorFlow.js.
// WebGL backend only needs JS + GLSL shaders — no WASM, no workers, no eval —
// so it works in MV3 content scripts (and player iframes) regardless of page CSP.
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
 * Detect persons in the current video frame.
 * Returns boxes in normalized video coordinates (0..1), person class only.
 */
export async function detect(video: HTMLVideoElement): Promise<Detection[]> {
  if (!model) throw new Error("detector not initialized");
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return [];

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

  // rows: cx,cy,w,h + 80 class scores; person = class 0
  const { boxes, scores } = tf.tidy(() => {
    const pred = tf.transpose(tf.squeeze(raw, [0])); // [8400,84]
    const cx = pred.slice([0, 0], [-1, 1]);
    const cy = pred.slice([0, 1], [-1, 1]);
    const w = pred.slice([0, 2], [-1, 1]);
    const h = pred.slice([0, 3], [-1, 1]);
    const halfW = w.div(2);
    const halfH = h.div(2);
    // NMS wants [y1,x1,y2,x2]
    const nmsBoxes = tf.concat(
      [cy.sub(halfH), cx.sub(halfW), cy.add(halfH), cx.add(halfW)],
      1
    ) as tf.Tensor2D;
    const personScores = pred.slice([0, 4], [-1, 1]).squeeze([1]) as tf.Tensor1D;
    return { boxes: tf.keep(nmsBoxes), scores: tf.keep(personScores) };
  });
  raw.dispose();

  try {
    const nms = await tf.image.nonMaxSuppressionAsync(
      boxes,
      scores,
      MAX_DETECTIONS,
      IOU_THRESHOLD,
      SCORE_THRESHOLD
    );
    const picked = (await nms.data()) as Int32Array;
    nms.dispose();
    const boxData = (await boxes.data()) as Float32Array;
    const scoreData = (await scores.data()) as Float32Array;

    const dets: Detection[] = [];
    for (const i of picked) {
      const y1 = boxData[i * 4];
      const x1 = boxData[i * 4 + 1];
      const y2 = boxData[i * 4 + 2];
      const x2 = boxData[i * 4 + 3];
      // un-letterbox (content sits at top-left) → normalize to video dims
      const u = x1 / scale / vw;
      const v = y1 / scale / vh;
      const w = (x2 - x1) / scale / vw;
      const h = (y2 - y1) / scale / vh;
      if (h < MIN_BOX_HEIGHT) continue;
      dets.push({
        u: Math.max(0, Math.min(1, u)),
        v: Math.max(0, Math.min(1, v)),
        w: Math.min(w, 1),
        h: Math.min(h, 1),
        score: scoreData[i],
      });
    }
    return dets;
  } finally {
    boxes.dispose();
    scores.dispose();
  }
}
