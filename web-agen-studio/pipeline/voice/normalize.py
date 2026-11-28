"""Normalisasi teks sebelum TTS: angka, mata uang, simbol, akronim."""
import json
import os
import re

NUM = {0: "nol", 1: "satu", 2: "dua", 3: "tiga", 4: "empat", 5: "lima", 6: "enam",
       7: "tujuh", 8: "delapan", 9: "sembilan", 10: "sepuluh", 11: "sebelas"}
TENS = ["", "", "dua puluh", "tiga puluh", "empat puluh", "lima puluh",
        "enam puluh", "tujuh puluh", "delapan puluh", "sembilan puluh"]


def number_to_words(n: int) -> str:
    if n < 0:
        return "minus " + number_to_words(-n)
    if n < 12:
        return NUM[n]
    if n < 20:
        return NUM[n - 10] + " belas"
    if n < 100:
        return TENS[n // 10] + ("" if n % 10 == 0 else " " + NUM[n % 10])
    if n < 200:
        return "seratus" + ("" if n % 100 == 0 else " " + number_to_words(n % 100))
    if n < 1000:
        return NUM[n // 100] + " ratus" + ("" if n % 100 == 0 else " " + number_to_words(n % 100))
    if n < 2000:
        return "seribu" + ("" if n % 1000 == 0 else " " + number_to_words(n % 1000))
    if n < 10 ** 6:
        return number_to_words(n // 1000) + " ribu" + ("" if n % 1000 == 0 else " " + number_to_words(n % 1000))
    if n < 10 ** 9:
        return number_to_words(n // 10 ** 6) + " juta" + ("" if n % 10 ** 6 == 0 else " " + number_to_words(n % 10 ** 6))
    if n < 10 ** 12:
        return number_to_words(n // 10 ** 9) + " miliar" + ("" if n % 10 ** 9 == 0 else " " + number_to_words(n % 10 ** 9))
    return number_to_words(n // 10 ** 12) + " triliun" + ("" if n % 10 ** 12 == 0 else " " + number_to_words(n % 10 ** 12))


def load_dict(path: str = None) -> dict:
    path = path or os.path.join(os.path.dirname(__file__), "dict_pron.json")
    if not os.path.exists(path):
        return {}
    return json.load(open(path, encoding="utf-8"))


def _desimal(m: "re.Match") -> str:
    bulat = number_to_words(int(m.group(1)))
    pecahan = " ".join(NUM[int(d)] for d in m.group(2))
    return f"{bulat} koma {pecahan}"


def normalize(text: str, tone: str = "santai", dict_pron: dict = None) -> str:
    dict_pron = dict_pron if dict_pron is not None else load_dict()

    # Akronim lebih dulu supaya tidak ikut dipecah aturan lain.
    for k, v in sorted(dict_pron.items(), key=lambda kv: -len(kv[0])):
        text = re.sub(rf"(?<![\w]){re.escape(k)}(?![\w])", v, text, flags=re.IGNORECASE)

    text = re.sub(r"Rp\.?\s?([\d\.]+)", lambda m: number_to_words(int(m.group(1).replace(".", ""))) + " rupiah", text)

    # Rentang dan desimal harus ditangani SEBELUM angka tunggal, kalau tidak
    # "0-100" berubah menjadi "nol-seratus" dan "3,9" jadi "tiga,sembilan".
    def _rentang(m: "re.Match") -> str:
        return f"{number_to_words(int(m.group(1)))} sampai {number_to_words(int(m.group(2)))}"

    text = re.sub(r"\b(\d+)\s*[-–]\s*(\d+)\b", _rentang, text)
    text = re.sub(r"\b(\d+),(\d+)\b", _desimal, text)
    text = re.sub(r"\b(\d+)\.(\d+)\b", _desimal, text)
    text = re.sub(r"\b\d+\b", lambda m: number_to_words(int(m.group(0))), text)
    text = re.sub(r"%", " persen", text)

    for k, v in {"cth.": "contoh", "dll.": "dan lain-lain", "dsb.": "dan sebagainya",
                 "&": " dan ", "±": " sekitar ", "→": " menjadi "}.items():
        text = text.replace(k, v)

    text = re.sub(r"\s*/\s*", " per ", text)
    if tone == "formal":
        text = re.sub(r"\bgua\b", "saya", text, flags=re.IGNORECASE)
        text = re.sub(r"\blu\b", "kamu", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip()
