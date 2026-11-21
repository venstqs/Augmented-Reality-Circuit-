"""
Train the circuit-symbol detector on your NVIDIA GPU.

    python make_dataset_v2.py      # once: leak-free split + scale-matched crops
    python train.py                # YOLO11n @ 416 on dataset_v2

Then export for the app:
    python export_app_model.py --weights runs/circuit_v2/weights/best.pt
"""
import argparse
import os
from pathlib import Path

import torch
from ultralytics import YOLO


def main():
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(here / "dataset_v2" / "data.yaml"))
    ap.add_argument("--imgsz", type=int, default=416, help="the app runs the model at 320x416 (portrait)")
    ap.add_argument("--epochs", type=int, default=70)
    ap.add_argument("--batch", type=int, default=32, help="32 fits in 8 GB VRAM at 416px")
    ap.add_argument("--workers", type=int, default=0 if os.name == "nt" else 4, help="0 avoids Windows DataLoader RAM OOM")
    ap.add_argument("--model", default=str(here / "yolo11n.pt"))
    ap.add_argument("--name", default="circuit_v2", help="run folder under runs/")
    ap.add_argument("--resume", action="store_true", help="resume runs/<name>/weights/last.pt")
    args = ap.parse_args()

    if not torch.cuda.is_available():
        raise SystemExit(
            "CUDA GPU not detected. For RTX 50-series install PyTorch built for CUDA 12.8:\n"
            "  pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128"
        )
    print("GPU:", torch.cuda.get_device_name(0))

    runs_dir = str(here / "runs")
    if args.resume:
        YOLO(str(here / "runs" / args.name / "weights" / "last.pt")).train(resume=True)
        return

    model = YOLO(args.model)
    model.train(
        data=args.data,
        imgsz=args.imgsz,
        epochs=args.epochs,
        batch=args.batch,
        device=0,
        workers=args.workers,
        patience=20,
        project=runs_dir,
        name=args.name,
        exist_ok=True,
        cos_lr=True,
        close_mosaic=10,
        # Augmentations for phone photos of paper drawings
        degrees=8,
        perspective=0.0005,
        scale=0.5,
        hsv_h=0.3,  # blue / red / black ink
        hsv_s=0.6,
        hsv_v=0.5,
        fliplr=0.5,
        flipud=0.3,
        mosaic=1.0,
    )
    metrics = model.val()
    print(f"mAP50: {metrics.box.map50:.3f}  mAP50-95: {metrics.box.map:.3f}")
    print(f"Best weights: runs/{args.name}/weights/best.pt")


if __name__ == "__main__":
    main()
