#!/usr/bin/env python3
"""Pemanggil API media generatif yang seragam untuk gambar dan video.

Kunci API hanya dibaca dari lingkungan. Skrip menolak berjalan bila kunci atau
endpoint kosong, sehingga tidak pernah ada kredensial yang tertulis di kode.

Contoh:
    python3 generate_media.py --kind image --prompt "kopi latte, sinematik"
    python3 generate_media.py --kind video --prompt "uap mengepul, kamera mendekat" \
        --duration 5 --out output/kopi.mp4 --dry-run
"""

from __future__ import annotations

import argparse
import base64
import http.client
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ENV = {
    "image": ("IMAGE_PROVIDER_URL", "IMAGE_PROVIDER_API_KEY"),
    "video": ("VIDEO_PROVIDER_URL", "VIDEO_PROVIDER_API_KEY"),
}

EXT = {"image": ".png", "video": ".mp4"}

# Kegagalan yang tidak akan berubah bila diulang; jangan buang waktu pengguna.
FATAL = {400, 401, 403, 404, 422}


def request_json(url: str, key: str, body: dict, timeout: int = 180) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:500]
        hint = " (jangan diulang, perbaiki kredensial/prompt dulu)" if exc.code in FATAL else ""
        raise SystemExit(f"gagal: HTTP {exc.code}{hint}\n{detail}") from None
    except urllib.error.URLError as exc:
        raise SystemExit(f"gagal: tidak bisa menghubungi penyedia ({exc.reason})") from None
    except http.client.HTTPException as exc:
        # Koneksi diputus di tengah respons; tanpa ini pengguna melihat traceback.
        raise SystemExit(f"gagal: koneksi ke penyedia terputus ({type(exc).__name__})") from None
    except json.JSONDecodeError:
        raise SystemExit("gagal: penyedia mengembalikan respons yang bukan JSON") from None


def download(url: str, dest: Path, timeout: int = 300) -> int:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as res:
            payload = res.read()
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"gagal mengunduh hasil: HTTP {exc.code}") from None
    except (urllib.error.URLError, http.client.HTTPException) as exc:
        raise SystemExit(f"gagal mengunduh hasil: {exc}") from None
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(payload)
    return len(payload)


def build_body(args: argparse.Namespace) -> dict:
    if args.kind == "image":
        body = {
            "model": args.model,
            "prompt": args.prompt,
            "aspect_ratio": args.aspect,
            "n": args.count,
        }
    else:
        body = {
            "model": args.model,
            "prompt": args.prompt,
            "aspect_ratio": args.aspect,
            "duration": args.duration,
        }
    if args.negative:
        body["negative_prompt"] = args.negative
    if args.image and args.kind == "video":
        # Image-to-video: gerakan mengikuti gambar acuan, jadi prompt sebaiknya
        # hanya berisi gerakan. Mengulang deskripsi gambar membuat klip beku.
        body["image"] = args.image
    return body


def wait_for_video(url: str, key: str, timeout: int, interval: int) -> dict:
    """Sebagian penyedia video mengembalikan id tugas, bukan url langsung."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"})
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                data = json.loads(res.read().decode())
        except urllib.error.HTTPError as exc:
            raise SystemExit(f"gagal memeriksa status: HTTP {exc.code}") from None
        except (urllib.error.URLError, http.client.HTTPException) as exc:
            raise SystemExit(f"gagal memeriksa status: {exc}") from None
        if data.get("url"):
            return data
        if data.get("status") in {"failed", "error", "cancelled"}:
            raise SystemExit(f"penyedia melaporkan gagal: {data.get('status')}")
        time.sleep(interval)
    raise SystemExit(f"waktu habis menunggu video setelah {timeout} detik")


def main() -> int:
    parser = argparse.ArgumentParser(description="Buat gambar atau video lewat API penyedia.")
    parser.add_argument("--kind", choices=["image", "video"], required=True)
    parser.add_argument("--prompt", required=True, help="prompt positif yang sudah dirumuskan")
    parser.add_argument("--negative", default="", help="prompt negatif, mis. 'blur, watermark'")
    parser.add_argument("--aspect", default="", help="rasio, mis. 16:9 / 9:16 / 1:1")
    parser.add_argument("--duration", type=int, default=5, help="detik, hanya untuk video")
    parser.add_argument("--count", type=int, default=1, help="jumlah variasi, hanya untuk gambar")
    parser.add_argument("--model", default="", help="nama model penyedia; kosong = default penyedia")
    parser.add_argument("--image", default="", help="gambar acuan untuk image-to-video (URL atau path)")
    parser.add_argument("--out", default="", help="path berkas hasil")
    parser.add_argument("--poll-url", default="", help="URL status untuk penyedia video asinkron")
    parser.add_argument("--poll-timeout", type=int, default=600)
    parser.add_argument("--poll-interval", type=int, default=10)
    parser.add_argument("--dry-run", action="store_true", help="cetak body permintaan lalu berhenti")
    args = parser.parse_args()

    url_var, key_var = ENV[args.kind]
    endpoint = os.environ.get(url_var, "").strip()
    key = os.environ.get(key_var, "").strip()
    if not endpoint:
        print(f"{url_var} kosong. Set endpoint penyedia dulu.", file=sys.stderr)
        return 2
    if not key:
        print(f"{key_var} kosong. Jangan menulis kunci di kode; set lewat lingkungan.", file=sys.stderr)
        return 2

    body = build_body(args)
    if args.dry_run:
        print(json.dumps({"endpoint": endpoint, "body": body}, indent=2, ensure_ascii=False))
        print(f"(kunci {key_var} terpasang, tidak dicetak)", file=sys.stderr)
        return 0

    result = request_json(endpoint, key, body)
    if args.poll_url and not result.get("url"):
        result = wait_for_video(args.poll_url, key, args.poll_timeout, args.poll_interval)

    dest = Path(args.out) if args.out else Path("output") / f"media-{int(time.time())}{EXT[args.kind]}"
    if result.get("url"):
        size = download(result["url"], dest)
    else:
        items = result.get("data") or []
        first = items[0] if items else {}
        if first.get("b64_json"):
            dest.parent.mkdir(parents=True, exist_ok=True)
            payload = base64.b64decode(first["b64_json"])
            dest.write_bytes(payload)
            size = len(payload)
        elif first.get("url"):
            size = download(first["url"], dest)
        else:
            print("Respons penyedia tidak dikenali:", json.dumps(result)[:400], file=sys.stderr)
            return 1

    print(json.dumps({"path": str(dest), "bytes": size}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
