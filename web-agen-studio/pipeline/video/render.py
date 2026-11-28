"""Render frame-by-frame ke mp4. Tidak ada slideshow: setiap frame digambar ulang.

Contoh:
    python3 pipeline/video/render.py --model toyota-gr-supra --dur 5 --out out/video/preview.mp4
    python3 pipeline/video/render.py --model toyota-gr-supra --dur 30 --out out/video/hero.mp4
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from pipeline.video.scenes import SceneGraph  # noqa: E402

ASPECTS = {"16:9": (1920, 1080), "9:16": (1080, 1920), "1:1": (1080, 1080)}


def ffmpeg_bin() -> str:
    lokal = "/workspace/tools/bin/ffmpeg"
    return lokal if os.path.exists(lokal) else "ffmpeg"


def build_audio(path: str, dur: float, speed_profile: np.ndarray, fps: int) -> None:
    """Mesin + angin, sinkron dengan kurva kecepatan (bukan trek statis)."""
    sr = 48000
    n = int(dur * sr)
    t = np.arange(n, dtype=np.float32) / sr
    idx = np.clip((t * fps).astype(int), 0, len(speed_profile) - 1)
    v = speed_profile[idx].astype(np.float32)

    rpm = 900.0 + 5200.0 * v
    firing = rpm / 60.0 * 3.0
    phase = 2 * np.pi * np.cumsum(firing) / sr
    sig = (
        0.55 * np.sin(phase)
        + 0.22 * np.sin(2 * phase + 0.3)
        + 0.12 * np.sin(3 * phase + 0.9)
        + 0.06 * np.sin(0.5 * phase)
    )
    rasp = (np.random.default_rng(4).standard_normal(n).astype(np.float32)) * 0.05 * (0.3 + v)
    tyre = np.random.default_rng(5).standard_normal(n).astype(np.float32) * 0.05 * v
    # Lowpass sederhana untuk angin/ban.
    kernel = np.ones(64, dtype=np.float32) / 64.0
    tyre = np.convolve(tyre, kernel, mode="same")

    mix = (sig * (0.5 + 0.5 * v) + rasp + tyre) * 0.35
    fade = np.ones(n, dtype=np.float32)
    ramp = int(0.6 * sr)
    fade[:ramp] = np.linspace(0.0, 1.0, ramp)
    tail = int(min(2.0, dur / 2) * sr)
    fade[-tail:] = np.linspace(1.0, 0.0, tail)
    mix *= fade

    pcm = np.clip(mix, -1.0, 1.0)
    pcm16 = (pcm * 32000).astype(np.int16)
    stereo = np.repeat(pcm16[:, None], 2, axis=1)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(stereo.tobytes())


def encode_segment(seg_path: str, graph: SceneGraph, start: int, end: int, fps: int, crf: int, preset: str, W: int, H: int) -> None:
    cmd = [
        ffmpeg_bin(), "-v", "error", "-y",
        "-f", "rawvideo", "-vcodec", "rawvideo",
        "-s", f"{W}x{H}", "-pix_fmt", "rgb24", "-r", str(fps),
        "-i", "-",
        "-c:v", "libx264", "-crf", str(crf), "-preset", preset,
        "-pix_fmt", "yuv420p", seg_path,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i in range(start, end):
        proc.stdin.write(graph.render_frame(i).tobytes())
        if i % fps == 0:
            print(f"[video] frame {i}/{end}", flush=True)
    proc.stdin.close()
    if proc.wait() != 0:
        sys.exit("ffmpeg gagal saat menulis segmen")


def concat_segments(parts: list, out: str) -> None:
    listfile = out + ".concat.txt"
    with open(listfile, "w") as f:
        for p in parts:
            f.write(f"file '{os.path.abspath(p)}'\n")
    res = subprocess.run(
        [ffmpeg_bin(), "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", listfile, "-c", "copy", out]
    )
    os.remove(listfile)
    if res.returncode != 0:
        sys.exit("ffmpeg gagal menggabungkan segmen")


def mux_audio(video: str, audio: str, out: str) -> None:
    res = subprocess.run(
        [ffmpeg_bin(), "-v", "error", "-y", "-i", video, "-i", audio,
         "-c:v", "copy", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
         "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", out]
    )
    if res.returncode != 0:
        sys.exit("ffmpeg gagal mux audio")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=None, help="id dari data/mobil.json")
    ap.add_argument("--mobil", default="data/mobil.json")
    ap.add_argument("--out", default="out/video/hero.mp4")
    ap.add_argument("--dur", type=float, default=30.0)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--aspect", default="16:9", choices=list(ASPECTS))
    ap.add_argument("--chunk", type=int, default=120, help="frame per segmen (resume)")
    ap.add_argument("--crf", type=int, default=20)
    ap.add_argument("--preset", default="medium")
    ap.add_argument("--no-audio", action="store_true")
    args = ap.parse_args()

    models = json.load(open(args.mobil))["models"]
    model = next((m for m in models if m["id"] == args.model), None) if args.model else next(
        (m for m in models if m.get("default")), models[0]
    )
    if model is None:
        sys.exit(f"model '{args.model}' tidak ditemukan di {args.mobil}")
    others = [m for m in models if m["id"] != model["id"]]

    W, H = ASPECTS[args.aspect]
    total = int(round(args.dur * args.fps))
    graph = SceneGraph(model, others, W, H, args.fps, args.dur, root=".")

    out_dir = os.path.dirname(args.out) or "."
    os.makedirs(out_dir, exist_ok=True)
    parts_dir = args.out + ".parts"
    os.makedirs(parts_dir, exist_ok=True)

    parts = []
    for ci, start in enumerate(range(0, total, args.chunk)):
        end = min(total, start + args.chunk)
        seg = os.path.join(parts_dir, f"{ci:04d}.mp4")
        parts.append(seg)
        if os.path.exists(seg):
            print(f"[video] segmen {ci} sudah ada, lanjut (resume)", flush=True)
            continue
        encode_segment(seg, graph, start, end, args.fps, args.crf, args.preset, W, H)

    silent = args.out + ".silent.mp4"
    concat_segments(parts, silent)

    if args.no_audio:
        shutil.move(silent, args.out)
    else:
        wav = os.path.join("out", "audio", os.path.basename(args.out) + ".wav")
        build_audio(wav, args.dur, graph.travel / max(1.0, float(graph.travel.max() or 1.0)), args.fps)
        mux_audio(silent, wav, args.out)
        os.remove(silent)

    shutil.rmtree(parts_dir, ignore_errors=True)
    size = os.path.getsize(args.out)
    meta = {
        "model": model["id"],
        "modelName": model["name"],
        "dur": args.dur,
        "fps": args.fps,
        "aspect": args.aspect,
        "width": W,
        "height": H,
        "frames": total,
        "out": args.out,
        "bytes": size,
    }
    with open(args.out + ".meta.json", "w") as f:
        json.dump(meta, f, indent=2)
    print(f"[video] DONE {args.out} ({size/1e6:.1f} MB, {total} frame)")


if __name__ == "__main__":
    main()
