"""Server statis + API status untuk UI studio.

Menyalakan satu port (bawaan 12000) yang menyajikan folder demo dan dua
endpoint JSON:

  GET /api/status  -> isi laporan render terakhir apa adanya (dari file)
  GET /api/jobs    -> daftar job yang ada di out/video

Prinsipnya: angka yang ditampilkan UI harus berasal dari file yang benar-benar
ada, bukan dari angka yang ditulis tangan di HTML. Kalau laporan belum ada,
endpoint menjawab jujur dengan ok=false dan alasan.
"""
import argparse
import json
import os
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAPORAN = os.path.join(ROOT, "logs", "video-check", "report.json")
VIDEO_DIR = os.path.join(ROOT, "out", "video")
KUNCI_GERBANG = ("durasi", "codec", "resolusi", "audio", "gerak_antar_frame",
                 "overtake", "hero_sendirian", "brightness_akhir", "lulus", "gagal")


def _baca(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _ukuran(path: str) -> int:
    return os.path.getsize(path) if os.path.exists(path) else 0


def status() -> dict:
    if not os.path.exists(LAPORAN):
        return {"ok": False, "alasan": "belum ada logs/video-check/report.json",
                "diperiksa": time.strftime("%Y-%m-%dT%H:%M:%S")}
    laporan = _baca(LAPORAN)
    video = None
    if os.path.isdir(VIDEO_DIR):
        for nama in sorted(os.listdir(VIDEO_DIR)):
            if not nama.endswith(".mp4"):
                continue
            jalur = os.path.join(VIDEO_DIR, nama)
            calon = {"file": nama, "byte": _ukuran(jalur),
                     "diubah": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(os.path.getmtime(jalur)))}
            if nama == "hero.mp4" or video is None:
                video = calon
    return {
        "ok": True,
        "video": video,
        "gerbang": {k: laporan[k] for k in KUNCI_GERBANG if k in laporan},
        "diperiksa": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "sumber": os.path.relpath(LAPORAN, ROOT),
    }


def jobs() -> dict:
    daftar = []
    if os.path.isdir(VIDEO_DIR):
        for nama in sorted(os.listdir(VIDEO_DIR)):
            if not nama.endswith(".mp4"):
                continue
            jalur = os.path.join(VIDEO_DIR, nama)
            meta_path = jalur + ".meta.json"
            meta = _baca(meta_path) if os.path.exists(meta_path) else {}
            daftar.append({
                "id": nama[:-4],
                "file": nama,
                "byte": _ukuran(jalur),
                "diubah": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(os.path.getmtime(jalur))),
                "meta": meta,
            })
    return {"ok": True, "jumlah": len(daftar), "jobs": daftar}


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 (nama dari http.server)
        jalur = self.path.split("?")[0]
        if jalur in ("/api/status", "/api/jobs"):
            data = status() if jalur == "/api/status" else jobs()
            badan = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(badan)))
            self.end_headers()
            self.wfile.write(badan)
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        print("[ui] " + fmt % args, flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="/tmp/publik", help="folder yang disajikan")
    ap.add_argument("--port", type=int, default=12000)
    args = ap.parse_args()
    os.makedirs(args.dir, exist_ok=True)
    os.chdir(args.dir)
    server = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    print(f"[ui] menyajikan {args.dir} di :{args.port} (API: /api/status, /api/jobs)", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
