"""Scene 3D: kamera di belakang hero, jalan mengecil ke horizon.

Semua posisi dalam meter (X kanan, Y atas, Z maju). Urutan render tiap frame:
langit -> jalan (proyeksi per baris) -> bangunan (kotak 3D, jauh ke dekat) ->
lampu jalan -> mobil lain -> hero -> efek lensa.
"""
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from . import postfx
from .traffic import LANE_W, hero_lane, traffic_at

FOG = np.array([46, 50, 70], dtype=np.float32)
LIGHT = np.array([-0.45, 0.80, -0.40], dtype=np.float32)
LIGHT = LIGHT / np.linalg.norm(LIGHT)
ROAD_HALF = LANE_W * 1.5
DASH_PERIOD, DASH_LEN = 12.0, 4.5


class Camera:
    def __init__(self, w: int, h: int, fov: float = 58.0, height: float = 1.75, pitch: float = 6.8):
        self.w, self.h = w, h
        self.f = (w / 2) / math.tan(math.radians(fov) / 2)
        self.cx, self.cy = w / 2.0, h / 2.0
        self.height = height
        self.pitch = math.radians(pitch)
        self.x = 0.0
        self.z = -10.5

    def project(self, pts: np.ndarray):
        cp, sp = math.cos(self.pitch), math.sin(self.pitch)
        dx = pts[:, 0] - self.x
        dy = pts[:, 1] - self.height
        dz = pts[:, 2] - self.z
        up = dy * cp + dz * sp
        fwd = -dy * sp + dz * cp
        fwd_safe = np.maximum(fwd, 0.05)
        return self.cx + self.f * dx / fwd_safe, self.cy - self.f * up / fwd_safe, fwd

    def horizon(self) -> float:
        return self.cy - self.f * math.tan(self.pitch)

    def ground_distance(self, rows: np.ndarray) -> np.ndarray:
        """Jarak Z dunia untuk tiap baris layar (baris harus di bawah horizon)."""
        cp, sp = math.cos(self.pitch), math.sin(self.pitch)
        k = (self.cy - rows) / self.f
        den = sp - k * cp
        den = np.where(np.abs(den) < 1e-4, -1e-4, den)
        dc = self.height * (k * sp + cp) / den
        return dc - self.z


def _fog_mix(color: np.ndarray, dist: float, far: float = 150.0) -> np.ndarray:
    t = 1.0 - math.exp(-dist / far)
    return color * (1 - t) + FOG * t


def _shade(base: np.ndarray, normal: np.ndarray) -> np.ndarray:
    lam = max(0.0, float(normal @ LIGHT))
    return base * (0.44 + 0.72 * lam)


class SceneGraph:
    def __init__(self, model: dict, others: list, width: int, height: int, fps: int, dur: float, root: str = "."):
        self.W, self.H = width, height
        self.fps, self.dur = fps, dur
        self.rng = np.random.default_rng(17)
        self.cam = Camera(width, height)
        # Horizon dulu: langit memakainya sebagai batas gradasi.
        self.horizon = self.cam.horizon()
        self.sky = self._build_sky()
        self.vignette = postfx.vignette(width, height, 0.42)
        self.hero_color = np.array(self._hex(model.get("color", "#d63a3a")), dtype=np.float32)
        palet = ["#8a8f9c", "#b9bec6", "#3b4a63", "#7a4a44", "#2f3a44", "#9aa0a6"]
        self.other_colors = [np.array(self._hex(c), dtype=np.float32) for c in palet]
        self.buildings = self._plan_buildings()
        self.lamps = [(side * 5.8, 22.0 + i * 34.0) for i in range(9) for side in (-1, 1)]
        self.road_noise = self.rng.normal(0, 2.4, size=(height, width, 1)).astype(np.float32)
        # Profil kecepatan ternormalisasi 0..1 untuk audio mesin.
        self.travel = self._speed_profile()
        self.pool = self._radial((255, 208, 146), (160, 128))

    def _speed_profile(self) -> np.ndarray:
        frames = max(1, int(self.dur * self.fps))
        t = np.arange(frames, dtype=np.float32) / self.fps
        v = np.ones(frames, dtype=np.float32)
        naik = t < 3.0
        v[naik] = 0.55 + 0.45 * np.clip(t[naik] / 3.0, 0.0, 1.0)
        turun = t > self.dur - 3.0
        v[turun] = 0.85 - 0.25 * np.clip((t[turun] - (self.dur - 3.0)) / 3.0, 0.0, 1.0)
        return v

    @staticmethod
    def _radial(rgb: tuple, size: tuple) -> Image.Image:
        """Cahaya lampu: inti terang lalu memudar, bukan elips rata."""
        w, h = size
        y, x = np.mgrid[0:h, 0:w].astype(np.float32)
        d = np.sqrt(((x - w / 2) / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2)
        a = np.clip(1.0 - d, 0.0, 1.0) ** 2
        arr = np.zeros((h, w, 4), dtype=np.uint8)
        arr[:, :, 0], arr[:, :, 1], arr[:, :, 2] = rgb
        arr[:, :, 3] = (a * 255).astype(np.uint8)
        return Image.fromarray(arr, "RGBA")

    @staticmethod
    def _hex(color: str) -> tuple:
        c = color.lstrip("#")
        return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))

    # ---------------- langit ----------------
    def _build_sky(self) -> np.ndarray:
        W, H = self.W, self.H
        y = np.linspace(0.0, 1.0, H, dtype=np.float32)[:, None]
        top = np.array([5, 8, 22], dtype=np.float32)
        mid = np.array([14, 20, 48], dtype=np.float32)
        horizon_col = np.array([54, 50, 78], dtype=np.float32)
        k = np.clip(y / max(0.01, self.horizon / H), 0.0, 1.0)
        grad = top + (mid - top) * k
        grad[(y > self.horizon / H)[:, 0]] = horizon_col
        sky = np.repeat(grad[:, None, :], W, axis=1).copy()

        mx, my, mr = int(W * 0.72), int(H * 0.12), int(H * 0.042)
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        d = np.sqrt((xx - mx) ** 2 + (yy - my) ** 2)
        halo = np.clip(1.0 - d / (mr * 9.0), 0.0, 1.0) ** 3
        sky += halo[:, :, None] * np.array([60, 66, 92], dtype=np.float32)
        disc = d <= mr
        sky[disc] = np.array([242, 240, 214], dtype=np.float32)
        for cx, cy, cr in ((mr * 0.34, -mr * 0.22, mr * 0.2), (-mr * 0.28, mr * 0.3, mr * 0.15)):
            dd = np.sqrt((xx - (mx + cx)) ** 2 + (yy - (my + cy)) ** 2)
            sky[(dd <= cr) & disc] = np.array([224, 222, 198], dtype=np.float32)

        rng = np.random.default_rng(4)
        self.stars = [(int(rng.integers(0, W)), int(rng.integers(0, max(2, int(self.horizon * 0.9)))),
                       float(rng.random() * 6.28), float(rng.uniform(0.4, 1.0))) for _ in range(220)]
        return sky

    # ---------------- bangunan ----------------
    def _plan_buildings(self) -> list:
        rng = np.random.default_rng(9)
        plans = []
        z = 14.0
        while z < 300:
            for side in (-1, 1):
                w = float(rng.uniform(7, 13))
                depth = float(rng.uniform(7, 14))
                h = float(rng.uniform(8, 30)) * (1.0 if rng.random() < 0.8 else 1.45)
                x = side * (10.5 + w / 2 + rng.uniform(0, 6))
                tint = float(rng.uniform(0.75, 1.0))
                plans.append({"x": x, "z": z + float(rng.uniform(-3, 3)), "w": w, "d": depth, "h": h,
                              "base": np.array([36, 40, 62], dtype=np.float32) * tint})
            z += float(rng.uniform(10, 20))
        return plans

    # ---------------- primitif 3D ----------------
    @staticmethod
    def _box_faces(x0, x1, y0, y1, z0, z1):
        return [
            (np.array([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], dtype=np.float32),
             np.array([0, 0, -1], dtype=np.float32)),
            (np.array([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], dtype=np.float32),
             np.array([0, 0, 1], dtype=np.float32)),
            (np.array([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], dtype=np.float32),
             np.array([-1, 0, 0], dtype=np.float32)),
            (np.array([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], dtype=np.float32),
             np.array([1, 0, 0], dtype=np.float32)),
            (np.array([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], dtype=np.float32),
             np.array([0, 1, 0], dtype=np.float32)),
        ]

    def _poly(self, draw, corners: np.ndarray, color, normal: np.ndarray) -> None:
        sx, sy, fwd = self.cam.project(corners)
        if np.any(fwd <= 0.35):
            return
        if sx.max() < -60 or sx.min() > self.W + 60 or sy.max() < -60 or sy.min() > self.H + 60:
            return
        draw.polygon(list(zip(sx.tolist(), sy.tolist())),
                     fill=tuple(int(min(255, max(0, c))) for c in color))

    def _draw_box(self, draw, x0, x1, y0, y1, z0, z1, base: np.ndarray) -> None:
        cam = np.array([self.cam.x, self.cam.height, self.cam.z], dtype=np.float32)
        for corners, normal in self._box_faces(x0, x1, y0, y1, z0, z1):
            center = corners.mean(axis=0)
            if float((center - cam) @ normal) >= 0:
                continue
            dist = float(np.linalg.norm(center - cam))
            self._poly(draw, corners, _shade(_fog_mix(base, dist), normal), normal)

    # ---------------- jalan ----------------
    def _draw_road(self, frame: np.ndarray, travel: float, hero_x: float) -> None:
        H, W = self.H, self.W
        top = int(np.ceil(self.horizon)) + 1
        rows = np.arange(top, H, dtype=np.float32)
        dz = self.cam.ground_distance(rows)
        cp, sp = math.cos(self.cam.pitch), math.sin(self.cam.pitch)
        fwd = self.cam.height * sp + dz * cp
        fog = 1.0 - np.exp(-dz / 130.0)

        asphalt = np.array([27, 27, 33], dtype=np.float32)
        shade = np.clip(1.05 - dz / 120.0, 0.72, 1.0)[:, None]
        color = asphalt[None, :] * shade
        color = color * (1 - fog[:, None]) + FOG[None, :] * fog[:, None]
        frame[top:H] = color[:, None, :]
        frame[top:H] += self.road_noise[top:H] * 0.9

        # Lampu depan hero menerangi aspal di depannya.
        depan = (dz > 2.5) & (dz < 55)
        if depan.any():
            inten = 165.0 * np.exp(-dz[depan] / 22.0)
            xc = self.cam.cx + self.cam.f * (hero_x - self.cam.x) / fwd[depan]
            half = self.cam.f * 2.9 / fwd[depan]
            for row, c_x, h_w, it in zip(rows[depan].astype(int), xc, half, inten):
                x0, x1 = int(c_x - h_w), int(c_x + h_w)
                if x1 < 0 or x0 > W:
                    continue
                cols = np.arange(max(0, x0), min(W, x1), dtype=np.float32)
                if cols.size == 0:
                    continue
                fall = np.exp(-((cols - c_x) / max(1.0, h_w)) ** 2 * 1.6)
                frame[row, cols.astype(int)] += (fall * it)[:, None] * np.array([1.0, 0.92, 0.72], dtype=np.float32)

        # Trotoar: di luar badan jalan warnanya beda, jadi jalan punya tepi.
        tepi_kiri = self.cam.cx + self.cam.f * (-ROAD_HALF - self.cam.x) / fwd
        tepi_kanan = self.cam.cx + self.cam.f * (ROAD_HALF - self.cam.x) / fwd
        trotoar = np.array([40, 40, 47], dtype=np.float32)
        for row, xl, xr in zip(rows.astype(int), tepi_kiri, tepi_kanan):
            if xl > 0:
                frame[row, :min(W, int(xl))] = trotoar
            if xr < W:
                frame[row, max(0, int(xr)):] = trotoar

        # Marka: diproyeksikan per baris supaya mengecil ke horizon.
        # Marka pemisah lane ada di ANTARA lane, bukan di tengah lane.
        for gx, putus in ((-LANE_W / 2, True), (LANE_W / 2, True),
                          (-ROAD_HALF, False), (ROAD_HALF, False)):
            sx = self.cam.cx + self.cam.f * (gx - self.cam.x) / fwd
            lebar = np.clip(self.cam.f * 0.14 / fwd, 1.0, 9.0)
            nyala = (((dz + travel) % DASH_PERIOD) < DASH_LEN) if putus else np.ones_like(dz, dtype=bool)
            for row, x, w, on in zip(rows.astype(int), sx, lebar, nyala):
                if not on:
                    continue
                x0, x1 = int(x - w / 2), int(x + w / 2) + 1
                # Tanpa penjagaan ini, indeks negatif memotong seluruh baris
                # dan meninggalkan garis putih selebar layar.
                if x1 <= 0 or x0 >= W:
                    continue
                frame[row, max(0, x0):min(W, x1)] = np.array([226, 224, 198], dtype=np.float32)

    def _draw_lamp_pools(self, pil: Image.Image, travel: float) -> None:
        overlay = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0))
        d = ImageDraw.Draw(overlay)
        for lx, lz in self.lamps:
            for k in range(-1, 9):
                zz = lz - (travel % 34.0) + k * 34.0
                if zz < 3 or zz > 190:
                    continue
                sx, sy, fwd = self.cam.project(np.array([[lx, 0.02, zz]], dtype=np.float32))
                if fwd[0] <= 1:
                    continue
                r = float(self.cam.f * 2.2 / fwd[0])
                a = math.exp(-zz / 110.0)
                if a <= 0.05 or r < 3:
                    continue
                w, h = int(r * 2), max(2, int(r * 0.7))
                sprite = self.pool.resize((max(2, w), h), Image.BILINEAR)
                sprite.putalpha(sprite.getchannel("A").point(lambda v, k=a: int(v * k)))
                overlay.alpha_composite(sprite, (int(sx[0] - w / 2), int(sy[0] - h / 2)))
        pil.alpha_composite(overlay)

    # ---------------- kendaraan ----------------
    def _draw_car(self, draw, cx: float, z: float, base: np.ndarray, hero: bool = False) -> None:
        lw, ww = 2.25, 0.92  # setengah panjang, setengah lebar
        ban = np.array([18, 18, 22], dtype=np.float32)
        for wx in (cx - ww - 0.10, cx + ww - 0.02):
            for wz in (z - lw * 0.62, z + lw * 0.52):
                self._draw_box(draw, wx, wx + 0.20, 0.02, 0.70, wz, wz + 0.66, ban)
        self._draw_box(draw, cx - ww, cx + ww, 0.30, 1.02, z - lw, z + lw, base)
        self._draw_box(draw, cx - ww * 0.84, cx + ww * 0.84, 1.02, 1.44, z - lw * 0.46, z + lw * 0.30, base * 0.90)

        zr = z - lw - 0.02
        self._poly(draw, np.array([[cx - ww * 0.74, 1.10, zr], [cx + ww * 0.74, 1.10, zr],
                                   [cx + ww * 0.68, 1.40, zr], [cx - ww * 0.68, 1.40, zr]], dtype=np.float32),
                   np.array([26, 32, 44], dtype=np.float32), np.array([0, 0, -1], dtype=np.float32))
        lampu = np.array([255, 52, 44], dtype=np.float32) if hero else np.array([220, 40, 36], dtype=np.float32)
        for s in (-1, 1):
            self._poly(draw, np.array([
                [cx + s * ww * 0.42, 0.74, zr], [cx + s * ww * 0.95, 0.74, zr],
                [cx + s * ww * 0.95, 0.94, zr], [cx + s * ww * 0.42, 0.94, zr]], dtype=np.float32),
                lampu, np.array([0, 0, -1], dtype=np.float32))
        if hero:
            self._poly(draw, np.array([[cx - 0.17, 0.52, zr], [cx + 0.17, 0.52, zr],
                                       [cx + 0.17, 0.63, zr], [cx - 0.17, 0.63, zr]], dtype=np.float32),
                       np.array([208, 208, 198], dtype=np.float32), np.array([0, 0, -1], dtype=np.float32))
            # Bemper belakang: garis gelap supaya bodi tidak terlihat seperti kotak.
            self._poly(draw, np.array([[cx - ww, 0.30, zr], [cx + ww, 0.30, zr],
                                       [cx + ww, 0.44, zr], [cx - ww, 0.44, zr]], dtype=np.float32),
                       base * 0.55, np.array([0, 0, -1], dtype=np.float32))
            # Bibir bagasi tipis, bukan sayap besar: sayap besar terbaca sebagai
            # kotak terpisah saat dilihat dari belakang.
            self._draw_box(draw, cx - ww * 0.98, cx + ww * 0.98, 0.98, 1.04, z - lw - 0.12, z - lw + 0.3,
                           base * 0.75)

    def _draw_windows(self, draw, b: dict) -> None:
        zc = b["z"] - b["d"] / 2 - 0.02
        cols = max(1, int(b["w"] / 1.5))
        rows = max(1, int((b["h"] - 3.0) / 2.4))
        step_x = b["w"] / cols
        rng = np.random.default_rng(int(abs(b["x"]) * 13 + b["z"] * 7))
        for r in range(rows):
            y0 = 2.0 + r * 2.4
            if y0 + 1.2 > b["h"]:
                break
            for c in range(cols):
                x0 = b["x"] - b["w"] / 2 + 0.5 + c * step_x
                if rng.random() > 0.55:
                    continue
                col = (np.array([255, 208, 128], dtype=np.float32) if rng.random() < 0.75
                       else np.array([168, 204, 255], dtype=np.float32))
                self._poly(draw, np.array([[x0, y0, zc], [x0 + step_x * 0.62, y0, zc],
                                           [x0 + step_x * 0.62, y0 + 1.25, zc], [x0, y0 + 1.25, zc]],
                                          dtype=np.float32),
                           col, np.array([0, 0, -1], dtype=np.float32))

    def _draw_lamp(self, draw, lx: float, lz: float) -> None:
        sx, sy, fwd = self.cam.project(np.array([[lx, 0, lz], [lx, 7.2, lz]], dtype=np.float32))
        if np.any(fwd <= 0.6):
            return
        draw.line([(sx[0], sy[0]), (sx[1], sy[1])], fill=(58, 62, 78), width=max(1, int(self.cam.f * 0.12 / fwd[0])))
        r = max(1, int(self.cam.f * 0.22 / fwd[0]))
        draw.ellipse([sx[1] - r, sy[1] - r, sx[1] + r, sy[1] + r], fill=(255, 226, 170))

    # ---------------- frame ----------------
    def render_frame(self, index: int) -> np.ndarray:
        t = index / self.fps
        lane = hero_lane(t, self.dur)
        hero_x = (lane - 1) * LANE_W
        # Kamera mengikuti perpindahan lane dengan jeda, seperti kamera mobil.
        self.cam.x += (hero_x - self.cam.x) * 0.14
        self.cam.height = 1.75 + 0.012 * math.sin(t * 7.3)
        travel = 16.7 * t

        frame = self.sky.copy()
        for sx, sy, ph, amp in self.stars:
            v = 105 + 130 * (0.5 + 0.5 * math.sin(t * 2.7 + ph)) * amp
            frame[sy, sx] = (v, v, min(255.0, v + 22))

        self._draw_road(frame, travel, hero_x)

        pil = Image.fromarray(np.clip(frame, 0, 255).astype(np.uint8)).convert("RGBA")
        draw = ImageDraw.Draw(pil)

        # Bangunan diam di dunia; kamera yang maju, jadi z-nya berkurang dan
        # yang sudah lewat dipakai ulang di kejauhan (perioda 286 m).
        for b in self.buildings:
            z = 14.0 + ((b["z"] - 14.0 - travel) % 286.0)
            if z < 4 or z > 280:
                continue
            self._draw_box(draw, b["x"] - b["w"] / 2, b["x"] + b["w"] / 2, 0.0, b["h"],
                           z - b["d"] / 2, z + b["d"] / 2, b["base"])
            if z < 150 and b["h"] > 8:
                self._draw_windows(draw, {**b, "z": z})
        # Urutan jauh->dekat supaya bangunan dekat menutup yang jauh.
        draw._image = draw._image if False else draw._image

        self._draw_lamp_pools(pil, travel)
        draw = ImageDraw.Draw(pil)
        for lamp_x, lamp_z in self.lamps:
            for k in range(-1, 9):
                zz = lamp_z - (travel % 34.0) + k * 34.0
                if 3 < zz < 190:
                    self._draw_lamp(draw, lamp_x, zz)

        for car in traffic_at(t, self.dur):
            if car.z < -9:
                continue
            self._draw_car(draw, car.x, car.z, self.other_colors[car.variant % len(self.other_colors)])

        self._draw_car(draw, hero_x, 0.0, self.hero_color, hero=True)

        frame = np.asarray(pil.convert("RGB"), dtype=np.float32)
        self._bloom(frame)
        frame[:, :, 0] *= 1.03
        frame[:, :, 2] *= 1.05
        postfx.grain(frame, self.rng, 2.6)
        frame *= self.vignette[:, :, None]
        postfx.fade_to_black(frame, t, self.dur)
        return np.clip(frame, 0, 255).astype(np.uint8)

    def _bloom(self, frame: np.ndarray) -> None:
        small = Image.fromarray(np.clip(frame, 0, 255).astype(np.uint8)).resize(
            (self.W // 4, self.H // 4), Image.BILINEAR)
        arr = np.asarray(small, dtype=np.float32)
        luma = arr.max(axis=2)
        mask = np.clip((luma - 185) / 70.0, 0.0, 1.0)[:, :, None]
        glow = Image.fromarray(np.clip(arr * mask, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4))
        frame += np.asarray(glow.resize((self.W, self.H), Image.BILINEAR), dtype=np.float32) * 0.5
