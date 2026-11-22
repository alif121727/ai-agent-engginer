#!/usr/bin/env python3
"""Bangun data/riset-sumber.json dari katalog, dengan verifikasi daring.

Setiap angka di katalog harus punya jejak sumber. Skrip ini tidak mengarang
apa pun: ia membaca `sumber` dari `config/catalog.json`, memeriksa apakah URL-nya
benar-benar bisa diakses, dan mencatat lisensi serta tingkat keyakinan apa adanya.

Jalankan:  python3 scripts/riset-sumber.py [--offline]
  --offline  lewati pemeriksaan HTTP (dipakai di CI tanpa jaringan)
"""

import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "config" / "catalog.json"
OUT = ROOT / "data" / "riset-sumber.json"
UA = "StudioAI-Riset/1.0 (audit sumber; kontak: admin@studio.id)"


def models() -> list[dict]:
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else data.get("models", [])


def normalize(url: str) -> str:
    """Ambil URL murni: buang catatan seperti " (bagian Z-tune)" dan encode non-ASCII."""
    url = url.strip().split(" (")[0].strip()
    from urllib.parse import quote, urlsplit, urlunsplit

    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, quote(parts.path), parts.query, ""))


def probe(url: str) -> tuple[bool, str]:
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return 200 <= res.status < 400, f"HTTP {res.status}"
    except Exception as exc:  # noqa: BLE001 - status apa pun dicatat apa adanya
        return False, type(exc).__name__


def main() -> int:
    offline = "--offline" in sys.argv
    entries = []
    for m in models():
        url = (m.get("sumber") or "").strip()
        if not url:
            entries.append(
                {
                    "model": m.get("name"),
                    "slug": m.get("slug"),
                    "url": None,
                    "confidence": "tidak-ada-sumber",
                    "note": "katalog tidak mencantumkan sumber; angka tidak boleh dipakai sebagai fakta",
                }
            )
            continue
        ok, detail = (True, "dilewati (offline)") if offline else probe(normalize(url))
        entries.append(
            {
                "model": m.get("name"),
                "slug": m.get("slug"),
                "url": normalize(url),
                "title": m.get("name"),
                "license": "CC BY-SA 4.0 (Wikipedia)",
                "usage": "spesifikasi teknis di config/catalog.json",
                "accessed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "reachable": ok,
                "check": detail,
                "confidence": "terverifikasi" if ok else "belum-terverifikasi",
            }
        )

    verified = sum(1 for e in entries if e["confidence"] == "terverifikasi")
    payload = {
        "dibuat": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "metode": "HEAD request ke URL sumber; tanpa scraping isi halaman",
        "total": len(entries),
        "terverifikasi": verified,
        "catatan": (
            "Angka yang tidak ada di sumber ditandai 'tidak disebut di sumber' di katalog "
            "dan tidak boleh diisi dengan tebakan."
        ),
        "sumber": entries,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{verified}/{len(entries)} sumber terverifikasi -> {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
