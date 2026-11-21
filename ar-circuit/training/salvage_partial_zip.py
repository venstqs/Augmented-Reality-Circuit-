"""
Recover complete files from a PARTIALLY downloaded zip (no central directory).

Walks local file headers (PK\x03\x04) sequentially and stream-inflates each
entry. Entries cut off by the end of the partial file are skipped.

    python salvage_partial_zip.py --zip cghd_raw/cghd-zenodo-12.zip --out cghd_partial
"""
import argparse
import struct
import zlib
from pathlib import Path

LOCAL_SIG = b"PK\x03\x04"
HDR = struct.Struct("<4sHHHHHIIIHH")  # 30 bytes
CHUNK = 1 << 20


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", required=True)
    ap.add_argument("--out", default="cghd_partial")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(exist_ok=True)
    data = Path(args.zip).read_bytes()  # snapshot of current size
    n = len(data)
    mv = memoryview(data)
    pos = ok = cut = 0

    while pos + HDR.size <= n:
        if data[pos:pos + 4] != LOCAL_SIG:
            nxt = data.find(LOCAL_SIG, pos + 1)
            if nxt < 0:
                break
            pos = nxt
            continue
        _, _, flags, method, _, _, _, csize, _, fnlen, exlen = HDR.unpack_from(data, pos)
        name = data[pos + 30:pos + 30 + fnlen].decode("utf-8", "replace")
        start = pos + 30 + fnlen + exlen
        if start > n:
            cut += 1
            break

        if method == 8:  # deflate: inflate in chunks until the stream ends
            d = zlib.decompressobj(-15)
            parts, p, bad = [], start, False
            while not d.eof and p < n:
                chunk = mv[p:p + CHUNK]
                try:
                    parts.append(d.decompress(chunk))
                except zlib.error:
                    bad = True
                    break
                consumed = len(chunk) - len(d.unused_data)
                p += consumed
            if bad:
                pos = start
                continue
            if not d.eof:
                cut += 1  # truncated by end of partial download
                break
            end = p
            content = b"".join(parts)
        elif method == 0 and not (flags & 0x08):
            end = start + csize
            if end > n:
                cut += 1
                break
            content = data[start:end]
        else:
            pos = start
            continue

        if flags & 0x08:  # skip data descriptor (optional signature + 12/16 bytes)
            end += 16 if data[end:end + 4] == b"PK\x07\x08" else 12

        if not name.endswith("/") and ".." not in name:
            dst = out / name
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(content)
            ok += 1
        pos = end

    print(f"Recovered {ok} complete files into {out}/ (stopped at {pos / 1e6:.1f} of {n / 1e6:.1f} MB, truncated: {cut})")


if __name__ == "__main__":
    main()
