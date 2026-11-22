"""
Evaluate a trained circuit detector and produce visual reports.

    python evaluate.py --weights runs/circuit/weights/best.pt --data dataset/data.yaml

Outputs (reports/):
  metrics.json             overall + per-class precision / recall / mAP
  per_class_map.png        bar chart of mAP50 per symbol class
  training_curves.png      loss + mAP over epochs (from results.csv)
  predictions_grid.png     model predictions vs ground truth on val drawings
  drawing_to_3d_*.png      a val drawing -> detections -> 3D extruded scene
Ultralytics also writes confusion_matrix.png, PR/F1 curves into runs/<val>/.
"""
import argparse
import csv
import json
import os
import random
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
from PIL import Image
from ultralytics import YOLO

COLORS = {"battery": "#ffb020", "resistor": "#00e5ff", "bulb": "#ffe14d",
          "led": "#ff4d6d", "switch": "#b388ff", "text": "#8a8f98"}
HEIGHT = {"battery": 1.2, "resistor": 0.5, "bulb": 1.0, "led": 0.7, "switch": 0.4, "text": 0.05}


def plot_training_curves(run_dir: Path, out: Path):
    csv_path = run_dir / "results.csv"
    if not csv_path.exists():
        return
    rows = list(csv.DictReader(open(csv_path)))
    rows = [{k.strip(): v for k, v in r.items()} for r in rows]
    ep = [int(float(r["epoch"])) for r in rows]
    get = lambda k: [float(r[k]) for r in rows]
    fig, ax = plt.subplots(1, 3, figsize=(16, 4.5))
    for k in ("train/box_loss", "train/cls_loss", "val/box_loss", "val/cls_loss"):
        ax[0].plot(ep, get(k), label=k)
    ax[0].set_title("Losses"); ax[0].legend(); ax[0].set_xlabel("epoch")
    ax[1].plot(ep, get("metrics/mAP50(B)"), label="mAP50")
    ax[1].plot(ep, get("metrics/mAP50-95(B)"), label="mAP50-95")
    ax[1].set_title("Validation mAP"); ax[1].legend(); ax[1].set_xlabel("epoch")
    ax[2].plot(ep, get("metrics/precision(B)"), label="precision")
    ax[2].plot(ep, get("metrics/recall(B)"), label="recall")
    ax[2].set_title("Precision / Recall"); ax[2].legend(); ax[2].set_xlabel("epoch")
    for a in ax:
        a.grid(alpha=0.3)
    fig.tight_layout(); fig.savefig(out / "training_curves.png", dpi=130); plt.close(fig)


def plot_per_class(metrics, names, out: Path):
    idx = list(metrics.box.ap_class_index)
    cls = [names[i] for i in idx]
    ap50 = [metrics.box.ap50[j] for j in range(len(idx))]
    fig, ax = plt.subplots(figsize=(8, 4.5))
    bars = ax.bar(cls, ap50, color=[COLORS.get(c, "#888") for c in cls])
    for b, v in zip(bars, ap50):
        ax.text(b.get_x() + b.get_width() / 2, v + 0.01, f"{v:.2f}", ha="center")
    ax.set_ylim(0, 1.05); ax.set_ylabel("mAP@0.5"); ax.set_title("Per-class detection accuracy")
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout(); fig.savefig(out / "per_class_map.png", dpi=130); plt.close(fig)
    return dict(zip(cls, map(float, ap50)))


def read_gt(img_path: Path, names):
    lbl = Path(str(img_path).replace("images", "labels")).with_suffix(".txt")
    if not lbl.exists():
        return []
    out = []
    for line in lbl.read_text().splitlines():
        c, cx, cy, w, h = line.split()
        out.append((names[int(c)], float(cx), float(cy), float(w), float(h)))
    return out


def predictions_grid(model, imgs, names, out: Path, n=6, imgsz=416):
    fig, axes = plt.subplots(2, n, figsize=(4 * n, 8))
    for col, p in enumerate(imgs[:n]):
        im = Image.open(p).convert("RGB"); W, H = im.size
        res = model.predict(str(p), imgsz=imgsz, conf=0.35, verbose=False)[0]
        for row, title in ((0, "Ground truth"), (1, "Prediction")):
            ax = axes[row, col]; ax.imshow(im); ax.axis("off")
            ax.set_title(f"{title}\n{p.stem[:24]}", fontsize=8)
        for c, cx, cy, w, h in read_gt(p, names):
            axes[0, col].add_patch(patches.Rectangle(((cx - w / 2) * W, (cy - h / 2) * H), w * W, h * H,
                                                     fill=False, ec=COLORS.get(c, "w"), lw=1.5))
        for b, c, s in zip(res.boxes.xyxy.tolist(), res.boxes.cls.tolist(), res.boxes.conf.tolist()):
            name = names[int(c)]
            axes[1, col].add_patch(patches.Rectangle((b[0], b[1]), b[2] - b[0], b[3] - b[1],
                                                     fill=False, ec=COLORS.get(name, "w"), lw=1.5))
            axes[1, col].text(b[0], b[1] - 2, f"{name} {s:.2f}", color=COLORS.get(name, "w"), fontsize=6,
                              bbox=dict(fc="black", alpha=0.6, pad=1, lw=0))
    fig.tight_layout(); fig.savefig(out / "predictions_grid.png", dpi=110); plt.close(fig)


def box3d(ax, x0, y0, x1, y1, h, color):
    v = [(x0, y0, 0), (x1, y0, 0), (x1, y1, 0), (x0, y1, 0),
         (x0, y0, h), (x1, y0, h), (x1, y1, h), (x0, y1, h)]
    faces = [[v[0], v[1], v[2], v[3]], [v[4], v[5], v[6], v[7]], [v[0], v[1], v[5], v[4]],
             [v[2], v[3], v[7], v[6]], [v[1], v[2], v[6], v[5]], [v[4], v[7], v[3], v[0]]]
    ax.add_collection3d(Poly3DCollection(faces, facecolors=color, edgecolors="k", linewidths=0.3, alpha=0.85))


def drawing_to_3d(model, img_path: Path, names, out: Path, tag: str, imgsz=416):
    """Drawing -> detections -> extruded 3D components on the paper plane."""
    im = Image.open(img_path).convert("RGB"); W, H = im.size
    res = model.predict(str(img_path), imgsz=imgsz, conf=0.35, verbose=False)[0]
    dets = [(names[int(c)], b, s) for b, c, s in
            zip(res.boxes.xyxyn.tolist(), res.boxes.cls.tolist(), res.boxes.conf.tolist())]

    fig = plt.figure(figsize=(15, 6))
    a1 = fig.add_subplot(1, 2, 1); a1.imshow(im); a1.axis("off"); a1.set_title("Input drawing + detections")
    for name, b, s in dets:
        a1.add_patch(patches.Rectangle((b[0] * W, b[1] * H), (b[2] - b[0]) * W, (b[3] - b[1]) * H,
                                       fill=False, ec=COLORS.get(name, "w"), lw=2))
        a1.text(b[0] * W, b[1] * H - 3, f"{name} {s:.2f}", color=COLORS.get(name, "w"), fontsize=7,
                bbox=dict(fc="black", alpha=0.6, pad=1, lw=0))

    a2 = fig.add_subplot(1, 2, 2, projection="3d")
    small = im.resize((160, int(160 * H / W)))
    import numpy as np
    arr = np.asarray(small) / 255.0
    yy, xx = np.mgrid[0:1:arr.shape[0] * 1j, 0:1:arr.shape[1] * 1j]
    a2.plot_surface(xx, 1 - yy, np.zeros_like(xx), facecolors=arr, rstride=2, cstride=2, shade=False)
    for name, b, s in dets:
        if name == "text":
            continue
        box3d(a2, b[0], 1 - b[3], b[2], 1 - b[1], HEIGHT.get(name, 0.5) * 0.25, COLORS.get(name, "#888"))
    a2.set_box_aspect((W / H, 1, 0.35)); a2.view_init(elev=35, azim=-60); a2.set_axis_off()
    a2.set_title(f"3D scene ({sum(d[0] != 'text' for d in dets)} components)")
    fig.tight_layout(); fig.savefig(out / f"drawing_to_3d_{tag}.png", dpi=120); plt.close(fig)
    return [{"type": n, "score": round(s, 3), "box": [round(x, 4) for x in b]} for n, b, s in dets]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default="runs/circuit_v2/weights/best.pt")
    ap.add_argument("--data", default="dataset_v2/data.yaml")
    ap.add_argument("--imgsz", type=int, default=416)
    ap.add_argument("--out", default="reports")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    here = Path(__file__).resolve().parent
    out = Path(args.out); out.mkdir(exist_ok=True)
    model = YOLO(args.weights)
    names = model.names

    metrics = model.val(
        data=args.data,
        imgsz=args.imgsz,
        split="val",
        plots=True,
        workers=0 if os.name == "nt" else 4,
        project=str(here / "runs"),
        name="eval",
        exist_ok=True,
    )
    per_class = plot_per_class(metrics, names, out)
    plot_training_curves(Path(args.weights).parent.parent, out)

    import yaml
    cfg = yaml.safe_load(open(args.data))
    val_dir = Path(cfg["path"]) / cfg["val"]
    imgs = sorted(p for p in val_dir.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    random.Random(args.seed).shuffle(imgs)
    predictions_grid(model, imgs, names, out, imgsz=args.imgsz)
    scenes = {f"sample{i}": drawing_to_3d(model, p, names, out, f"sample{i}", imgsz=args.imgsz) for i, p in enumerate(imgs[:3])}

    report = {
        "precision": float(metrics.box.mp), "recall": float(metrics.box.mr),
        "mAP50": float(metrics.box.map50), "mAP50_95": float(metrics.box.map),
        "per_class_mAP50": per_class, "val_images": len(imgs), "scenes": scenes,
    }
    (out / "metrics.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({k: v for k, v in report.items() if k != "scenes"}, indent=2))
    print(f"Reports written to {out.resolve()}  (+ confusion matrix / PR curves in runs/eval/)")


if __name__ == "__main__":
    main()
