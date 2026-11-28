"""Rantai TTS: edge-tts -> piper -> gTTS -> espeak-ng, dengan cache + validasi.

Aturan penting: SSML hanya diberikan ke mesin yang memahaminya (edge-tts).
Piper akan membacakan tag SSML sebagai teks kalau diberi SSML, jadi mesin lain
menerima teks yang sudah dinormalisasi saja.
"""
import asyncio
import hashlib
import json
import os
import subprocess
import sys
import wave

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from pipeline.voice import ssml as ssml_mod  # noqa: E402
from pipeline.voice.normalize import load_dict, normalize  # noqa: E402
from pipeline.voice.validate import check as validate_check  # noqa: E402

CACHE = os.path.join("out", "audio", "cache")
PIPER_CANDIDATES = [
    os.environ.get("PIPER_MODEL", ""),
    "/workspace/project/assets/tts/id_ID-news_tts-medium.onnx",
    "assets/tts/id_ID-news_tts-medium.onnx",
]


def _piper_model() -> str:
    for path in PIPER_CANDIDATES:
        if path and os.path.exists(path):
            return path
    return ""


def ffmpeg_bin() -> str:
    lokal = "/workspace/tools/bin/ffmpeg"
    return lokal if os.path.exists(lokal) else "ffmpeg"


def _piper_bin() -> str:
    for path in (os.path.expanduser("~/.local/bin/piper"), "/usr/local/bin/piper", "/usr/bin/piper"):
        if os.path.exists(path):
            return path
    return ""


async def _edge(text: str, out: str) -> None:
    import edge_tts
    styled = ssml_mod.build(text)
    await edge_tts.Communicate(_ssml_to_plain(styled), voice="id-ID-ArdiNeural").save(out)


def _ssml_to_plain(xml: str) -> str:
    import re
    return re.sub(r"<[^>]+>", "", xml).strip()


def _piper(text: str, out: str) -> None:
    model = _piper_model()
    binary = _piper_bin()
    if not model or not binary:
        raise RuntimeError("piper tidak tersedia (biner atau model .onnx tidak ada)")
    wav = out.rsplit(".", 1)[0] + ".piper.wav"
    # Piper memotong suku kata terakhir tanpa penutup baris ("detik" -> "diti").
    # Pidato sedikit lebih lambat + jeda antarkalimat: angka panjang ("satu
    # miliar dua ratus empat puluh juta") tidak terbaca beruntun.
    subprocess.run(
        [binary, "--model", model, "--output_file", wav,
         "--length_scale", "1.12", "--sentence_silence", "0.35"],
        input=(text + "\n").encode(), check=True,
    )
    subprocess.run([ffmpeg_bin(), "-v", "error", "-y", "-i", wav, "-ar", "48000", "-ac", "1", out], check=True)
    os.remove(wav)


def _gtts(text: str, out: str) -> None:
    from gtts import gTTS
    gTTS(text=text, lang="id").save(out)


def _espeak(text: str, out: str) -> None:
    subprocess.run(["espeak-ng", "-v", "id", "-w", out, text], check=True)


ENGINES = {"edge": _edge, "piper": _piper, "gtts": _gtts, "espeak": _espeak}


def _cache_key(text: str, engine: str) -> str:
    return hashlib.sha1(f"{engine}|{text}".encode()).hexdigest()[:16]


def synth(text: str, out: str, tone: str = "santai", prefer: str = None,
          validate: bool = True) -> dict:
    dict_pron = load_dict()
    norm = normalize(text, tone=tone, dict_pron=dict_pron)
    os.makedirs(CACHE, exist_ok=True)
    order = ["edge", "piper", "gtts", "espeak"]
    if prefer:
        order = [prefer] + [e for e in order if e != prefer]

    for eng in order:
        cached = os.path.join(CACHE, _cache_key(norm, eng) + os.path.splitext(out)[1])
        try:
            if os.path.exists(cached) and os.path.getsize(cached) > 1000:
                import shutil
                shutil.copyfile(cached, out)
            else:
                fn = ENGINES[eng]
                if asyncio.iscoroutinefunction(fn):
                    asyncio.run(fn(norm, out))
                else:
                    fn(norm, out)
                if not (os.path.exists(out) and os.path.getsize(out) > 1000):
                    raise RuntimeError("berkas audio kosong")
                import shutil
                shutil.copyfile(out, cached)
            hasil = {"engine": eng, "teks": norm, "out": out, "bytes": os.path.getsize(out)}
            if validate:
                hasil["validasi"] = validate_check(out, norm)
            print(f"[tts] {eng} OK  {out} ({hasil['bytes']} B)")
            return hasil
        except Exception as err:
            print(f"[tts] {eng} gagal: {err}")
    raise RuntimeError("semua engine TTS gagal")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("text")
    ap.add_argument("--out", default="out/audio/klip.mp3")
    ap.add_argument("--tone", default="santai")
    a = ap.parse_args()
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    print(json.dumps(synth(a.text, a.out, tone=a.tone), ensure_ascii=False, indent=2))
