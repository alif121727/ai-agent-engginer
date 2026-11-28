"""Scene graph L0-L7: setiap frame dirender dari lapisan, bukan dari foto.

L0 langit (gradien + bintang berkelip + bulan) | L1 skyline | L2 bangunan |
L3 jalan + marka + kolam cahaya lampu | L4 traffic | L5 hero | L6 FX (bloom,
grade, grain, vignette) | L7 fade. Kamera bergoyang halus seperti dipegang.
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from . import postfx
from .cars import blend, load_car, reflection, to_array
from .traffic import SOLO_FROM, hero_lane, traffic_at


def _smoothstep(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


class SceneGraph:
    def __init__(self, model: dict, others: list, width: int, height: int, fps: int, dur: float, root: str = "."):
        self.W, self.H = width, height
        self.fps, self.dur = fps, dur
        self.road_top = int(height * 0.54)
        self.lane_h = (height - self.road_top) / 3.0
        self.rng = np.random.default_rng(11)

        self.sky = self._build_sky()
        self.skyline = self._build_strip("skyline")
        self.buildings = self._build_strip("buildings")
        self.vignette = postfx.vignette(width, height, 0.45)

        hero_w = int(width * 0.21)
        hero_img = load_car(model, hero_w, root)
        self.hero = to_array(hero_img)
        self.hero_ref = reflection(self.hero, 0.22)
        # Mobil lain lebih kecil: mereka berada di lane yang lebih jauh.
        self.others = [to_array(load_car(m, int(width * 0.15), root)) for m in others]
        self.others_ref = [reflection(s, 0.18) for s in self.others]
        self.glow = postfx.glow_patch(int(width * 0.46), int(height * 0.22))
        self.tail_glow = postfx.glow_patch(int(width * 0.16), int(height * 0.10), color=(255, 60, 60))
        self.lamp_pool = postfx.glow_patch(int(width * 0.34), int(height * 0.12), color=(255, 214, 150))

        self.travel = self._travel()

    # ---------- lapisan statis ----------
    def _build_sky(self) -> np.ndarray:
        W, H = self.W, self.H
        y = np.linspace(0.0, 1.0, H, dtype=np.float32)[:, None]
        top = np.array([4, 7, 20], dtype=np.float32)
        mid = np.array([13, 19, 46], dtype=np.float32)
        low = np.array([46, 40, 72], dtype=np.float32)
        grad = np.where(y < 0.55, top + (mid - top) * (y / 0.55), mid + (low - mid) * ((y - 0.55) / 0.45))
        sky = np.repeat(grad[:, None, :], W, axis=1).copy()

        # Cahaya kota di horizon: membuat langit tidak rata.
        sky[int(H * 0.30):int(H * 0.68)] += np.array([12, 9, 4], dtype=np.float32)

        mx, my, mr = int(W * 0.76), int(H * 0.13), int(H * 0.045)
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        d = np.sqrt((xx - mx) ** 2 + (yy - my) ** 2)
        halo = np.clip(1.0 - d / (mr * 8.0), 0.0, 1.0) ** 3
        sky += halo[:, :, None] * np.array([70, 78, 104], dtype=np.float32)
        disc = d <= mr
        sky[disc] = np.array([243, 240, 208], dtype=np.float32)
        # Kawah bulan: dua bercak gelap supaya tidak terlihat seperti stiker.
        for cx, cy, cr in ((mr * 0.35, -mr * 0.2, mr * 0.22), (-mr * 0.3, mr * 0.32, mr * 0.17)):
            dd = np.sqrt((xx - (mx + cx)) ** 2 + (yy - (my + cy)) ** 2)
            sky[(dd <= cr) & disc] = np.array([226, 223, 194], dtype=np.float32)

        rng = np.random.default_rng(3)
        self.stars = [
            (int(rng.integers(0, W)), int(rng.integers(0, int(H * 0.40))),
             float(rng.random() * 6.28), float(rng.uniform(0.4, 1.0)))
            for _ in range(180)
        ]
        return sky

    def _build_strip(self, kind: str) -> tuple:
        """Dua pola berbeda disambung: periode pandang 2W, tidak mudah terlihat."""
        W = self.W
        h = int(self.H * 0.34) if kind == "skyline" else int(self.H * 0.34)
        y0 = int(self.H * 0.22) if kind == "skyline" else int(self.H * 0.31)
        img = Image.new("RGBA", (2 * W, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        rng = np.random.default_rng(5 if kind == "skyline" else 7)
        x = 0
        while x < 2 * W:
            bw = int(rng.integers(int(W * 0.04), int(W * 0.10)))
            bh = int(rng.uniform(0.35, 0.98) * h)
            base = h
            shade = (16, 20, 38) if kind == "skyline" else (24, 28, 48)
            d.rectangle([x, base - bh, min(2 * W, x + bw), base], fill=shade + (255,))
            if kind == "buildings":
                # Jendela: sebagian hangat, sebagian dingin, ada yang mati.
                for wy in range(base - bh + 10, base - 8, 22):
                    for wx in range(x + 6, min(2 * W, x + bw) - 6, 16):
                        r = rng.random()
                        if r < 0.38:
                            col = (255, 214, 132, 240) if rng.random() < 0.8 else (176, 210, 255, 235)
                            d.rectangle([wx, wy, wx + 7, wy + 11], fill=col)
                # Garis atap + antena: siluet tidak terlihat seperti blok polos.
                d.rectangle([x, base - bh, min(2 * W, x + bw), base - bh + 3], fill=(44, 50, 76, 255))
                if rng.random() < 0.35:
                    ax = x + bw // 2
                    d.line([(ax, base - bh), (ax, base - bh - 12)], fill=(30, 34, 52, 255), width=2)
            x += bw + int(rng.integers(6, 30))
        arr = np.asarray(img, dtype=np.float32)
        if kind == "buildings":
            # Bangunan lebih gelap menjelang kaki: hilangkan kesan blok rata.
            shade = np.linspace(1.0, 0.78, h, dtype=np.float32)[:, None, None]
            arr[:, :, :3] *= shade
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
            px[i] = (px[i - 1] if i else 0.0) + v * 560.0 / self.fps
        return px

    # ---------- kamera ----------
    def _cam(self, t: float) -> tuple:
        dx = int(round(3.0 * np.sin(t * 1.7) + 1.6 * np.sin(t * 3.9)))
        dy = int(round(1.6 * np.sin(t * 2.3)))
        return dx, dy

    # ---------- lapisan per frame ----------
    def _stars(self, frame: np.ndarray, t: float) -> None:
        for sx, sy, ph, amp in self.stars:
            v = 110 + 140 * (0.5 + 0.5 * np.sin(t * 3.1 + ph)) * amp
            frame[sy, sx] = np.array([v, v, min(255.0, v + 25)])

    def _blit(self, frame: np.ndarray, strip: tuple, offset: float) -> None:
        arr, y0, h = strip
        sx = int(offset) % self.W
        chunk = arr[:, sx:sx + self.W]
        if chunk.shape[1] < self.W:
            chunk = np.concatenate([chunk, arr[:, : self.W - chunk.shape[1]]], axis=1)
        a = chunk[:, :, 3:4] / 255.0
        region = frame[y0:y0 + h]
        region[:] = region * (1 - a) + chunk[:, :, :3] * a

    def _haze(self, frame: np.ndarray) -> None:
        """Kabut kota tipis: menyatukan bangunan dengan aspal tanpa garis keras."""
        rt = self.road_top
        h = int(self.H * 0.16)
        y0 = max(0, rt - h)
        t = np.linspace(0.0, 1.0, rt - y0, dtype=np.float32)
        k = (t * t * (3 - 2 * t)) ** 1.5 * 0.12
        k = k[:, None, None]
        frame[y0:rt] = frame[y0:rt] * (1 - k) + np.array([52, 47, 76], dtype=np.float32) * k

    def _road(self, frame: np.ndarray, travel: float, cam_dx: int) -> None:
        W, H = self.W, self.H
        rt = self.road_top
        frame[rt:] = np.array([26, 26, 32], dtype=np.float32)

        # Aspal: gradasi gelap ke bawah + tekstur halus.
        depth = np.linspace(1.0, 0.66, H - rt, dtype=np.float32)[:, None, None]
        frame[rt:] *= depth
        h_road = H - rt
        noise = self.rng.integers(-3, 4, size=((h_road + 1) // 2, (W + 1) // 2, 1), dtype=np.int16)
        noise = np.repeat(np.repeat(noise.astype(np.float32), 2, axis=0), 2, axis=1)[:h_road, :W]
        frame[rt:] += noise

        # Marka putus-putus, dengan ketebalan bertambah ke bawah (kesan perspektif).
        dash, gap = int(W * 0.034), int(W * 0.030)
        span = dash + gap
        for lane_edge in (1, 2):
            y = int(rt + self.lane_h * lane_edge)
            arah = 1 if lane_edge == 1 else 2
            tebal = 4 + arah * 2
            start = -int(travel % span)
            x = start
            while x < W:
                frame[y:y + tebal, max(0, x):max(0, x + dash)] = np.array([238, 236, 206], dtype=np.float32)
                x += span
        # Garis tepi jalan (solid, lebih redup).
        frame[rt:rt + 3] = np.array([150, 152, 160], dtype=np.float32)
        frame[H - 4:H] = np.array([120, 122, 130], dtype=np.float32)

    def _lamp_pools(self, frame: np.ndarray, travel: float, cam_dx: int) -> None:
        """Kolam cahaya lampu jalan: satu-satunya sumber terang di aspal."""
        ph, pw = self.lamp_pool.shape[:2]
        spacing = int(self.W * 0.42)
        offset = int(travel * 0.9) % spacing
        y = self.road_top + int(self.lane_h * 0.35) - ph // 2
        for k in range(-1, self.W // spacing + 2):
            x = k * spacing - offset + cam_dx
            x0, y0 = max(0, x), max(0, y)
            x1, y1 = min(self.W, x + pw), min(self.H, y + ph)
            if x1 <= x0 or y1 <= y0:
                continue
            patch = self.lamp_pool[y0 - y:y1 - y, x0 - x:x1 - x]
            frame[y0:y1, x0:x1] += patch[:, :, :3] * patch[:, :, 3:4] * 0.32

    def _lane_y(self, lane: float, sprite: tuple) -> float:
        """Dasar ban selalu di dalam frame: lane 2 tidak terpotong tepi bawah."""
        h = sprite[1].shape[0]
        bottom = self.road_top + self.lane_h * (lane + 0.72)
        return min(bottom - h * 0.98, self.H - h - 4)

    def _bloom(self, frame: np.ndarray) -> None:
        """Cahaya lampu menyebar seperti lensa kamera (bukan garis tegas)."""
        small = Image.fromarray(np.clip(frame, 0, 255).astype(np.uint8)).resize(
            (self.W // 4, self.H // 4), Image.BILINEAR
        )
        arr = np.asarray(small, dtype=np.float32)
        luma = arr.max(axis=2)
        mask = np.clip((luma - 188) / 67.0, 0.0, 1.0)[:, :, None]
        bright = arr * mask
        glow = Image.fromarray(np.clip(bright, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4))
        big = np.asarray(glow.resize((self.W, self.H), Image.BILINEAR), dtype=np.float32)
        frame += big * 0.55

    def _grade(self, frame: np.ndarray) -> None:
        """Teal-orange ringan: bayangan kebiruan, lampu kekuningan."""
        frame[:, :, 0] *= 1.02
        frame[:, :, 2] *= 1.05
        lum = frame.mean(axis=2, keepdims=True) / 255.0
        lift = (1.0 - lum) ** 2
        frame += lift * np.array([0.0, 3.0, 9.0], dtype=np.float32)

    def render_frame(self, index: int) -> np.ndarray:
        t = index / self.fps
        travel = float(self.travel[min(index, len(self.travel) - 1)])
        cam_dx, cam_dy = self._cam(t)

        frame = self.sky.copy()
        self._stars(frame, t)
        self._blit(frame, self.skyline, travel * 0.20 + cam_dx)
        self._blit(frame, self.buildings, travel * 0.50 + cam_dx)
        self._haze(frame)
        self._road(frame, travel, cam_dx)
        self._lamp_pools(frame, travel, cam_dx)

        for car in traffic_at(t, self.dur, self.W):
            idx = car.variant % len(self.others)
            sprite = self.others[idx]
            # Perspektif: lane jauh sedikit lebih kecil dan lebih redup.
            skala = car.scale * (0.90 + 0.06 * car.lane)
            y = self._lane_y(car.lane, sprite) + cam_dy + int((1 - skala) * 30)
            x = int(car.x + cam_dx)
            car_alpha = car.alpha * (0.82 if car.lane == 0 else 1.0)
            ref = self.others_ref[idx]
            blend(frame, ref, x, int(y + sprite[1].shape[0] * skala * 0.94),
                  scale=skala, alpha=car_alpha * 0.65)
            postfx.shadow(frame, int(x + sprite[1].shape[1] * skala * 0.5),
                          int(y + sprite[1].shape[0] * skala * 0.96),
                          int(sprite[1].shape[1] * skala * 0.55))
            blend(frame, sprite, x, int(y), scale=skala, alpha=car_alpha)

        lane = hero_lane(t, self.dur)
        hx = int(self.W * 0.30) + cam_dx
        hy = self._lane_y(lane, self.hero) + cam_dy + int(np.sin(t * 9.0) * 1.5)
        blend(frame, self.hero_ref, hx,
              int(hy + self.hero[1].shape[0] * 0.94), alpha=0.9)
        postfx.shadow(frame, hx + int(self.hero[1].shape[1] * 0.5),
                      int(hy + self.hero[1].shape[0] * 0.96), int(self.hero[1].shape[1] * 0.58))
        blend(frame, self.hero, hx, int(hy))

        self._add_glow(frame, self.glow, hx + int(self.hero[1].shape[1] * 0.80),
                       int(hy + self.hero[1].shape[0] * 0.44 - self.glow.shape[0] * 0.5), 0.85)
        self._add_glow(frame, self.tail_glow, hx - int(self.tail_glow.shape[1] * 0.7),
                       int(hy + self.hero[1].shape[0] * 0.52 - self.tail_glow.shape[0] * 0.5), 0.5)

        self._bloom(frame)
        self._grade(frame)
        postfx.grain(frame, self.rng, 3)
        frame *= self.vignette[:, :, None]
        postfx.fade_to_black(frame, t, self.dur)
        return np.clip(frame, 0, 255).astype(np.uint8)

    def _add_glow(self, frame: np.ndarray, patch: np.ndarray, gx: int, gy: int, strength: float) -> None:
        gh, gw = patch.shape[:2]
        x0, y0 = max(0, gx), max(0, gy)
        x1, y1 = min(self.W, gx + gw), min(self.H, gy + gh)
        if x1 <= x0 or y1 <= y0:
            return
        sub = patch[y0 - gy:y1 - gy, x0 - gx:x1 - gx]
        frame[y0:y1, x0:x1] += sub[:, :, :3] * sub[:, :, 3:4] * strength
