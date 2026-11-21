/**
 * Pure-JS image utilities (work inside Expo Go, no native modules).
 *
 * The wire tracer finds which component terminals are connected by drawn
 * lines: dark ink pixels are binarized (Otsu), component boxes are masked out,
 * and the remaining ink is split into connected regions. Every region = one
 * electrical net.
 */
import jpeg from 'jpeg-js';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64.length; i++) LOOKUP[B64.charCodeAt(i)] = i;

export function base64ToBytes(b64) {
  const clean = b64.replace(/^data:.*?;base64,/, '').replace(/[^A-Za-z0-9+/]/g, '');
  const len = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(len);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = LOOKUP[clean.charCodeAt(i)];
    const b = LOOKUP[clean.charCodeAt(i + 1)];
    const c = LOOKUP[clean.charCodeAt(i + 2)];
    const d = LOOKUP[clean.charCodeAt(i + 3)];
    out[p++] = (a << 2) | (b >> 4);
    if (p < len) out[p++] = ((b & 15) << 4) | (c >> 2);
    if (p < len) out[p++] = ((c & 3) << 6) | d;
  }
  return out;
}

/** Decode base64 JPEG -> { width, height, data: Uint8Array RGB } */
export function decodeJpegBase64(b64) {
  const raw = jpeg.decode(base64ToBytes(b64), { useTArray: true, formatAsRGBA: false });
  return { width: raw.width, height: raw.height, data: raw.data };
}

export function toGray({ width, height, data }) {
  const g = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < g.length; i++, j += 3) {
    g[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  }
  return g;
}

export function otsu(gray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

function find(parent, x) {
  while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
  return x;
}

/**
 * Assign electrical nets to component terminals.
 * @param gray   grayscale pixels
 * @param w,h    image size
 * @param components  [{ box:{x,y,w,h} normalized, terminals:[{x,y},{x,y}] }]
 * @param ignoreBoxes extra normalized boxes to mask (e.g. text labels)
 * @returns { nodes: [[na, nb], ...], nodeCount }
 */
export function traceNets(gray, w, h, components, ignoreBoxes = []) {
  const thr = Math.min(otsu(gray), 200);
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) ink[i] = gray[i] < thr ? 1 : 0;

  // Dilate once (closes small pen gaps).
  const dil = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (ink[i] || ink[i - 1] || ink[i + 1] || ink[i - w] || ink[i + w]) dil[i] = 1;
    }
  }

  // Mask component + ignore boxes.
  const mask = (b, pad) => {
    const x0 = Math.max(0, Math.floor((b.x - pad) * w));
    const y0 = Math.max(0, Math.floor((b.y - pad) * h));
    const x1 = Math.min(w - 1, Math.ceil((b.x + b.w + pad) * w));
    const y1 = Math.min(h - 1, Math.ceil((b.y + b.h + pad) * h));
    for (let y = y0; y <= y1; y++) dil.fill(0, y * w + x0, y * w + x1 + 1);
  };
  components.forEach((c) => mask(c.box, 0));
  ignoreBoxes.forEach((b) => mask(b, 0.005));

  // Connected components (union-find, 8-connectivity).
  const parent = new Int32Array(w * h).fill(-1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!dil[i]) continue;
      parent[i] = i;
      const nbrs = [x > 0 ? i - 1 : -1, y > 0 ? i - w : -1, y > 0 && x > 0 ? i - w - 1 : -1, y > 0 && x < w - 1 ? i - w + 1 : -1];
      for (const n of nbrs) {
        if (n >= 0 && parent[n] >= 0) {
          const ra = find(parent, i);
          const rb = find(parent, n);
          if (ra !== rb) parent[ra] = rb;
        }
      }
    }
  }

  // Each terminal -> nearest ink region (search outward in square rings).
  const R = Math.max(4, Math.round(w * 0.05));
  const regionToNet = new Map();
  let nodeCount = 0;
  const nodes = components.map((c) =>
    c.terminals.map((t) => {
      const cx = Math.round(t.x * w);
      const cy = Math.round(t.y * h);
      let label = -1;
      for (let r = 1; r <= R && label < 0; r++) {
        for (let dy = -r; dy <= r && label < 0; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            const x = cx + dx;
            const y = cy + dy;
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            const i = y * w + x;
            if (parent[i] >= 0) { label = find(parent, i); break; }
          }
        }
      }
      if (label < 0) return nodeCount++; // dangling terminal
      if (!regionToNet.has(label)) regionToNet.set(label, nodeCount++);
      return regionToNet.get(label);
    })
  );
  return { nodes, nodeCount };
}
