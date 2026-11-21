/**
 * Pure YOLOv8 pre/post-processing (no Expo imports, so it can be tested in Node).
 * Model output: [1, 4 + nc, anchors] with cx,cy,w,h in input-pixel units.
 */
import { mapClass } from './classMap.js';

/**
 * @param tf     the tfjs namespace
 * @param model  loaded GraphModel
 * @param img    { width, height, data: Uint8Array RGB }
 * @returns [{ label, type, score, box: {x,y,w,h} normalized 0..1 }]
 */
export async function runYolo(tf, model, img, { labels, imgsz, scoreThr = 0.25, iouThr = 0.45, maxDet = 60, classThr = {} }) {
  const S = imgsz;
  const side = Math.max(img.width, img.height);
  const scale = S / side;

  const input = tf.tidy(() => {
    const t = tf.tensor3d(img.data, [img.height, img.width, 3], 'int32').toFloat().div(255);
    // Letterbox: pad bottom/right to a square (YOLO grey 114), then resize.
    const padded = tf.pad(t, [[0, side - img.height], [0, side - img.width], [0, 0]], 114 / 255);
    return tf.image.resizeBilinear(padded, [S, S]).expandDims(0);
  });

  let raw = await model.executeAsync(input);
  input.dispose();
  if (Array.isArray(raw)) { const [first, ...rest] = raw; tf.dispose(rest); raw = first; }

  const { boxes, scores, classes } = tf.tidy(() => {
    const p = raw.squeeze([0]).transpose([1, 0]); // [anchors, 4 + nc]
    const xywh = p.slice([0, 0], [-1, 4]);
    const cls = p.slice([0, 4], [-1, -1]);
    const [cx, cy, w, h] = tf.split(xywh, 4, 1);
    const yxyx = tf.concat([cy.sub(h.div(2)), cx.sub(w.div(2)), cy.add(h.div(2)), cx.add(w.div(2))], 1);
    return { boxes: yxyx, scores: cls.max(1), classes: cls.argMax(1) };
  });
  raw.dispose();

  const thrValues = Object.values(classThr).filter((v) => typeof v === 'number');
  const nmsThr = thrValues.length ? Math.min(scoreThr, ...thrValues) : scoreThr;
  const keep = await tf.image.nonMaxSuppressionAsync(boxes, scores, maxDet, iouThr, nmsThr);
  const [b, s, c, k] = await Promise.all([boxes.data(), scores.data(), classes.data(), keep.data()]);
  tf.dispose([boxes, scores, classes, keep]);

  const out = [];
  for (const i of k) {
    const label = labels[c[i]] ?? String(c[i]);
    const type = mapClass(label);
    if (!type) continue;
    if (s[i] < (classThr[type] ?? scoreThr)) continue;
    const y1 = Math.max(0, b[i * 4] / scale / img.height);
    const x1 = Math.max(0, b[i * 4 + 1] / scale / img.width);
    const y2 = Math.min(1, b[i * 4 + 2] / scale / img.height);
    const x2 = Math.min(1, b[i * 4 + 3] / scale / img.width);
    if (x2 <= x1 || y2 <= y1) continue;
    out.push({ label, type, score: s[i], box: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } });
  }
  return out;
}
