import os
import time
import zipfile
from pathlib import Path
import requests
from tqdm import tqdm

def main():
    print("Fetching Zenodo record for CGHD dataset...")
    record_id = "10056817"
    url = f"https://zenodo.org/api/records/{record_id}"

    r = requests.get(url, timeout=30)
    r.raise_for_status()
    data = r.json()

    files = data.get("files", [])
    if not files:
        print("No files found in the Zenodo record.")
        return

    download_dir = Path("cghd_raw")
    download_dir.mkdir(exist_ok=True)

    for f in files:
        filename = f["key"]
        if not filename.endswith(".zip"):
            continue

        download_link = f["links"]["self"]
        file_path = download_dir / filename
        total_size = f["size"]

        current_size = file_path.stat().st_size if file_path.exists() else 0

        attempt = 0
        while current_size < total_size:
            attempt += 1
            headers = {"Range": f"bytes={current_size}-"} if current_size > 0 else {}
            mode = "ab" if current_size > 0 else "wb"
            print(f"[attempt {attempt}] {filename}: {current_size / (1024**2):.1f} / {total_size / (1024**2):.1f} MB")
            try:
                with requests.get(download_link, headers=headers, stream=True, timeout=60) as resp:
                    resp.raise_for_status()
                    if current_size > 0 and resp.status_code != 206:
                        raise RuntimeError("Server ignored Range header; refusing to corrupt partial file")
                    with open(file_path, mode) as out_file, tqdm(
                        total=total_size, initial=current_size, unit="B",
                        unit_scale=True, unit_divisor=1024, desc=filename, mininterval=10,
                    ) as pbar:
                        for chunk in resp.iter_content(chunk_size=1024 * 64):
                            if chunk:
                                out_file.write(chunk)
                                pbar.update(len(chunk))
            except (requests.RequestException, ConnectionError) as e:
                print(f"Connection dropped ({type(e).__name__}); retrying in 10 s...")
                time.sleep(10)
            current_size = file_path.stat().st_size
        print(f"{filename} complete ({total_size / (1024**2):.1f} MB).")

        # Check if already extracted
        extracted_marker = download_dir / "classes.json"
        if extracted_marker.exists():
            print(f"{filename} is already extracted in {download_dir}.")
        else:
            print(f"Extracting {filename} (this may take a minute)...")
            with zipfile.ZipFile(file_path, "r") as zip_ref:
                zip_ref.extractall(download_dir)
            print("Extraction complete.")

    print("\n[OK] Done! Next step: run prepare_dataset.py to generate YOLO training data:")
    print("     python prepare_dataset.py --src cghd_raw --out dataset")

if __name__ == "__main__":
    main()
