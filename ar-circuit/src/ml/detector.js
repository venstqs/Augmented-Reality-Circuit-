/**
 * On-device YOLOv8 detector running on TensorFlow.js (pure JS CPU backend,
 * which is the only backend available inside Expo Go).
 *
 * tfjs is required lazily so Demo mode never pays the startup cost.
 */
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { MODEL } from './modelRegistry';
import { runYolo } from './yolo';

export const DEFAULT_CLASS_THR = {
  battery: 0.30,
  resistor: 0.30,
  led: 0.26,
  bulb: 0.22,
  switch: 0.22,
  text: 0.42,
};

let tf = null;
let model = null;
let labels = [];

export const isModelAvailable = () => MODEL != null;

function ensurePlatform(tfjs) {
  // React Native is neither "browser" nor "node" for tfjs; give it a minimal platform.
  if (tfjs.env().platform) return;
  tfjs.setPlatform('react-native', {
    fetch: (...a) => fetch(...a),
    now: () => Date.now(),
    encode: (s) => new TextEncoder().encode(s),
    decode: (b, enc) => new TextDecoder(enc).decode(b),
    isTypedArray: (a) => ArrayBuffer.isView(a) && !(a instanceof DataView),
    setTimeoutCustom: (fn, ms) => setTimeout(fn, ms),
  });
}

async function readAssetBytes(mod) {
  const asset = Asset.fromModule(mod);
  await asset.downloadAsync();
  const uri = asset.localUri || asset.uri;
  // Local file read is the reliable path on device; fetch() is a fallback (e.g. http dev assets).
  try {
    const b = await new File(uri).bytes();
    return b instanceof Uint8Array ? b : new Uint8Array(b);
  } catch (e1) {
    try {
      const res = await fetch(uri);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e2) {
      console.warn('Failed to load asset bytes:', uri, e1, e2);
      throw e2;
    }
  }
}

/** Custom IOHandler: model.json + .bin shards bundled as Metro assets. */
function bundledIO(json, weightModules) {
  return {
    load: async () => {
      const shards = await Promise.all(weightModules.map(readAssetBytes));
      const total = shards.reduce((s, b) => s + b.byteLength, 0);
      const weightData = new Uint8Array(total);
      let off = 0;
      for (const b of shards) { weightData.set(b, off); off += b.byteLength; }
      const weightSpecs = json.weightsManifest.flatMap((g) => g.weights);
      return {
        modelTopology: json.modelTopology,
        format: json.format,
        generatedBy: json.generatedBy,
        convertedBy: json.convertedBy,
        signature: json.signature,
        userDefinedMetadata: json.userDefinedMetadata,
        modelInitializer: json.modelInitializer,
        weightSpecs,
        weightData: weightData.buffer,
      };
    },
  };
}

export async function loadDetector(onStatus = () => {}) {
  if (model) return true;
  if (!MODEL) return false;
  onStatus('Starting TensorFlow…');
  tf = require('@tensorflow/tfjs');
  ensurePlatform(tf);
  await tf.setBackend('cpu');
  await tf.ready();
  onStatus('Loading circuit model…');
  labels = MODEL.labels;
  model = await tf.loadGraphModel(bundledIO(MODEL.json, MODEL.weights));
  onStatus('Warming up…');
  const S = MODEL.imgsz;
  const warm = await model.executeAsync(tf.zeros([1, S, S, 3]));
  tf.dispose(warm);
  return true;
}

/**
 * @param img { width, height, data: Uint8Array RGB }
 * @returns [{ label, type, score, box: {x,y,w,h} normalized }]
 */
export async function detect(
  img,
  { scoreThr = 0.28, iouThr = 0.45, maxDet = 60, classThr = DEFAULT_CLASS_THR } = {}
) {
  if (!model) return [];
  return runYolo(tf, model, img, {
    labels,
    imgsz: MODEL.imgsz,
    scoreThr,
    iouThr,
    maxDet,
    classThr,
  });
}
