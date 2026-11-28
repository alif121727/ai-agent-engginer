"""Gate video (T13/T14/T16/T17): bukti dari file, bukan dari niat kode."""
import json
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline.video.traffic import SOLO_FROM, events, traffic_at  # noqa: E402

FF = "/workspace/tools/bin/ffmpeg" if os.path.exists("/workspace/tools/bin/ffmpeg") else "ffmpeg"
FP = "/workspace/tools/bin/ffprobe" if os.path.exists("/workspace/tools/bin/ffprobe") else "ffprobe"


def probe(path: str) -> dict:
    out = subprocess.run(
        [FP, "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate",
         "-of", "json", path], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def frame(path: str, at: float, w: int = 320, h: int = 180) -> np.ndarray:
    raw = subprocess.run(
        [FF, "-v", "error", "-ss", str(at), "-i", path, "-frames:v", "1",
         "-vf", f"scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(h, w).astype(np.float32)


def main(video: str, dur: float) -> int:
    info = probe(video)
    v = info["streams"][0]
    dur_ff = float(info["format"]["duration"])
    fps = eval(v["r_frame_rate"]) if isinstance(v, str) else dur
    hasil = {
        "durasi": dur_ff,
        "fps": v.get("r_frame_rate"),
        "codec": v.get("codec_name"),
        "resolusi": f'{v.get("width")}x{v.get("height")}',
        "audio": any(s.get("codec_type") == "audio" for s in info.get("streams", [])),
    }

    awal, tengah, akhir = frame(video, 0.5), frame(video, dur / 2), frame(video, dur - 0.4)
    hasil["brightness_awal"] = round(float(awal.mean()), 1)
    hasil["brightness_tengah"] = round(float(tengah.mean()), 1)
    hasil["brightness_akhir"] = round(float(akhir.mean()), 1)
    hasil["gerak_awal_tengah"] = round(float(np.abs(awal - tengah).mean()), 1)

    f1, f2 = frame(video, 10.0), frame(video, 10.1)
    hasil["gerak_antar_frame"] = round(float(np.abs(f1 - f2).mean()), 2)

    hasil["overtake"] = len(events(dur))
    hasil["hero_sendirian"] = len(traffic_at(SOLO_FROM * dur + 1.0, dur, 1920)) == 0

    gagal = []
    if abs(dur_ff - dur) > 0.25:
        gagal.append(f"durasi {dur_ff} != {dur}")
    if v.get("codec_name") != "h264":
        gagal.append(f"codec {v.get('codec_name')}")
    if not hasil["audio"]:
        gagal.append("tidak ada audio")
    if hasil["gerak_antar_frame"] < 0.5:
        gagal.append("frame 10.0 vs 10.1 tidak bergerak")
    if hasil["brightness_akhir"] > 12:
        gagal.append(f"fade akhir kurang gelap ({hasil['brightness_akhir']})")
    if hasil["overtake"] < 3:
        gagal.append("overtake < 3")
    if not hasil["hero_sendirian"]:
        gagal.append("masih ada traffic setelah 23 dtk")
    hasil["lulus"] = not gagal
    hasil["gagal"] = gagal

    os.makedirs("logs/video-check", exist_ok=True)
    for nama, t in (("awal", 0.5), ("tengah", dur / 2), ("akhir", dur - 0.4)):
        subprocess.run([FF, "-v", "error", "-y", "-ss", str(t), "-i", video, "-frames:v", "1",
                        f"logs/video-check/{nama}.jpg"], check=True)
    with open("logs/video-check/report.json", "w") as f:
        json.dump(hasil, f, indent=2)

    print(json.dumps(hasil, indent=2))
    return 0 if hasil["lulus"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "out/video/hero.mp4",
                  float(sys.argv[2]) if len(sys.argv) > 2 else 30.0))
