"""
Master training and evaluation pipeline for XavierLabs CircuitLens AR.

Trains YOLOv8n on the 1,624 circuit drawings dataset (RTX 5050 GPU),
generates accuracy evaluations, confusion matrix, loss curves, and 3D reconstructions,
then updates the reports and artifact assets.
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import torch
from ultralytics import YOLO

APP_DIR = Path(__file__).resolve().parent.parent
TRAIN_DIR = Path(__file__).resolve().parent
ARTIFACT_DIR = Path(r"C:\Users\Adrian Xavier Moral\.gemini\antigravity-ide\brain\3748a2dc-8375-4d5c-8253-51f2d38408ed")


def main():
    print("=" * 60)
    print("XavierLabs CircuitLens AR: Full Training Pipeline")
    print("=" * 60)

    if not torch.cuda.is_available():
        raise SystemExit("CUDA is not available! An NVIDIA GPU is required.")

    gpu_name = torch.cuda.get_device_name(0)
    print(f"Device: {gpu_name}")
    print(f"PyTorch: {torch.__version__} | CUDA: {torch.version.cuda}")

    yaml_path = TRAIN_DIR / "dataset" / "data.yaml"
    if not yaml_path.exists():
        raise SystemExit(f"Dataset configuration not found at {yaml_path}")

    # 1. Train YOLOv8n model for 100 epochs
    print("\n--- [Step 1/3] Training YOLOv8n for 100 epochs ---")
    model = YOLO("yolov8n.pt")
    results = model.train(
        data=str(yaml_path),
        imgsz=320,
        epochs=100,
        batch=32,
        device=0,
        workers=2,
        patience=25,
        project=str(TRAIN_DIR / "runs"),
        name="circuit_full",
        exist_ok=True,
        degrees=10,
        perspective=0.0005,
        hsv_v=0.5,
        hsv_s=0.5,
        fliplr=0.5,
        flipud=0.2,
        mosaic=1.0,
    )

    # 2. Locate best weights
    candidates = list((TRAIN_DIR / "runs").rglob("circuit_full/weights/best.pt"))
    if not candidates:
        candidates = list((TRAIN_DIR / "runs").rglob("best.pt"))
    if not candidates:
        raise SystemExit("Error: best.pt weights not found after training!")

    best_pt = candidates[0]
    print(f"\n[OK] Best weights saved to: {best_pt}")

    # 3. Run evaluation & 3D visualizations
    print("\n--- [Step 2/3] Generating Accuracy Metrics & 3D Visualizations ---")
    reports_dir = TRAIN_DIR / "reports"
    reports_dir.mkdir(exist_ok=True)

    cmd_eval = [
        sys.executable,
        str(TRAIN_DIR / "evaluate.py"),
        "--weights", str(best_pt),
        "--data", str(yaml_path),
        "--out", str(reports_dir),
    ]
    subprocess.run(cmd_eval, check=True)

    # 4. Copy charts to artifact directory
    print("\n--- [Step 3/3] Updating Artifact Assets ---")
    if ARTIFACT_DIR.exists():
        for img in reports_dir.glob("*.png"):
            shutil.copy2(img, ARTIFACT_DIR / img.name)
        # Also copy confusion matrix from eval run
        for cm in (TRAIN_DIR / "runs").rglob("confusion_matrix.png"):
            shutil.copy2(cm, ARTIFACT_DIR / "confusion_matrix.png")
            break
        print(f"[OK] Copied visual reports to {ARTIFACT_DIR}")

    # Read final metrics
    metrics_file = reports_dir / "metrics.json"
    if metrics_file.exists():
        m = json.loads(metrics_file.read_text())
        print("\n" + "=" * 60)
        print("FINAL ACCURACY REPORT:")
        print(f"  mAP@50:     {m.get('mAP50', 0):.4f}")
        print(f"  mAP@50-95:  {m.get('mAP50_95', 0):.4f}")
        print(f"  Precision:  {m.get('precision', 0):.4f}")
        print(f"  Recall:     {m.get('recall', 0):.4f}")
        print("  Per-class mAP@50:")
        for cls_name, val in m.get("per_class_mAP50", {}).items():
            print(f"    - {cls_name:10s}: {val:.4f}")
        print("=" * 60)

    # Try exporting to ONNX / TF.js
    print("\nAttempting ONNX export...")
    try:
        best_model = YOLO(str(best_pt))
        best_model.export(format="onnx", imgsz=320)
        print("[OK] Exported best.pt to ONNX format!")
    except Exception as e:
        print(f"[Notice] ONNX export note: {e}")

    print("\n[SUCCESS] Pipeline execution complete!")


if __name__ == "__main__":
    main()
