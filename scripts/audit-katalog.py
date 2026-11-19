#!/usr/bin/env python3
"""Audit angka katalog terhadap artikel sumbernya di Wikipedia.

Setiap angka teknis di `config/catalog.json` harus bisa dibuktikan dari artikel
yang ditulis di field `sumber`. Tanpa pemeriksaan ini, angka karangan lolos ke
video dan merusak kredibilitas seluruh kanal.

Kesulitan utamanya: Wikipedia menulis angka lewat templat `{{convert}}`, jadi
nilai dalam satuan lain (mis. "3308 lb" -> 1500 kg) tidak muncul sebagai teks.
Skrip ini mengembangbiakkan templat itu sebelum membandingkan, sehingga yang
tersisa benar-benar angka tanpa dasar.

Pemakaian:
    python3 scripts/audit-katalog.py                # semua entri
    python3 scripts/audit-katalog.py --slug ferrari # saring slug
    python3 scripts/audit-katalog.py --refresh      # buang cache artikel

Kode keluar 1 bila ada angka tanpa bukti, supaya bisa dipakai di CI.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

CACHE = "/tmp/audit-katalog"
UA = "AIStudioOtomotif/1.0 (audit data katalog; hubungi lewat repo)"
FIELDS = ["tenaga", "torsi", "berat", "nol100", "vmax"]

# Satuan yang dipakai templat convert -> faktor ke satuan dasar tiap dimensi.
POWER = {"ps": 1.0, "hp": 1.0142, "kw": 1.3596, "bhp": 1.0142}
TORQUE = {"nm": 1.0, "n.m": 1.0, "n⋅m": 1.0, "lbft": 1.3558, "lbf-ft": 1.3558}
MASS = {"kg": 1.0, "lb": 0.45359237}
SPEED = {"km/h": 1.0, "kph": 1.0, "mph": 1.609344}
TIME = {"s": 1.0, "sec": 1.0, "seconds": 1.0}
DIMENSIONS = [POWER, TORQUE, MASS, SPEED, TIME]


def _get(params: dict, tries: int = 5) -> dict:
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
            time.sleep(6 * (i + 1))
    raise RuntimeError("tidak tercapai")


def article_text(url: str) -> str:
    """Teks polos + wikitext infobox, di-cache per judul artikel.

    `prop=extracts` tidak memuat infobox, padahal di situlah berat dan torsi
    biasanya berada; tanpa wikitext, audit akan menuduh angka benar sebagai
    karangan.
    """
    title = re.sub(r"\s*\(bagian[^)]*\)$", "", urllib.parse.unquote(url.rsplit("/", 1)[-1]))
    path = os.path.join(CACHE, re.sub(r"[^A-Za-z0-9_.-]", "_", title) + ".txt")
    if os.path.exists(path):
        return open(path).read()
    plain = _get({"action": "query", "prop": "extracts", "explaintext": "1",
                  "titles": title, "redirects": "1"})
    text = list(plain["query"]["pages"].values())[0].get("extract", "")
    time.sleep(2)
    try:
        box = _get({"action": "parse", "page": title, "prop": "wikitext",
                    "section": "0", "redirects": "1"})
        text += "\n" + box["parse"]["wikitext"]["*"]
    except Exception as e:
        print(f"   (infobox {title} gagal: {e})", file=sys.stderr)
    os.makedirs(CACHE, exist_ok=True)
    open(path, "w").write(text)
    time.sleep(2)
    return text


def expand_convert(text: str) -> str:
    """Tambahkan nilai hasil konversi templat {{convert|...}} ke dalam teks."""
    extra: list[str] = []

    def one(m: re.Match) -> str:
        parts = [p.strip() for p in m.group(1).split("|")]
        nums = [p for p in parts[:1] if re.fullmatch(r"-?\d+(\.\d+)?", p)]
        units = [p.lower() for p in parts[1:] if p.lower() in
                 {u for d in DIMENSIONS for u in d}]
        if not nums or not units:
            return m.group(0)
        value = float(nums[0])
        src = next(d for d in DIMENSIONS if units[0] in d)
        for u in units[1:]:
            dim = next((d for d in DIMENSIONS if u in d), None)
            if dim is not src:
                continue
            converted = value * src[units[0]] / dim[u]
            extra.append(f"{converted:.0f} {converted:.1f}")
        return m.group(0)

    re.sub(r"\{\{[Cc]onvert\|([^{}]*)\}\}", one, text)
    return text + " " + " ".join(extra)


def flatten(text: str) -> str:
    # Jangan membuang <ref>…</ref>: bila tag tidak berpasangan, regex rakus akan
    # menelan infobox sekaligus dan membuat angka yang benar tampak hilang.
    text = re.sub(r"<ref[^>]*/>", " ", text)
    text = re.sub(r"\[\[([^\]|]*\|)?([^\]]*)\]\]", r"\2", text)
    text = re.sub(r"<!--.*?-->", " ", text, flags=re.S)
    text = text.replace("&nbsp;", " ").replace("&ndash;", "-").replace("&minus;", "-")
    return re.sub(r"\s+", " ", text)


def numbers_in(value: str) -> list[float]:
    out = []
    for raw in re.findall(r"\d[\d.,]*", value):
        raw = raw.rstrip(".,")
        if re.fullmatch(r"\d{1,3}([.,]\d{3})+", raw):           # 1.450 / 1,450 = seribu
            out.append(float(raw.replace(".", "").replace(",", "")))
        else:
            out.append(float(raw.replace(",", ".")))
    return out


def present(num: float, text: str) -> bool:
    """Angka dianggap ada bila muncul sebagai angka utuh (bukan potongan)."""
    for cand in {num, round(num), float(int(num))}:
        # Wikipedia menulis ribuan sebagai "1,450" atau "1.450"; keduanya sah.
        for s in {f"{cand:g}", f"{cand:.1f}", f"{cand:.0f}",
                  f"{cand:,.0f}", f"{cand:,.0f}".replace(",", ".")}:
            if re.search(r"(?<![\d.])" + re.escape(s) + r"(?![\d])", text):
                return True
    return False


def main() -> int:
    if "--refresh" in sys.argv and os.path.isdir(CACHE):
        for f in os.listdir(CACHE):
            os.remove(os.path.join(CACHE, f))
    only = sys.argv[sys.argv.index("--slug") + 1] if "--slug" in sys.argv else ""
    cat = json.load(open("config/catalog.json"))
    models = [m for m in cat["models"] if only in m["slug"]]

    flagged = 0
    for m in models:
        try:
            text = flatten(expand_convert(article_text(m["sumber"])))
        except Exception as e:
            print(f"?? {m['slug']}: sumber tak terbaca ({e})")
            flagged += 1
            continue
        miss = {
            f: [n for n in numbers_in(m[f]) if not present(n, text)]
            for f in FIELDS
            if "tidak disebut" not in m[f]
        }
        miss = {k: v for k, v in miss.items() if v}
        if miss:
            flagged += 1
            detail = ", ".join(f"{k}={v}" for k, v in miss.items())
            print(f"!! {m['slug']:<30} tanpa bukti: {detail}")
        else:
            print(f"ok {m['slug']}")

    print(f"\n{flagged}/{len(models)} entri punya angka tanpa bukti")
    return 1 if flagged else 0


if __name__ == "__main__":
    raise SystemExit(main())
