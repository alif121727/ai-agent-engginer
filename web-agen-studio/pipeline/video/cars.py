"""Sprite mobil: PNG bila tersedia, kalau tidak digambar prosedural."""
import os

import numpy as np
from PIL import Image, ImageDraw


def _hex(color: str) -> tuple:
    color = color.lstrip("#")
    return tuple(int(color[i:i + 2], 16) for i in (0, 2, 4))


def _procedural(color: tuple, accent: tuple, w: int, h: int) -> Image.Image:
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = max(4, int(h * 0.10))

    # Silhouette: kap mesin rendah, kabin di tengah, buritan naik.
    body = [
        (int(w * 0.02), int(h * 0.62)),
        (int(w * 0.06), int(h * 0.46)),
        (int(w * 0.24), int(h * 0.40)),
        (int(w * 0.34), int(h * 0.22)),
        (int(w * 0.66), int(h * 0.20)),
        (int(w * 0.80), int(h * 0.42)),
        (int(w * 0.96), int(h * 0.48)),
        (int(w * 0.97), int(h * 0.80)),
        (int(w * 0.03), int(h * 0.80)),
    ]
    d.polygon(body, fill=color + (255,))
    d.rounded_rectangle([int(w * 0.03), int(h * 0.74), int(w * 0.97), int(h * 0.84)], radius=r, fill=color + (255,))

    # Kaca depan + samping, warna gelap kebiruan.
    glass = (28, 38, 58, 255)
    d.polygon([
        (int(w * 0.37), int(h * 0.24)), (int(w * 0.64), int(h * 0.23)),
        (int(w * 0.72), int(h * 0.42)), (int(w * 0.32), int(h * 0.43)),
    ], fill=glass)
    d.line([(int(w * 0.42), int(h * 0.24)), (int(w * 0.40), int(h * 0.42))], fill=accent + (255,), width=max(1, w // 90))

    # Lampu depan kanan (arah laju) dan lampu belakang.
    d.rounded_rectangle([int(w * 0.90), int(h * 0.52), int(w * 0.97), int(h * 0.60)], radius=r // 2, fill=(255, 244, 200, 255))
    d.rectangle([int(w * 0.03), int(h * 0.54), int(w * 0.07), int(h * 0.61)], fill=(210, 40, 40, 255))

    # Roda dengan pelek.
    for cx, cy in ((int(w * 0.24), int(h * 0.80)), (int(w * 0.76), int(h * 0.80))):
        rr = int(h * 0.16)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(12, 12, 14, 255))
        d.ellipse([cx - rr // 2, cy - rr // 2, cx + rr // 2, cy + rr // 2], fill=(120, 124, 132, 255))

    # Garis bodi: memberi kesan panel, bukan blok warna.
    d.line([(int(w * 0.10), int(h * 0.66)), (int(w * 0.90), int(h * 0.64))], fill=accent + (255,), width=max(1, h // 40))
    return img


def load_car(model: dict, width: int, root: str = ".") -> Image.Image:
    sprite = os.path.join(root, model.get("sprite", ""))
    if model.get("sprite") and os.path.exists(sprite):
        img = Image.open(sprite).convert("RGBA")
    else:
        color = _hex(model.get("color", "#d63a3a"))
        accent = _hex(model.get("accent", "#1a1d26"))
        base_w, base_h = model["size"]["w"], model["size"]["h"]
        img = _procedural(color, accent, base_w, base_h)
    ratio = img.height / img.width
    return img.resize((max(8, int(width)), max(8, int(width * ratio))), Image.LANCZOS)


def to_array(img: Image.Image) -> tuple:
    """Return (rgb float32, alpha float32 0..1) untuk pengomposisian cepat."""
    arr = np.asarray(img, dtype=np.float32)
    return arr[:, :, :3], arr[:, :, 3] / 255.0


def blend(dst: np.ndarray, sprite: tuple, x: int, y: int, scale: float = 1.0, alpha: float = 1.0) -> None:
    """Alpha-composite sprite ke frame, dipotong di tepi frame."""
    rgb, a = sprite
    if scale != 1.0:
        from PIL import Image as _I
        h, w = a.shape
        new = _I.fromarray(np.dstack([rgb, a * 255]).astype(np.uint8)).resize(
            (max(1, int(w * scale)), max(1, int(h * scale))), _I.BILINEAR
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
