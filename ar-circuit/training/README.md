# Circuit Symbol Detector Training Guide (NVIDIA RTX 5050)

This guide walks you through training a YOLOv8-nano circuit symbol detector on your RTX 5050 GPU.

---

## 1. Setup Python Environment & GPU

### Step A: Install PyTorch with CUDA 12.8 (RTX 5050 Support)
If you previously had the CPU version of PyTorch, force-reinstall the CUDA 12.8 build:
```powershell
pip install --force-reinstall torch torchvision --index-url https://download.pytorch.org/whl/cu128
```

Verify your RTX 5050 is recognized by CUDA:
```powershell
python -c "import torch; print('CUDA Available:', torch.cuda.is_available(), '| GPU:', torch.cuda.get_device_name(0))"
```
It must print: `CUDA Available: True | GPU: NVIDIA GeForce RTX 5050 ...`

### Step B: Install the remaining training packages
```powershell
pip install -r requirements.txt
```
*(This now installs cleanly on Windows with no uvloop/Unix errors!)*

---

## 2. Get a Circuit Symbol Dataset

You need hand-drawn circuit diagrams:

### Option A: Roboflow Universe (Recommended & Easiest)
1. Go to [Roboflow Universe](https://universe.roboflow.com/) and search for `circuit diagram` or `hand drawn circuit`.
2. Click **Download Dataset** -> Select format **YOLOv8** -> Download ZIP.
3. Unzip into `ar-circuit/training/dataset/`.
4. Ensure `dataset/data.yaml` exists.

### Option B: CGHD (Circuit Graphs on Hand Drawings)
If downloaded in Pascal VOC XML format:
```powershell
cd "ar-circuit\training"
python prepare_dataset.py --src path/to/cghd_folder --out dataset
```

---

## 3. Train on your RTX 5050

```powershell
cd "ar-circuit\training"
python train.py --data dataset/data.yaml --epochs 100 --batch 32 --imgsz 320
```

- **GPU Acceleration:** Uses your RTX 5050 at full speed (~2.5 GB of your 8 GB VRAM).
- **Time:** ~20–40 minutes.
- **Output:** Saves the best weights to `runs/circuit/weights/best.pt`.

---

## 4. Convert to TensorFlow.js (for Expo Go)

Because Google's `tensorflowjs` python converter has Unix-only dependencies (`uvloop` / `tensorflow-decision-forests`), the cleanest 1-click way to convert `best.pt` to `model.json` + `.bin` is using Google Colab (runs in Linux for free):

1. Open [Google Colab](https://colab.research.google.com/) (New Notebook).
2. Run this 1 cell:
   ```python
   !pip install ultralytics tensorflowjs
   from google.colab import files
   uploaded = files.upload() # Select your best.pt file
   from ultralytics import YOLO
   model = YOLO('best.pt')
   model.export(format='tfjs', imgsz=320)
   !zip -r model_tfjs.zip best_web_model
   files.download('model_tfjs.zip')
   ```
3. Extract the downloaded `model.json` and `.bin` shards into:
   `ar-circuit/assets/model/`
4. Run `python export_tfjs.py` locally to register the files with Metro.

---

## 5. Test in Expo Go

Restart the Expo server with a clean cache:
```powershell
cd ..
npx expo start -c
```
Scan the QR code with your phone. Tap **Scan** in the top bar to run real-time circuit detection!
