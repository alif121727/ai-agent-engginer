"""Validasi balik TTS dengan STT + skor WER.

Kalau faster-whisper tidak terpasang, hasilnya `tersedia: False` dan WER
tidak dikarang: klip ditandai belum tervalidasi, bukan dianggap lulus.
"""
import os
import re


def _wer(ref: str, hyp: str) -> float:
    a = re.findall(r"\w+", ref.lower())
    b = re.findall(r"\w+", hyp.lower())
    if not a:
        return 0.0 if not b else 1.0
    d = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a) + 1):
        d[i][0] = i
    for j in range(len(b) + 1):
        d[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            d[i][j] = min(
                d[i - 1][j] + 1,
                d[i][j - 1] + 1,
                d[i - 1][j - 1] + (0 if a[i - 1] == b[j - 1] else 1),
            )
    return d[len(a)][len(b)] / len(a)


_model = None


def _load():
    """whisper bawaan (openai-whisper) dipakai lebih dulu; faster-whisper cadangan.

    ffmpeg harus ada di PATH karena whisper memakainya untuk membaca audio.
    """
    global _model
    if _model is not None:
        return _model
    tools = "/workspace/tools/bin"
    if os.path.isdir(tools) and tools not in os.environ.get("PATH", ""):
        os.environ["PATH"] = tools + os.pathsep + os.environ.get("PATH", "")
    try:
        import whisper
        _model = ("whisper", whisper.load_model(os.environ.get("WHISPER_MODEL", "small")))
        return _model
    except Exception as err:
        try:
            from faster_whisper import WhisperModel
            _model = ("faster", WhisperModel(os.environ.get("WHISPER_MODEL", "small"), device="cpu", compute_type="int8"))
            return _model
        except Exception:
            raise RuntimeError(f"STT tidak tersedia: {err}")


def transcribe(path: str) -> dict:
    try:
        kind, model = _load()
    except Exception as err:
        return {"tersedia": False, "alasan": str(err)}
    if kind == "whisper":
        hasil = model.transcribe(path, language="id")
        return {"tersedia": True, "engine": "whisper", "teks": hasil.get("text", "").strip()}
    segmen, _ = model.transcribe(path, language="id")
    return {"tersedia": True, "engine": "faster-whisper", "teks": " ".join(s.text.strip() for s in segmen).strip()}


def _siap_banding(teks: str) -> str:
    """Angka dan akronim disamakan di kedua sisi sebelum WER dihitung.

    Tanpa ini, referensi "tiga ratus empat puluh" akan dihitung salah hanya
    karena STT menulis "340".
    """
    import re as _re
    from pipeline.voice.normalize import normalize
    # STT kadang menempelkan satuan ke angka ("500nm"); pisahkan dulu supaya
    # kamus pengucapan bisa mengenali satuannya.
    lepas = _re.sub(r"(?<=\d)(?=[A-Za-z])", " ", teks)
    return normalize(lepas, tone="formal")


def check(path: str, referensi: str, ambang: float = 0.10) -> dict:
    stt = transcribe(path)
    if not stt.get("tersedia"):
        return {"tersedia": False, "alasan": stt.get("alasan"), "lulus": None, "path": path}
    wer = _wer(_siap_banding(referensi), _siap_banding(stt["teks"]))
    return {"tersedia": True, "wer": round(wer, 3), "teks_stt": stt["teks"],
            "referensi": referensi, "lulus": wer <= ambang, "path": path}
