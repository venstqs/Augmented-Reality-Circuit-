"""
Convert a hand-drawn circuit dataset (Pascal VOC XML, e.g. CGHD) into a
YOLO dataset with the 6 classes the app understands.

Usage:
    python prepare_dataset.py --src path/to/cghd --out dataset

Also accepts datasets that are ALREADY in YOLO format (e.g. a Roboflow
export): just point train.py at its data.yaml instead.
"""
import argparse
import random
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

CLASSES = ["battery", "resistor", "bulb", "led", "switch", "text"]
IMG_EXT = [".jpg", ".jpeg", ".png", ".JPG", ".JPEG", ".PNG"]


def map_class(name: str):
    """Same logic as the app's src/ml/classMap.js."""
    n = name.lower()
    if "light_emitting" in n or n == "led":
        return "led"
    if "battery" in n or n.startswith("voltage") or "cell" in n or "source" in n:
        return "battery"
    if "lamp" in n or "bulb" in n:
        return "bulb"
    if "resistor" in n:
        return "resistor"
    if "switch" in n:
        return "switch"
    if n == "text":
        return "text"
    return None


def find_image(xml_path: Path, filename: str | None):
    candidates = []
    for folder in [xml_path.parent, xml_path.parent.parent / "images", xml_path.parent.parent]:
        if filename:
            candidates.append(folder / filename)
        candidates += [folder / (xml_path.stem + e) for e in IMG_EXT]
    return next((c for c in candidates if c.exists()), None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="folder containing the dataset (searched recursively for *.xml)")
    ap.add_argument("--out", default="dataset")
    ap.add_argument("--val", type=float, default=0.15)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    for split in ("train", "val"):
        (out / "images" / split).mkdir(parents=True)
        (out / "labels" / split).mkdir(parents=True)

    xmls = sorted(Path(args.src).rglob("*.xml"))
    random.Random(args.seed).shuffle(xmls)
    n_val = max(1, int(len(xmls) * args.val))
    counts = {c: 0 for c in CLASSES}
    used = skipped = 0

    for i, xp in enumerate(xmls):
        try:
            root = ET.parse(xp).getroot()
        except ET.ParseError:
            skipped += 1
            continue
        img = find_image(xp, root.findtext("filename"))
        size = root.find("size")
        if img is None or size is None:
            skipped += 1
            continue
        W = float(size.findtext("width") or 0)
        H = float(size.findtext("height") or 0)
        if W <= 0 or H <= 0:
            skipped += 1
            continue

        lines = []
        for obj in root.findall("object"):
            cls = map_class(obj.findtext("name") or "")
            bb = obj.find("bndbox")
            if cls is None or bb is None:
                continue
            x1, y1, x2, y2 = (float(bb.findtext(k)) for k in ("xmin", "ymin", "xmax", "ymax"))
            cx, cy = (x1 + x2) / 2 / W, (y1 + y2) / 2 / H
            w, h = (x2 - x1) / W, (y2 - y1) / H
            if w <= 0 or h <= 0:
                continue
            lines.append(f"{CLASSES.index(cls)} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
            counts[cls] += 1
        if not lines:
            skipped += 1
            continue

        split = "val" if i < n_val else "train"
        stem = f"{xp.parent.parent.name}_{xp.stem}".replace(" ", "_")
        shutil.copy2(img, out / "images" / split / (stem + img.suffix.lower()))
        (out / "labels" / split / (stem + ".txt")).write_text("\n".join(lines))
        used += 1

    yaml = out / "data.yaml"
    yaml.write_text(
        f"path: {out.resolve().as_posix()}\ntrain: images/train\nval: images/val\n"
        f"names:\n" + "".join(f"  {i}: {c}\n" for i, c in enumerate(CLASSES))
    )
    print(f"Images used: {used}, skipped: {skipped}")
    print("Boxes per class:", counts)
    print(f"Wrote {yaml}")


if __name__ == "__main__":
    main()
