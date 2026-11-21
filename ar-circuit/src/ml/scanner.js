/**
 * Scan pipeline: captured photo -> detections -> wire tracing -> circuit.
 */
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { decodeJpegBase64, toGray, traceNets } from './imageUtils';
import { detect } from './detector';
import { DEFAULT_VALUES, terminalsFromBox } from '../circuit/topology';

const SCAN_WIDTH = 320;
export const PREFIX = { battery: 'B', resistor: 'R', bulb: 'L', led: 'D', switch: 'S' };

/** Generate the next unused component ID like R1, R2, L1 when adding or retyping a part. */
export function nextComponentId(type, existing = []) {
  const pre = PREFIX[type] || 'X';
  const used = new Set(existing.map((c) => c.id));
  let n = 1;
  while (used.has(`${pre}${n}`)) n += 1;
  return `${pre}${n}`;
}

/**
 * @param photoUri file uri of an upright (processed) camera photo
 * @returns { components, nodeCount, imageSize, timings }
 */
export async function analyzePhoto(photoUri) {
  const t0 = Date.now();
  const small = await manipulateAsync(photoUri, [{ resize: { width: SCAN_WIDTH } }], {
    base64: true,
    compress: 0.85,
    format: SaveFormat.JPEG,
  });
  const img = decodeJpegBase64(small.base64);
  const t1 = Date.now();

  const dets = await detect(img);
  const t2 = Date.now();

  const counters = {};
  const components = dets
    .filter((d) => d.type !== 'text')
    .sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y)
    .map((d) => {
      counters[d.type] = (counters[d.type] || 0) + 1;
      const id = `${PREFIX[d.type] || 'X'}${counters[d.type]}`;
      return {
        id,
        type: d.type,
        label: id,
        value: DEFAULT_VALUES[d.type],
        closed: true,
        flipped: false,
        box: d.box,
        score: d.score,
        ...terminalsFromBox(d.box),
      };
    });
  const textBoxes = dets.filter((d) => d.type === 'text').map((d) => d.box);

  let nodeCount = 0;
  if (components.length) {
    const gray = toGray(img);
    const traced = traceNets(gray, img.width, img.height, components, textBoxes);
    components.forEach((c, i) => { c.nodes = traced.nodes[i]; });
    nodeCount = traced.nodeCount;
  }

  return {
    components,
    textBoxes,
    nodeCount,
    imageSize: { width: img.width, height: img.height },
    timings: { prep: t1 - t0, detect: t2 - t1, total: Date.now() - t0 },
  };
}
