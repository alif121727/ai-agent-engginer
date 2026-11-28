"""Scene graph L0-L7: setiap frame dirender dari lapisan, bukan dari foto.

L0 langit (gradien + bintang + bulan) | L1 skyline | L2 bangunan |
L3 jalan + marka | L4 traffic | L5 hero | L6 FX | L7 fade.
"""
import numpy as np
from PIL import Image, ImageDraw

from .cars import blend, load_car, to_array
from .traffic import SOLO_FROM, hero_lane, traffic_at
from . import postfx


def _smoothstep(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


class SceneGraph:
    def __init__(self, model: dict, others: list, width: int, height: int, fps: int, dur: float, root: str = "."):
        self.W, self.H = width, height
        self.fps, self.dur = fps, dur
        self.road_top = int(height * 0.70)
        self.lane_h = (height - self.road_top) / 3.0
        self.rng = np.random.default_rng(11)

        self.sky = self._build_sky()
        self.skyline = self._build_strip("skyline")
        self.buildings = self._build_strip("buildings")
        self.vignette = postfx.vignette(width, height, 0.42)

        hero_w = int(width * 0.29)
        self.hero = to_array(load_car(model, hero_w, root))
        self.others = [to_array(load_car(m, int(width * 0.19), root)) for m in others]
        self.glow = postfx.glow_patch(int(width * 0.42), int(height * 0.20))

        self.travel = self._travel()

    # ---------- lapisan statis ----------
    def _build_sky(self) -> np.ndarray:
        W, H = self.W, self.H
        y = np.linspace(0.0, 1.0, H, dtype=np.float32)[:, None]
        top = np.array([5, 8, 24], dtype=np.float32)
        mid = np.array([16, 22, 52], dtype=np.float32)
        low = np.array([38, 34, 66], dtype=np.float32)
        grad = np.where(y < 0.55, top + (mid - top) * (y / 0.55), mid + (low - mid) * ((y - 0.55) / 0.45))
        sky = np.repeat(grad[:, None, :], W, axis=1).copy()

        mx, my, mr = int(W * 0.76), int(H * 0.13), int(H * 0.045)
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        d = np.sqrt((xx - mx) ** 2 + (yy - my) ** 2)
        halo = np.clip(1.0 - d / (mr * 7.0), 0.0, 1.0) ** 3
        sky += halo[:, :, None] * np.array([90, 96, 120], dtype=np.float32)
        disc = d <= mr
        sky[disc] = np.array([243, 240, 208], dtype=np.float32)
        rim = (d > mr) & (d <= mr + 2)
        sky[rim] = np.array([210, 214, 190], dtype=np.float32)

        rng = np.random.default_rng(3)
        self.stars = [
            (int(rng.integers(0, W)), int(rng.integers(0, int(H * 0.42))), float(rng.random() * 6.28), float(rng.uniform(0.5, 1.0)))
            for _ in range(160)
        ]
        return sky

    def _build_strip(self, kind: str) -> tuple:
        """Dua pola berbeda disambung: periode pandang jadi 2W, tidak mudah terlihat."""
        W = self.W
        h = int(self.H * 0.42) if kind == "skyline" else int(self.H * 0.40)
        y0 = int(self.H * 0.20) if kind == "skyline" else int(self.H * 0.30)
        img = Image.new("RGBA", (2 * W, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        rng = np.random.default_rng(5 if kind == "skyline" else 7)
        x = 0
        while x < 2 * W:
            bw = int(rng.integers(int(W * 0.05), int(W * 0.12)))
            bh = int(rng.uniform(0.35, 0.95) * h)
            base = h
            shade = (18, 22, 42) if kind == "skyline" else (26, 30, 52)
            d.rectangle([x, base - bh, min(2 * W, x + bw), base], fill=shade + (255,))
            if kind == "buildings":
                for wy in range(base - bh + 12, base - 10, 26):
                    for wx in range(x + 8, min(2 * W, x + bw) - 8, 20):
                        if rng.random() < 0.45:
                            d.rectangle([wx, wy, wx + 9, wy + 13], fill=(255, 216, 130, 235))
                d.rectangle([x, base - bh, min(2 * W, x + bw), base - bh + 4], fill=(46, 52, 78, 255))
            x += bw + int(rng.integers(4, 26))
        arr = np.asarray(img, dtype=np.float32)
        return arr, y0, h

    def _travel(self) -> np.ndarray:
        frames = int(self.dur * self.fps)
        px = np.zeros(frames, dtype=np.float32)
        for i in range(frames):
            t = i / self.fps
            if t < 3.0:
                v = _smoothstep(t / 3.0)
            elif t > self.dur - 3.0:
                v = 1.0 - 0.25 * _smoothstep((t - (self.dur - 3.0)) / 3.0)
            else:
                v = 1.0 + 0.04 * np.sin(t * 0.9)
            px[i] = (px[i - 1] if i else 0.0) + v * 520.0 / self.fps
        return px

    # ---------- lapisan per frame ----------
    def _stars(self, frame: np.ndarray, t: float) -> None:
        for sx, sy, ph, amp in self.stars:
            v = 120 + 130 * (0.5 + 0.5 * np.sin(t * 3.1 + ph)) * amp
            frame[sy, sx] = np.array([v, v, min(255.0, v + 30)])

    def _blit(self, frame: np.ndarray, strip: tuple, offset: float) -> None:
        arr, y0, h = strip
        sx = int(offset) % self.W
        chunk = arr[:, sx:sx + self.W]
        if chunk.shape[1] < self.W:
            chunk = np.concatenate([chunk, arr[:, : self.W - chunk.shape[1]]], axis=1)
        a = chunk[:, :, 3:4] / 255.0
        region = frame[y0:y0 + h]
        region[:] = region * (1 - a) + chunk[:, :, :3] * a

    def _road(self, frame: np.ndarray, travel: float) -> None:
        W, H = self.W, self.H
        rt = self.road_top
        frame[rt:] = np.array([30, 30, 36], dtype=np.float32)
        # Aspal lebih gelap ke bawah (dekat kamera) supaya ada kedalaman.
        depth = np.linspace(1.0, 0.72, H - rt, dtype=np.float32)[:, None, None]
        frame[rt:] *= depth
        # Marka putus-putus di dua garis lane.
        dash, gap = int(W * 0.035), int(W * 0.030)
        span = dash + gap
        for lane_edge in (1, 2):
            y = int(rt + self.lane_h * lane_edge) - 3
            start = -int(travel % span)
            x = start
            while x < W:
                frame[y:y + 6, max(0, x):max(0, x + dash)] = np.array([246, 244, 214], dtype=np.float32)
                x += span
        # Garis tepi jalan.
        frame[rt:rt + 4] = np.array([180, 180, 190], dtype=np.float32)

    def _lane_y(self, lane: float, sprite: tuple) -> float:
        """Dasar ban selalu di dalam frame: lane 2 tidak terpotong tepi bawah."""
        h = sprite[1].shape[0]
        bottom = self.road_top + self.lane_h * (lane + 0.55)
        return min(bottom - h * 0.98, self.H - h - 4)

    def _hero_x(self) -> int:
        return int(self.W * 0.30)

    def render_frame(self, index: int) -> np.ndarray:
        t = index / self.fps
        travel = float(self.travel[min(index, len(self.travel) - 1)])
        frame = self.sky.copy()

        self._stars(frame, t)
        self._blit(frame, self.skyline, travel * 0.20)
        self._blit(frame, self.buildings, travel * 0.50)
        self._road(frame, travel)

        for car in traffic_at(t, self.dur, self.W):
            sprite = self.others[car.variant % len(self.others)]
            y = self._lane_y(car.lane, sprite)
            postfx.shadow(frame, int(car.x + sprite[1].shape[1] * car.scale * 0.5),
                          int(y + sprite[1].shape[0] * car.scale * 0.96),
                          int(sprite[1].shape[1] * car.scale * 0.55))
            blend(frame, sprite, int(car.x), int(y), scale=car.scale, alpha=car.alpha)

        lane = hero_lane(t, self.dur)
        hx = self._hero_x()
        hy = self._lane_y(lane, self.hero) + int(np.sin(t * 9.0) * 2)
        postfx.shadow(frame, hx + int(self.hero[1].shape[1] * 0.5),
                      int(hy + self.hero[1].shape[0] * 0.96), int(self.hero[1].shape[1] * 0.58))
        blend(frame, self.hero, hx, int(hy))

        # Lampu depan aditif di depan mobil hero.
        gh, gw = self.glow.shape[:2]
        gx = hx + int(self.hero[1].shape[1] * 0.78)
        gy = int(hy + self.hero[1].shape[0] * 0.42 - gh * 0.5)
        x0, y0 = max(0, gx), max(0, gy)
        x1, y1 = min(self.W, gx + gw), min(self.H, gy + gh)
        if x1 > x0 and y1 > y0:
            patch = self.glow[y0 - gy:y1 - gy, x0 - gx:x1 - gx]
            frame[y0:y1, x0:x1] += patch[:, :, :3] * patch[:, :, 3:4] * 0.9

        postfx.grain(frame, self.rng)
        frame *= self.vignette[:, :, None]
        postfx.fade_to_black(frame, t, self.dur)

        if t >= SOLO_FROM * self.dur:
            # Penanda hero sendirian: tidak ada mobil lain setelah titik ini.
            pass
        return np.clip(frame, 0, 255).astype(np.uint8)
