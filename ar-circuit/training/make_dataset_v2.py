"""
Build `dataset_v2` from the 6-class YOLO dataset in `dataset/`.

Why a v2:
  1. Leak-free split. CGHD photographs every drawing 2-4 times (..._P1.._P4) and
     the old split was random per *image*, so near-identical photos sat in both
     train and val and inflated the metrics. v2 splits by drafter+circuit.
  2. Scale matching. CGHD pages are dense: a symbol is ~6% of the page width,
     i.e. ~19 px at the model input. In the app the user frames a small circuit
     inside the viewfinder, so symbols are 3-4x larger. v2 adds crops around
     components so the model sees symbols at app-like scales.
  3. Rare-class oversampling. Bulbs (77 labels), switches, batteries and LEDs get
     several crops each, so the model stops ignoring them.

    python make_dataset_v2.py            # -> dataset_v2/
"""
import argparse
import random
import re
import shutil
from collections import Counter, defaultdict
from pathlib import Path

import cv2
import numpy as np

CLASSES = ["battery", "resistor", "bulb", "led", "switch", "text"]
TEXT = 5
# crops per instance of each component class (train split)
CROPS_PER_INSTANCE = {0: 3, 1: 0, 2: 7, 3: 2, 4: 3}
RESISTOR_CROPS_PER_IMAGE = 2
MAX_SIDE = 640


def group_key(name: str) -> str:
    m = re.match(r"(drafter_\d+)_(C\d+)", name)
    return f"{m.group(1)}_{m.group(2)}" if m else name


def read_labels(p: Path):
    if not p.exists():
        return np.zeros((0, 5), np.float32)
    rows = [list(map(float, l.split())) for l in p.read_text().splitlines() if l.strip()]
    return np.array(rows, np.float32).reshape(-1, 5)


def to_xyxy(lbl, w, h):
    c, cx, cy, bw, bh = lbl.T
    return np.stack([c, (cx - bw / 2) * w, (cy - bh / 2) * h, (cx + bw / 2) * w, (cy + bh / 2) * h], 1)


def save(img, boxes, out_img: Path, out_lbl: Path):
    """boxes: [N,5] (cls, x1, y1, x2, y2) in img pixels."""
    h, w = img.shape[:2]
    s = min(1.0, MAX_SIDE / max(h, w))
    if s < 1:
        img = cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
    cv2.imwrite(str(out_img), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    lines = []
    for c, x1, y1, x2, y2 in boxes:
        bw, bh = (x2 - x1) / w, (y2 - y1) / h
        if bw <= 0.002 or bh <= 0.002:
            continue
        lines.append(f"{int(c)} {(x1 + x2) / 2 / w:.6f} {(y1 + y2) / 2 / h:.6f} {bw:.6f} {bh:.6f}")
    out_lbl.write_text("\n".join(lines))


def make_crop(img, boxes, anchor, rng):
    """Crop around `anchor` so it covers ~8-28% of the crop's long side."""
    H, W = img.shape[:2]
    _, ax1, ay1, ax2, ay2 = anchor
    along = max(ax2 - ax1, ay2 - ay1)
    frac = rng.uniform(0.08, 0.28)
    ch = along / frac
    aspect = rng.choice([1.0, 0.75, 0.75, 1.33])  # w/h; the app sees portrait 3:4
    cw = ch * aspect
    cw, ch = min(cw, W), min(ch, H)
    if cw < (ax2 - ax1) * 1.2 or ch < (ay2 - ay1) * 1.2:
        return None
    # random position that keeps the anchor fully inside
    x0 = rng.uniform(max(0, ax2 - cw), min(ax1, W - cw))
    y0 = rng.uniform(max(0, ay2 - ch), min(ay1, H - ch))
    x0, y0, x1, y1 = int(x0), int(y0), int(x0 + cw), int(y0 + ch)
    crop = img[y0:y1, x0:x1].copy()
    if crop.size == 0:
        return None
    bg = np.median(crop.reshape(-1, 3), axis=0).astype(np.uint8)
    kept = []
    for c, bx1, by1, bx2, by2 in boxes:
        ix1, iy1, ix2, iy2 = max(bx1, x0), max(by1, y0), min(bx2, x1), min(by2, y1)
        if ix2 <= ix1 or iy2 <= iy1:
            continue
        vis = (ix2 - ix1) * (iy2 - iy1) / max(1e-6, (bx2 - bx1) * (by2 - by1))
        if vis >= 0.6:
            kept.append([c, ix1 - x0, iy1 - y0, ix2 - x0, iy2 - y0])
        else:
            # Partially visible symbol: paint it out so it is not a confusing "negative".
            crop[int(iy1 - y0):int(iy2 - y0), int(ix1 - x0):int(ix2 - x0)] = bg
    return crop, np.array(kept, np.float32).reshape(-1, 5)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="dataset")
    ap.add_argument("--out", default="dataset_v2")
    ap.add_argument("--val", type=float, default=0.15)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    src, out = Path(args.src), Path(args.out)
    rng = random.Random(args.seed)

    items = []
    for split in ("train", "val"):
        for p in sorted((src / "images" / split).iterdir()):
            items.append((p, src / "labels" / split / (p.stem + ".txt")))

    groups = defaultdict(list)
    for it in items:
        groups[group_key(it[0].stem)].append(it)
    keys = sorted(groups)
    rng.shuffle(keys)

    # Greedy: fill val until it holds ~15% of images AND enough rare-class instances.
    total = len(items)
    val_keys, n_val, rare = set(), 0, Counter()
    for k in keys:
        cls = Counter(int(r[0]) for _, lp in groups[k] for r in read_labels(lp))
        need_rare = rare[2] < 12 or rare[4] < 50
        if n_val < args.val * total or (need_rare and (cls[2] or cls[4]) and n_val < 0.22 * total):
            val_keys.add(k)
            n_val += len(groups[k])
            rare.update(cls)

    if out.exists():
        shutil.rmtree(out)
    for split in ("train", "val"):
        (out / "images" / split).mkdir(parents=True)
        (out / "labels" / split).mkdir(parents=True)

    stats = {"train": Counter(), "val": Counter()}
    n_img = Counter()
    for k in keys:
        split = "val" if k in val_keys else "train"
        for ip, lp in groups[k]:
            img = cv2.imread(str(ip))
            if img is None:
                continue
            H, W = img.shape[:2]
            boxes = to_xyxy(read_labels(lp), W, H)
            # 1. the original page
            save(img, boxes, out / "images" / split / f"{ip.stem}.jpg", out / "labels" / split / f"{ip.stem}.txt")
            n_img[split] += 1
            stats[split].update(int(b[0]) for b in boxes)
            # 2. scale-matched crops
            comps = [b for b in boxes if int(b[0]) != TEXT]
            anchors = []
            for b in comps:
                n = CROPS_PER_INSTANCE[int(b[0])]
                if split == "val":
                    n = min(n, 1)
                anchors += [b] * n
            res = [b for b in comps if int(b[0]) == 1]
            if res:
                anchors += rng.sample(res, min(len(res), RESISTOR_CROPS_PER_IMAGE if split == "train" else 1))
            for j, a in enumerate(anchors):
                r = make_crop(img, boxes, a, rng)
                if r is None:
                    continue
                crop, kept = r
                name = f"{ip.stem}_crop{j}"
                save(crop, kept, out / "images" / split / f"{name}.jpg", out / "labels" / split / f"{name}.txt")
                n_img[split] += 1
                stats[split].update(int(b[0]) for b in kept)

    (out / "data.yaml").write_text(
        f"path: {out.resolve().as_posix()}\ntrain: images/train\nval: images/val\nnames:\n"
        + "".join(f"  {i}: {c}\n" for i, c in enumerate(CLASSES))
    )
    print(f"groups: {len(keys)} ({len(val_keys)} val)")
    for split in ("train", "val"):
        print(split, n_img[split], "images |", {CLASSES[c]: stats[split][c] for c in range(6)})


if __name__ == "__main__":
    main()
