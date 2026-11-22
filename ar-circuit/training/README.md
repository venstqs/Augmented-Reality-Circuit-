# Circuit Symbol Detector — `YOLO11n @ 416px` Training & TF.js Export Guide

This directory contains the end-to-end training, evaluation, and TensorFlow.js export pipeline for **CircuitLens**.

---

## 1. Setup Python Environment & CUDA GPU

### Step A: Install PyTorch with CUDA 12.8 (NVIDIA RTX 50-Series Support)
```powershell
pip install --force-reinstall torch torchvision --index-url https://download.pytorch.org/whl/cu128
```

Verify your GPU is recognized:
```powershell
python -c "import torch; print('CUDA Available:', torch.cuda.is_available(), '| GPU:', torch.cuda.get_device_name(0))"
```

### Step B: Install Training & Export Packages
```powershell
pip install -r requirements.txt
```

---

## 2. Build the Leak-Free `dataset_v2` Dataset

Starting from the raw CGHD (Circuit Graphs on Hand Drawings) Pascal VOC annotations or the base 6-class `dataset/`:

```powershell
cd "ar-circuit\training"

# Optional: convert raw CGHD VOC XML -> base YOLO dataset/
python prepare_dataset.py --src cghd_raw --out dataset

# Build dataset_v2 (leak-free drafter+circuit split, viewfinder scale-matched crops, rare-class oversampling)
python make_dataset_v2.py --src dataset --out dataset_v2
```

Why `dataset_v2`?
1. **Leak-free split:** Groups by `drafter_X_CY` so multiple photos (`_P1.._P4`) of the same circuit drawing never straddle `train` and `val`.
2. **Scale matching:** Generates crops around components so symbols occupy `8–28%` of the frame, matching how users frame a circuit inside the phone viewfinder at `416px`.
3. **Rare-class oversampling:** Oversamples `bulb`, `switch`, `battery`, and `led` instances while painting out partially clipped boundary symbols.

---

## 3. Train `YOLO11n` at `416px`

```powershell
cd "ar-circuit\training"
python train.py --data dataset_v2/data.yaml --imgsz 416 --epochs 70 --batch 32
```

To resume an interrupted training run from `runs/circuit_v2/weights/last.pt`:
```powershell
python train.py --resume
```

- **Windows RAM Safety:** Automatically uses `workers=0` on Windows to avoid multiprocessing DataLoader `MemoryError` crashes during mosaic augmentation.
- **Output:** Best weights are saved to `runs/circuit_v2/weights/best.pt`.

---

## 4. Evaluate & Generate Visual Reports

```powershell
python evaluate.py --weights runs/circuit_v2/weights/best.pt --data dataset_v2/data.yaml --imgsz 416
```

Writes to `reports/`:
- `metrics.json` — Overall and per-class precision, recall, `mAP@0.5`, and `mAP@0.5:0.95`
- `per_class_map.png` — Per-class `mAP@0.5` bar chart
- `training_curves.png` — Box/class loss, validation mAP, and precision/recall curves
- `predictions_grid.png` — Ground truth vs. model predictions across validation drawings
- `drawing_to_3d_sample0..2.png` — 2D input drawing + detections alongside extruded 3D component scenes

---

## 5. Export to TensorFlow.js & Wire into the Expo App (1 Command on Windows)

No Google Colab or Linux VM is required. `export_app_model.py` patches Windows `protobuf` and `tensorflow_decision_forests` checks, exports `best.pt` to a TensorFlow `SavedModel`, converts it to a TensorFlow.js `GraphModel`, rewrites YOLO11's `C2PSA` grouped `Conv2D` node to `DepthwiseConv2dNative` for TF.js compatibility, and updates `src/ml/modelRegistry.js`:

```powershell
python export_app_model.py --weights runs/circuit_v2/weights/best.pt --imgsz 416
```

Verify the exported TensorFlow.js model directly in Node.js using the app's exact `src/ml/yolo.js` post-processing code:

```powershell
cd ..
node scripts/test-detector.mjs
```

Then start Expo with a clean Metro cache:
```powershell
npx expo start -c
```
