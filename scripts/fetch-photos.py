#!/usr/bin/env python3
"""Ambil foto mobil dari Wikimedia Commons ke assets/own/<slug>/.

Dipakai karena foto "asli" dari sumber acak pernah tanpa sengaja berupa foto
pemandangan (picsum), sehingga render menampilkan jalanan, bukan mobil.
Commons memberi atribusi jelas dan gambar benar-benar mobil.

Pemakaian:
    python3 scripts/fetch-photos.py toyota-gr-supra "Toyota GR Supra" 4
    python3 scripts/fetch-photos.py toyota-ae86 "Toyota AE86" 4
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

API = "https://commons.wikimedia.org/w/api.php"
UA = "AIStudioOtomotif/1.0 (aset video otomotif; kontak: lokal)"
WIDTH = 1600
OUT_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "own")


def api(params: dict) -> dict:
    params = {**params, "format": "json"}
    req = urllib.request.Request(
        API + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA}
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def search_files(query: str, limit: int = 20) -> list[str]:
    data = api(
        {
            "action": "query",
            "generator": "search",
            "gsrsearch": f"filetype:bitmap {query}",
            "gsrnamespace": "6",
            "gsrlimit": str(limit),
            "prop": "imageinfo",
            "iiprop": "url|size|mime",
        }
    )
    pages = data.get("query", {}).get("pages", {})
    return [p["title"] for p in pages.values() if p.get("imageinfo")]


def thumb_url(title: str) -> str | None:
    """`iiurlwidth` wajib dipakai: thumb.wikimedia.org menolak ukuran sembarang."""
    data = api(
        {
            "action": "query",
            "titles": title,
            "prop": "imageinfo",
            "iiprop": "url|size|mime|extmetadata",
            "iiurlwidth": str(WIDTH),
        }
    )
    for page in data.get("query", {}).get("pages", {}).values():
        for ii in page.get("imageinfo", []):
            if ii.get("mime") not in {"image/jpeg", "image/png"}:
                continue
            meta = ii.get("extmetadata", {})
            lic = (meta.get("LicenseShortName", {}) or {}).get("value", "")
            artist = re.sub(r"<[^>]+>", "", (meta.get("Artist", {}) or {}).get("value", ""))
            return json.dumps(
                {
                    "url": ii.get("thumburl") or ii["url"],
                    "width": ii.get("thumbwidth") or ii["width"],
                    "license": lic,
                    "artist": artist.strip(),
                }
            )
    return None


def download(url: str, dest: str) -> tuple[int, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        blob = r.read()
    if len(blob) < 20_000:
        raise RuntimeError(f"terlalu kecil ({len(blob)} B)")
    with open(dest, "wb") as f:
        f.write(blob)
    return len(blob), blob


# Hitam-putih dan hasil retouch sering muncul sebagai file terpisah di Commons;
# memasukkannya membuat storyboard terasa acak, jadi disaring dari nama file.
SKIP = re.compile(r"(\bbw\b|black.and.white|monochrome|grayscale|\(b&w\)|interior|engine|dashboard)", re.I)


def fingerprint(blob: bytes) -> bytes:
    """Sidik isi file; dua URL berbeda bisa berisi gambar yang sama."""
    import hashlib
    return hashlib.sha1(blob).digest()


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    slug, query = sys.argv[1], sys.argv[2]
    want = int(sys.argv[3]) if len(sys.argv) > 3 else 4

    dest_dir = os.path.join(OUT_ROOT, slug)
    os.makedirs(dest_dir, exist_ok=True)

    titles = search_files(query, limit=30)
    if not titles:
        print(f"tidak ada hasil untuk {query!r}")
        return 1

    credits = []
    seen: set[bytes] = set()
    n = 0
    for title in titles:
        if n >= want:
            break
        if SKIP.search(title):
            print(f"  lewati (bw/interior) {title}")
            continue
        try:
            info = thumb_url(title)
            if not info:
                continue
            info = json.loads(info)
            dest = os.path.join(dest_dir, f"foto-{n + 1}.jpg")
            size, blob = download(info["url"], dest)
            fp = fingerprint(blob)
            if fp in seen:
                os.remove(dest)
                print(f"  lewati (duplikat) {title}")
                continue
            seen.add(fp)
            credits.append({**info, "file": os.path.basename(dest), "title": title})
            print(f"  ok {os.path.basename(dest)} {size // 1024} KB  {title}")
            n += 1
            time.sleep(1.5)  # 429 kalau burst
        except Exception as e:  # satu gambar gagal tidak membatalkan sisanya
            print(f"  lewati {title}: {e}")

    if credits:
        with open(os.path.join(dest_dir, "KREDIT.json"), "w") as f:
            json.dump({"query": query, "sumber": "Wikimedia Commons", "foto": credits}, f, indent=1)
    print(f"{n}/{want} foto -> {dest_dir}")
    return 0 if n else 1


if __name__ == "__main__":
    raise SystemExit(main())
