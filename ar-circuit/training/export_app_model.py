"""
Export a trained YOLO .pt model to TensorFlow.js GraphModel and wire it into
the Expo React Native app (`assets/model/` + `src/ml/modelRegistry.js`).

Usage:
    python export_app_model.py --weights runs/circuit_v2/weights/best.pt
    python export_app_model.py --weights runs/circuit_v2/weights/best.pt --imgsz 416
"""
import argparse
import json
import os
import shutil
import sys
import unittest.mock
from pathlib import Path

os.environ["YOLO_AUTOINSTALL"] = "False"

# 1. Patch protobuf runtime version check so TensorFlow imports cleanly on Windows
import google.protobuf.runtime_version

google.protobuf.runtime_version.ValidateProtobufRuntimeVersion = lambda *args, **kwargs: None

# 2. Mock Linux-only tensorflow_decision_forests so tensorflowjs works on Windows
sys.modules["tensorflow_decision_forests"] = unittest.mock.MagicMock()

import tensorflowjs as tfjs
from ultralytics import YOLO

HERE = Path(__file__).resolve().parent
APP_DIR = HERE.parent
OUT_DIR = APP_DIR / "assets" / "model"
REGISTRY_FILE = APP_DIR / "src" / "ml" / "modelRegistry.js"


def fix_depthwise_conv2d(manifest: dict) -> int:
    """
    onnx2tf occasionally emits a grouped Conv2D (filter [kH, kW, 1, C]) for
    depthwise convolutions (e.g. C2PSA positional encoding in YOLO11).
    TF.js Conv2D does not support groups > 1, so rewrite those nodes to
    DepthwiseConv2dNative with filter shape [kH, kW, C, 1] (identical byte layout).
    """
    weights = {
        w["name"]: w
        for g in manifest.get("weightsManifest", [])
        for w in g.get("weights", [])
    }
    nodes = {n["name"]: n for n in manifest.get("modelTopology", {}).get("node", [])}
    patched = 0
    for n in nodes.values():
        if n.get("op") not in ("Conv2D", "_FusedConv2D"):
            continue
        in_shapes = (
            n.get("attr", {})
            .get("_input_shapes", {})
            .get("list", {})
            .get("shape", [])
        )
        in_c = (
            int(in_shapes[0]["dim"][-1]["size"])
            if len(in_shapes) >= 1 and len(in_shapes[0].get("dim", [])) == 4
            else None
        )
        for inp in n.get("input", []):
            w = weights.get(inp)
            if not w or len(w.get("shape", [])) != 4:
                continue
            kh, kw, cin, cout = w["shape"]
            if cin == 1 and cout > 1 and (in_c is None or in_c == cout):
                n["op"] = (
                    "DepthwiseConv2dNative"
                    if n["op"] == "Conv2D"
                    else "FusedDepthwiseConv2dNative"
                )
                w["shape"] = [kh, kw, cout, 1]
                const_dims = (
                    nodes.get(inp, {})
                    .get("attr", {})
                    .get("value", {})
                    .get("tensor", {})
                    .get("tensorShape", {})
                    .get("dim", [])
                )
                if len(const_dims) == 4:
                    const_dims[2]["size"] = str(cout)
                    const_dims[3]["size"] = "1"
                if len(in_shapes) >= 2 and len(in_shapes[1].get("dim", [])) == 4:
                    in_shapes[1]["dim"][2]["size"] = str(cout)
                    in_shapes[1]["dim"][3]["size"] = "1"
                patched += 1
    return patched


def resolve_weights(path_str: str) -> Path:
    p = Path(path_str)
    if p.exists():
        return p.resolve()
    rel = HERE / path_str
    if rel.exists():
        return rel.resolve()
    raise SystemExit(f"Weights not found: {path_str}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default="runs/circuit_v2/weights/best.pt")
    ap.add_argument("--imgsz", type=int, default=416, help="Square input size for TF.js GraphModel")
    ap.add_argument("--fp16", action="store_true", help="Quantize TF.js weights to float16 (~50%% smaller bundle)")
    args = ap.parse_args()

    weights = resolve_weights(args.weights)
    print(f"Loading PyTorch weights: {weights}")
    model = YOLO(str(weights))
    names = model.names
    labels = [names[i] for i in sorted(names)]

    print(f"Exporting SavedModel (imgsz={args.imgsz})...")
    saved_model_dir = Path(
        model.export(format="saved_model", imgsz=args.imgsz, half=False, int8=False)
    )
    if not saved_model_dir.exists():
        raise SystemExit(f"SavedModel export failed: {saved_model_dir} not found")

    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True)

    print(f"Converting SavedModel -> TensorFlow.js GraphModel in {OUT_DIR}...")
    convert_kwargs = {
        "signature_def": "serving_default",
        "saved_model_tags": "serve",
    }
    if args.fp16:
        convert_kwargs["quantization_dtype_map"] = {"float16": "*"}

    tfjs.converters.convert_tf_saved_model(
        str(saved_model_dir),
        str(OUT_DIR),
        **convert_kwargs,
    )

    (OUT_DIR / "labels.json").write_text(json.dumps(labels, indent=2))
    print(f"[OK] Wrote labels.json: {labels}")

    manifest_path = OUT_DIR / "model.json"
    if not manifest_path.exists():
        raise SystemExit(f"Error: model.json not found in {OUT_DIR}")

    manifest = json.loads(manifest_path.read_text())
    patched = fix_depthwise_conv2d(manifest)
    if patched:
        manifest_path.write_text(json.dumps(manifest))
        print(f"[OK] Patched {patched} grouped Conv2D node(s) -> DepthwiseConv2dNative for TF.js compatibility")
    shards = [p for group in manifest["weightsManifest"] for p in group["paths"]]
    total_mb = sum((OUT_DIR / s).stat().st_size for s in shards) / (1024 * 1024)
    print(f"[OK] Generated {len(shards)} weight shard(s) ({total_mb:.2f} MB total): {shards}")

    reqs = ",\n    ".join(f"require('../../assets/model/{s}')" for s in shards)
    REGISTRY_FILE.write_text(
        "/** AUTO-GENERATED by training/export_app_model.py - do not edit by hand. */\n"
        "export const MODEL = {\n"
        "  json: require('../../assets/model/model.json'),\n"
        f"  weights: [\n    {reqs},\n  ],\n"
        "  labels: require('../../assets/model/labels.json'),\n"
        f"  imgsz: {args.imgsz},\n"
        "};\n"
    )
    print(f"[OK] Updated {REGISTRY_FILE} (imgsz={args.imgsz})")
    print("\n[SUCCESS] Model exported and wired into the Expo app. Restart Metro with: npx expo start -c")


if __name__ == "__main__":
    main()
