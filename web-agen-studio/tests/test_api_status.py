"""Uji endpoint status: angka UI harus berasal dari file, bukan dari HTML.

Jalankan: python3 tests/test_api_status.py
"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts import serve_ui  # noqa: E402


def main() -> int:
    gagal = []

    # 1. Tanpa laporan: jujur bilang belum ada, bukan mengarang angka.
    with tempfile.TemporaryDirectory() as tmp:
        serve_ui.LAPORAN = os.path.join(tmp, "report.json")
        serve_ui.VIDEO_DIR = os.path.join(tmp, "video")
        data = serve_ui.status()
        if data.get("ok") is not False or "alasan" not in data:
            gagal.append("tanpa laporan seharusnya ok=false + alasan")

    # 2. Dengan laporan: nilai diteruskan apa adanya.
    with tempfile.TemporaryDirectory() as tmp:
        os.makedirs(os.path.join(tmp, "video"))
        with open(os.path.join(tmp, "video", "hero.mp4"), "wb") as f:
            f.write(b"\0" * 4096)
        laporan = {
            "durasi": 30.0, "codec": "h264", "resolusi": "1920x1080", "audio": True,
            "gerak_antar_frame": 13.08, "overtake": 4, "hero_sendirian": True,
            "brightness_akhir": 8.6, "lulus": True, "gagal": [],
        }
        jalur = os.path.join(tmp, "report.json")
        with open(jalur, "w", encoding="utf-8") as f:
            json.dump(laporan, f)
        serve_ui.LAPORAN = jalur
        serve_ui.VIDEO_DIR = os.path.join(tmp, "video")
        data = serve_ui.status()
        if not data.get("ok"):
            gagal.append("laporan ada tapi ok bukan true")
        if data["gerbang"].get("gerak_antar_frame") != 13.08:
            gagal.append("gerak_antar_frame tidak diteruskan")
        if data["video"]["byte"] != 4096:
            gagal.append("ukuran file tidak dibaca dari disk")
        daftar = serve_ui.jobs()
        if daftar["jumlah"] != 1 or daftar["jobs"][0]["id"] != "hero":
            gagal.append("daftar job tidak membaca out/video")

    for g in gagal:
        print("GAGAL:", g)
    print(f"{3 if not gagal else 0} bagian lulus, {len(gagal)} gagal")
    return 1 if gagal else 0


if __name__ == "__main__":
    raise SystemExit(main())
