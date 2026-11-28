"""Sprite mobil: PNG bila tersedia, kalau tidak digambar prosedural.

Detail yang membuat mobil terbaca sebagai mobil (bukan kotak warna): gradasi
bodi, garis panel, kaca dengan pantulan, lampu depan-belakang, roda dengan
pelek berjari, rim light, dan pantulan aspal basah.
"""
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def _hex(color: str) -> tuple:
    color = color.lstrip("#")
    return tuple(int(color[i:i + 2], 16) for i in (0, 2, 4))


def _shade(color: tuple, k: float) -> tuple:
    return tuple(max(0, min(255, int(c * k))) for c in color)


def _procedural(color: tuple, accent: tuple, w: int, h: int) -> Image.Image:
    """Digambar 2x lalu diperkecil: tepi lebih halus dan roda tidak bergerigi."""
    W, H = w * 2, h * 2
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    body = [
        (int(W * 0.02), int(H * 0.66)),
        (int(W * 0.05), int(H * 0.50)),
        (int(W * 0.18), int(H * 0.44)),
        (int(W * 0.30), int(H * 0.26)),
        (int(W * 0.62), int(H * 0.22)),
        (int(W * 0.78), int(H * 0.40)),
        (int(W * 0.95), int(H * 0.46)),
        (int(W * 0.98), int(H * 0.74)),
        (int(W * 0.96), int(H * 0.86)),
        (int(W * 0.04), int(H * 0.86)),
    ]

    # Gradasi bodi: atas memantulkan langit, bawah lebih gelap.
    body_mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(body_mask).polygon(body, fill=255)
    grad = Image.new("L", (1, H), 0)
    gp = grad.load()
    for y in range(H):
        gp[0, y] = int(255 * min(1.0, 1.12 - 0.55 * (y / H)))
    grad = grad.resize((W, H))
    tint = Image.new("RGBA", (W, H), color + (0,))
    tint.putalpha(grad)
    img.paste(tint, (0, 0), Image.composite(body_mask, Image.new("L", (W, H), 0), body_mask))

    # Garis panel pintu + handle.
    d.line([(int(W * 0.40), int(H * 0.46)), (int(W * 0.40), int(H * 0.80))],
           fill=_shade(color, 0.62) + (255,), width=max(1, W // 220))
    d.line([(int(W * 0.62), int(H * 0.44)), (int(W * 0.62), int(H * 0.80))],
           fill=_shade(color, 0.62) + (255,), width=max(1, W // 220))
    d.rounded_rectangle([int(W * 0.45), int(H * 0.55), int(W * 0.52), int(H * 0.585)],
                        radius=max(2, W // 200), fill=_shade(color, 1.3) + (255,))

    # Kaca gelap + pantulan langit.
    d.polygon([
        (int(W * 0.33), int(H * 0.28)), (int(W * 0.60), int(H * 0.25)),
        (int(W * 0.70), int(H * 0.44)), (int(W * 0.28), int(H * 0.46)),
    ], fill=(22, 30, 46, 255))
    d.polygon([
        (int(W * 0.35), int(H * 0.29)), (int(W * 0.52), int(H * 0.27)),
        (int(W * 0.46), int(H * 0.35)), (int(W * 0.33), int(H * 0.38)),
    ], fill=(70, 92, 128, 130))
    d.line([(int(W * 0.46), int(H * 0.26)), (int(W * 0.44), int(H * 0.45))],
           fill=accent + (255,), width=max(1, W // 260))

    # Lampu depan (kanan = arah laju) dan lampu belakang.
    d.rounded_rectangle([int(W * 0.90), int(H * 0.54), int(W * 0.985), int(H * 0.63)],
                        radius=max(2, W // 200), fill=(255, 248, 224, 255))
    d.rounded_rectangle([int(W * 0.90), int(H * 0.55), int(W * 0.985), int(H * 0.585)],
                        radius=max(2, W // 240), fill=(255, 255, 255, 255))
    d.rectangle([int(W * 0.025), int(H * 0.55), int(W * 0.075), int(H * 0.62)], fill=(196, 32, 40, 255))
    d.rectangle([int(W * 0.03), int(H * 0.565), int(W * 0.07), int(H * 0.585)], fill=(255, 120, 110, 255))

    # Rim light di atap: memisahkan mobil dari langit malam.
    d.line([(int(W * 0.20), int(H * 0.43)), (int(W * 0.30), int(H * 0.27)), (int(W * 0.61), int(H * 0.23))],
           fill=(210, 226, 255, 190), width=max(1, W // 260))

    # Roda: ban, pelek, jari-jari.
    for cx, cy in ((int(W * 0.22), int(H * 0.84)), (int(W * 0.78), int(H * 0.84))):
        rr = int(H * 0.19)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(10, 10, 12, 255))
        d.ellipse([cx - int(rr * 0.92), cy - int(rr * 0.92), cx + int(rr * 0.92), cy + int(rr * 0.92)],
                  outline=(38, 38, 44, 255), width=max(1, W // 300))
        inner = int(rr * 0.58)
        d.ellipse([cx - inner, cy - inner, cx + inner, cy + inner], fill=(150, 154, 164, 255))
        d.ellipse([cx - int(inner * 0.45), cy - int(inner * 0.45), cx + int(inner * 0.45), cy + int(inner * 0.45)],
                  fill=(60, 62, 70, 255))
        for a in range(0, 360, 72):
            rad = math.radians(a)
            d.line([(cx, cy), (cx + int(inner * 0.9 * math.cos(rad)), cy + int(inner * 0.9 * math.sin(rad)))],
                   fill=(96, 100, 110, 255), width=max(1, W // 340))

    return img.resize((w, h), Image.LANCZOS)


def load_car(model: dict, width: int, root: str = ".") -> Image.Image:
    sprite = os.path.join(root, model.get("sprite", ""))
    if model.get("sprite") and os.path.exists(sprite):
        img = Image.open(sprite).convert("RGBA")
    else:
        color = _hex(model.get("color", "#d63a3a"))
        accent = _hex(model.get("accent", "#1a1d26"))
        img = _procedural(color, accent, model["size"]["w"], model["size"]["h"])
    ratio = img.height / img.width
    target_w = max(8, int(width))
    return img.resize((target_w, max(8, int(target_w * ratio))), Image.LANCZOS)


def to_array(img: Image.Image) -> tuple:
    """Return (rgb float32, alpha float32 0..1) untuk pengomposisian cepat."""
    arr = np.asarray(img, dtype=np.float32)
    return arr[:, :, :3], arr[:, :, 3] / 255.0


def reflection(sprite: tuple, strength: float = 0.22, squash: float = 0.32) -> tuple:
    """Pantulan aspal basah: salinan terbalik, dipadatkan, diredupkan."""
    rgb, a = sprite
    flipped = np.flipud(rgb)
    alpha = np.flipud(a) * strength
    h = max(2, int(alpha.shape[0] * squash))
    img = Image.fromarray(np.dstack([flipped, alpha * 255]).astype(np.uint8))
    img = img.filter(ImageFilter.GaussianBlur(1.2)).resize((alpha.shape[1], h), Image.BILINEAR)
    arr = np.asarray(img, dtype=np.float32)
    return arr[:, :, :3], arr[:, :, 3] / 255.0


def blend(dst: np.ndarray, sprite: tuple, x: int, y: int, scale: float = 1.0, alpha: float = 1.0) -> None:
    """Alpha-composite sprite ke frame, dipotong di tepi frame."""
    rgb, a = sprite
    if scale != 1.0:
        h, w = a.shape
        new = Image.fromarray(np.dstack([rgb, a * 255]).astype(np.uint8)).resize(
            (max(1, int(w * scale)), max(1, int(h * scale))), Image.BILINEAR
        )
        arr = np.asarray(new, dtype=np.float32)
        rgb, a = arr[:, :, :3], arr[:, :, 3] / 255.0
    h, w = a.shape
    hh, ww = dst.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(ww, x + w), min(hh, y + h)
    if x1 <= x0 or y1 <= y0:
        return
    sub_a = a[y0 - y:y1 - y, x0 - x:x1 - x][:, :, None] * alpha
    sub_rgb = rgb[y0 - y:y1 - y, x0 - x:x1 - x]
    region = dst[y0:y1, x0:x1]
    dst[y0:y1, x0:x1] = region * (1 - sub_a) + sub_rgb * sub_a
