/**
 * Runs the bundled TF.js model through the app's exact detection code (src/ml/yolo.js)
 * on validation images and compares against ground-truth labels.
 *   node scripts/test-detector.mjs [numImages] [scoreThr]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tf from '@tensorflow/tfjs';
import jpeg from 'jpeg-js';
import { runYolo } from '../src/ml/yolo.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const N = +(process.argv[2] || 12);
const THR = +(process.argv[3] || 0.25);
const modelDir = path.join(root, 'assets/model');
const json = JSON.parse(fs.readFileSync(path.join(modelDir, 'model.json'), 'utf8'));
const labels = JSON.parse(fs.readFileSync(path.join(modelDir, 'labels.json'), 'utf8'));
const regText = fs.readFileSync(path.join(root, 'src/ml/modelRegistry.js'), 'utf8');
const IMGSZ = Number(regText.match(/imgsz:\s*(\d+)/)?.[1] || 320);

const io = {
  load: async () => {
    const bufs = json.weightsManifest.flatMap((g) => g.paths).map((p) => fs.readFileSync(path.join(modelDir, p)));
    const all = Buffer.concat(bufs);
    return {
      modelTopology: json.modelTopology, format: json.format, signature: json.signature,
      weightSpecs: json.weightsManifest.flatMap((g) => g.weights),
      weightData: all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength),
    };
  },
};

// Same as the app: shrink to 320 px wide (bilinear), RGB.
function loadImage(file, W = 320) {
  const raw = jpeg.decode(fs.readFileSync(file), { useTArray: true, formatAsRGBA: false, maxMemoryUsageInMB: 2048 });
  const H = Math.round((raw.height * W) / raw.width);
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(raw.height - 1, ((y + 0.5) * raw.height) / H);
    for (let x = 0; x < W; x++) {
      const sx = Math.min(raw.width - 1, ((x + 0.5) * raw.width) / W);
      const si = (Math.floor(sy) * raw.width + Math.floor(sx)) * 3;
      const di = (y * W + x) * 3;
      out[di] = raw.data[si]; out[di + 1] = raw.data[si + 1]; out[di + 2] = raw.data[si + 2];
    }
  }
  return { width: W, height: H, data: out };
}

const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return i / (a.w * a.h + b.w * b.h - i + 1e-9);
};

await tf.setBackend('cpu');
const model = await tf.loadGraphModel(io);
const dsName = fs.existsSync(path.join(root, 'training/dataset_v2/images/val')) ? 'dataset_v2' : 'dataset';
const valDir = path.join(root, `training/${dsName}/images/val`);
const lblDir = path.join(root, `training/${dsName}/labels/val`);
const allFiles = fs.readdirSync(valDir).filter((f) => /\.jpe?g$/i.test(f)).sort();
const stride = Math.max(1, Math.floor(allFiles.length / N));
const files = allFiles.filter((_, i) => i % stride === 0).slice(0, N);

const stats = {};
const bump = (t, k) => { stats[t] ??= { gt: 0, tp: 0, fp: 0 }; stats[t][k]++; };
let ms = 0;
for (const f of files) {
  const img = loadImage(path.join(valDir, f));
  const t0 = Date.now();
  const dets = await runYolo(tf, model, img, { labels, imgsz: IMGSZ, scoreThr: THR });
  ms += Date.now() - t0;
  const gt = fs.readFileSync(path.join(lblDir, f.replace(/\.\w+$/, '.txt')), 'utf8').trim().split('\n').filter(Boolean).map((l) => {
    const [c, cx, cy, w, h] = l.split(/\s+/).map(Number);
    return { type: labels[c], box: { x: cx - w / 2, y: cy - h / 2, w, h }, used: false };
  });
  gt.forEach((g) => bump(g.type, 'gt'));
  for (const d of dets) {
    const m = gt.find((g) => !g.used && g.type === d.type && iou(g.box, d.box) > 0.4);
    if (m) { m.used = true; bump(d.type, 'tp'); } else bump(d.type, 'fp');
  }
  const parts = (a) => a.filter((x) => x.type !== 'text').map((x) => x.type[0]).sort().join('');
  console.log(`${f.padEnd(34)} gt[${parts(gt)}]  det[${parts(dets)}]`);
}
console.log(`\n${dsName} (imgsz ${IMGSZ}), threshold ${THR}, avg inference ${(ms / files.length).toFixed(0)} ms (Node CPU)`);
for (const [t, s] of Object.entries(stats)) {
  console.log(`${t.padEnd(9)} gt ${String(s.gt).padStart(3)}  found ${String(s.tp).padStart(3)} (${((100 * s.tp) / Math.max(1, s.gt)).toFixed(0)}%)  false+ ${s.fp}`);
}

const sampleDir = path.join(root, '../sample_circuits_to_scan');
if (fs.existsSync(sampleDir)) {
  const samples = fs.readdirSync(sampleDir).filter((f) => /\.jpe?g$/i.test(f)).sort();
  if (samples.length) {
    console.log('\nSample circuits:');
    for (const f of samples) {
      const img = loadImage(path.join(sampleDir, f));
      const dets = await runYolo(tf, model, img, { labels, imgsz: IMGSZ, scoreThr: THR });
      const summary = dets.filter((d) => d.type !== 'text').map((d) => `${d.type}(${d.score.toFixed(2)})`).join(', ') || 'none';
      console.log(`  ${f.padEnd(34)} ${summary}`);
    }
  }
}
