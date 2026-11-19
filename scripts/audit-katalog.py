#!/usr/bin/env python3
"""Audit angka katalog terhadap teks artikel sumbernya.

Katalog menyimpan angka teknis (tenaga, torsi, berat, 0-100, vmax) yang harus
berasal dari artikel di field `sumber`. Skrip ini mengambil teks artikel itu
(di-cache di /tmp/audit) dan memeriksa apakah angkanya benar-benar muncul.

Angka yang tidak muncul BUKAN otomatis salah: artikel bisa menuliskannya dalam
satuan lain (kW, hp) atau angka itu ada di infobox yang tidak ikut teks polos.
Tapi setiap temuan wajib diperiksa manual, dan skrip ini menunjukannya.

Pemakaian:
    python3 scripts/audit-katalog.py              # semua entri
    python3 scripts/audit-katalog.py --slug bmw   # entri yang slug-nya memuat "bmw"
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

CACHE = "/tmp/audit"
UA = "AIStudioOtomotif/1.0 (audit data katalog; hubungi lewat repo)"
FIELDS = ["tenaga", "torsi", "berat", "nol100", "vmax"]


def _get(params: dict, tries: int = 4) -> dict:
    """Wikipedia membalas 429 saat burst; jeda makin panjang tiap percobaan."""
    api = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({**params, "format": "json"})
    for i in range(tries):
        try:
            req = urllib.request.Request(api, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.load(r)
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(8 * (i + 1))
    raise RuntimeError("tidak tercapai")


def article_text(url: str) -> str:
    """Teks polos + wikitext infobox.

    Angka berat dan torsi biasanya hanya ada di infobox, yang tidak ikut pada
    `prop=extracts`. Tanpa infobox, audit akan menuduh ratusan angka benar
    sebagai karangan.
    """
    title = urllib.parse.unquote(url.rsplit("/", 1)[-1])
    path = os.path.join(CACHE, re.sub(r"[^A-Za-z0-9_.-]", "_", title) + ".txt")
    if os.path.exists(path):
        return open(path).read()
    plain = _get({"action": "query", "prop": "extracts", "explaintext": "1",
                  "titles": title, "redirects": "1"})
    text = list(plain["query"]["pages"].values())[0].get("extract", "")
    time.sleep(3)
    try:
        box = _get({"action": "parse", "page": title, "prop": "wikitext",
                    "section": "0", "redirects": "1"})
        text += "\n" + box["parse"]["wikitext"]["*"]
    except Exception as e:
        print(f"   (infobox {title} gagal: {e})")
    os.makedirs(CACHE, exist_ok=True)
    open(path, "w").write(text)
    time.sleep(3)
    return text


def numbers_in(value: str) -> list[float]:
    """Ambil angka dari nilai katalog; "1.450 kg" -> 1450, "3,2 dtk" -> 3.2."""
    out = []
    for raw in re.findall(r"\d[\d.,]*", value):
        raw = raw.rstrip(".,")
        if re.fullmatch(r"\d{1,3}([.,]\d{3})+", raw):          # pemisah ribuan
            out.append(float(raw.replace(".", "").replace(",", "")))
        else:
            out.append(float(raw.replace(",", ".")))
    return out


def appears(num: float, text: str) -> bool:
    if num >= 1000:                                            # 1450 / 1,450 / 1.450
        alts = {str(int(num)), f"{int(num):,}", f"{int(num):.0f}".replace(".", "")}
    else:
        alts = {str(int(num)) if num == int(num) else str(num).replace(".", "."),
                f"{num:g}", f"{num:.1f}".replace(".", ",")}
    return any(re.search(r"(?<![\d.])" + re.escape(a) + r"(?![\d])", text) for a in alts)


def main() -> int:
    cat = json.load(open("config/catalog.json"))
    only = sys.argv[sys.argv.index("--slug") + 1] if "--slug" in sys.argv else ""
    models = [m for m in cat["models"] if only in m["slug"]]
    flagged = 0
    for m in models:
        try:
            text = article_text(m["sumber"])
        except Exception as e:
            print(f"?? {m['slug']}: gagal ambil sumber ({e})")
            flagged += 1
            continue
        missing = [f for f in FIELDS if not all(appears(n, text) for n in numbers_in(m[f]))]
        mark = "!!" if missing else "ok"
        print(f"{mark} {m['slug']:<30} {len(text):>6} chars" + (f"  tanpa bukti: {', '.join(missing)}" if missing else ""))
        flagged += bool(missing)
    print(f"\n{flagged}/{len(models)} entri perlu diperiksa")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
