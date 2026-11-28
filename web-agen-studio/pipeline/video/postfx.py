"""Efek gambar: vignette, grain, fade-to-black. Semua fungsi murni numpy."""
import numpy as np


def vignette(w: int, h: int, strength: float = 0.35) -> np.ndarray:
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    nx = (xx - w / 2) / (w / 2)
    ny = (yy - h / 2) / (h / 2)
    r = np.sqrt(nx * nx + ny * ny) / 1.414
    return np.clip(1.0 - strength * (r ** 2.2), 0.0, 1.0)


def grain(frame: np.ndarray, rng: np.random.Generator, amount: int = 4) -> None:
    h, w = frame.shape[:2]
    half = rng.integers(-amount, amount + 1, size=(h // 2, w // 2, 1), dtype=np.int16).astype(np.float32)
    frame += np.repeat(np.repeat(half, 2, axis=0), 2, axis=1)[:h, :w]


def fade_to_black(frame: np.ndarray, t: float, dur: float, fade_sec: float = 2.0) -> None:
    if dur - t < fade_sec:
        k = max(0.0, 1.0 - (dur - t) / fade_sec)
        frame *= 1.0 - k


def shadow(frame: np.ndarray, cx: int, cy: int, half_w: int) -> None:
    """Bayangan elips lembut tepat di bawah mobil: menempelkan mobil ke aspal."""
    h, w = frame.shape[:2]
    half_h = max(3, half_w // 6)
    x0, x1 = max(0, cx - half_w), min(w, cx + half_w)
    y0, y1 = max(0, cy - half_h), min(h, cy + half_h)
    if x1 <= x0 or y1 <= y0:
        return
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    dx = (xx - cx) / max(1.0, half_w)
    dy = (yy - cy) / max(1.0, half_h)
    mask = np.clip(1.0 - (dx * dx + dy * dy), 0.0, 1.0) ** 1.5
    frame[y0:y1, x0:x1] *= (1.0 - 0.55 * mask)[:, :, None]


def glow_patch(w: int, h: int, color=(255, 238, 190)) -> np.ndarray:
    """Kerucut lampu depan: RGBA float32, siap dicampur aditif."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    fx = xx / max(1, w)          # 0 di pangkal, 1 di ujung
    spread = 0.10 + 0.42 * fx
    ny = np.abs(yy / max(1, h) - 0.5) / spread
    core = np.clip(1.0 - ny, 0.0, 1.0) ** 2
    inten = core * (1.0 - fx) ** 1.4 * 0.55
    out = np.zeros((h, w, 4), dtype=np.float32)
    out[:, :, 0] = color[0]
    out[:, :, 1] = color[1]
    out[:, :, 2] = color[2]
    out[:, :, 3] = inten
    return out
