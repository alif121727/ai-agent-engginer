"""Renderer pratinjau: raster sederhana dari mesh, tanpa cv2 (C.8, C.16).

Tujuannya bukan kualitas sinematik, tapi gambar yang cukup untuk memeriksa
proporsi dan warna. Pakai z-buffer + shading Gouraud per quad, sama seperti
pipeline car-chase, hanya tanpa langit/pohon/post.
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .builder import KIND_GLASS, KIND_TIRE, KIND_RIM, Mesh, build_car

DEFAULT_CAMERA = {"azimuth_deg": 45.0, "elevation_deg": 15.0,
                  "distance_m": 8.0, "fov_deg": 35.0}

BG = (32, 32, 32)


def _material(mesh: Mesh, spec: dict) -> np.ndarray:
    """Tabel albedo/spec/gloss/rim per quad."""
    sr, c = spec["surface_response"], spec["colors"]
    body = mesh.color
    n = mesh.n_quads
    alb = np.zeros((n, 3), np.float32)
    spec_k = np.zeros(n, np.float32)
    gloss = np.zeros(n, np.float32)
    rim = np.zeros(n, np.float32)

    K = mesh.K
    alb[:] = body
    spec_k[:] = sr["body_specular"]
    gloss[:] = sr["body_gloss"]
    rim[:] = sr["body_rim"]

    for kind, a, s, g, r in [
        (KIND_GLASS, (0.010, 0.013, 0.020), sr["glass_specular"], 90.0, sr["glass_rim"]),
        (2, (0.014, 0.014, 0.016), 0.40, 34.0, 0.55),          # carbon
        (KIND_TIRE, (0.010, 0.010, 0.010), 0.03, 8.0, 0.15),
        (KIND_RIM, (0.17, 0.17, 0.19), 0.55, 46.0, 0.35),
        (5, (0.003, 0.003, 0.003), 0.0, 8.0, 0.0),             # arch
        (6, (0.55, 0.12, 0.05), 0.45, 30.0, 0.4),              # brake
        (7, (0.008, 0.008, 0.009), 0.20, 22.0, 0.25),          # trim
        (8, (0.85, 0.85, 0.80), 0.60, 60.0, 0.5),              # lamp
    ]:
        m = K == kind
        alb[m] = a
        spec_k[m] = s
        gloss[m] = g
        rim[m] = r
    return alb, spec_k, gloss, rim


def _basis(cam_pos, target):
    f = target - cam_pos
    f /= np.linalg.norm(f)
    r = np.array([f[2], 0.0, -f[0]])
    n = np.linalg.norm(r)
    r = r / n if n > 1e-9 else np.array([1.0, 0.0, 0.0])
    u = np.cross(r, f)
    return r, u, f


def render_array(mesh: Mesh, spec: dict, size: int = 512,
                 camera: dict | None = None) -> np.ndarray:
    cam = {**DEFAULT_CAMERA, **(spec.get("preview_camera") or {}), **(camera or {})}
    az = math.radians(cam["azimuth_deg"])
    el = math.radians(cam["elevation_deg"])
    d = cam["distance_m"]
    target = np.array([0.0, mesh.height * 0.45, 0.0])
    cam_pos = target + d * np.array([math.sin(az) * math.cos(el),
                                     math.sin(el),
                                     math.cos(az) * math.cos(el)])
    right, up, fwd = _basis(cam_pos, target)

    img = np.full((size, size, 3), np.array(BG, np.float32) / 255.0, np.float32)
    zbuf = np.full((size, size), np.inf, np.float32)

    focal = (size / 2) / math.tan(math.radians(cam["fov_deg"]) / 2)

    Q = mesh.Q.astype(np.float64)
    VN = mesh.VN.astype(np.float64)
    rel = Q - cam_pos
    xc = rel @ right
    yc = rel @ up
    zc = rel @ fwd

    alb, spec_k, gloss, rim = _material(mesh, spec)
    light = np.array([0.35, 0.85, 0.40])
    light /= np.linalg.norm(light)

    order = np.argsort(-zc.mean(axis=1))  # jauh dulu
    for i in order:
        if (zc[i] < 0.15).any():
            continue
        sx = (xc[i] / zc[i]) * focal + size / 2
        sy = size / 2 - (yc[i] / zc[i]) * focal
        if sx.max() < 0 or sx.min() > size or sy.max() < 0 or sy.min() > size:
            continue

        n = VN[i].mean(axis=0)
        ln = np.linalg.norm(n)
        if ln < 1e-9:
            continue
        n /= ln
        view = (cam_pos - Q[i].mean(axis=0))
        view /= max(np.linalg.norm(view), 1e-9)
        if np.dot(n, view) < 0:
            n = -n

        diff = max(np.dot(n, light), 0.0)
        half = light + view
        half /= max(np.linalg.norm(half), 1e-9)
        sp = max(np.dot(n, half), 0.0) ** max(gloss[i], 1.0) * spec_k[i]
        fres = (1.0 - max(np.dot(n, view), 0.0)) ** 3 * rim[i]
        col = alb[i] * (0.18 + 0.82 * diff) + sp * 1.4 + fres * 0.35
        col = np.clip(col, 0.0, 1.0)

        _fill_quad(img, zbuf, sx, sy, zc[i], col)

    return (np.clip(img, 0, 1) * 255).astype(np.uint8)


def _fill_quad(img, zbuf, sx, sy, zc, col):
    """Rasterisasi quad sebagai 2 segitiga dengan interpolasi barycentric."""
    size = img.shape[0]
    tris = [(0, 1, 2), (0, 2, 3)]
    for a, b, c in tris:
        x0, y0, z0 = sx[a], sy[a], zc[a]
        x1, y1, z1 = sx[b], sy[b], zc[b]
        x2, y2, z2 = sx[c], sy[c], zc[c]
        minx = max(int(math.floor(min(x0, x1, x2))), 0)
        maxx = min(int(math.ceil(max(x0, x1, x2))), size - 1)
        miny = max(int(math.floor(min(y0, y1, y2))), 0)
        maxy = min(int(math.ceil(max(y0, y1, y2))), size - 1)
        if minx > maxx or miny > maxy:
            continue
        den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(den) < 1e-12:
            continue
        ys, xs = np.mgrid[miny:maxy + 1, minx:maxx + 1]
        px, py = xs + 0.5, ys + 0.5
        w0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / den
        w1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / den
        w2 = 1.0 - w0 - w1
        inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        if not inside.any():
            continue
        z = w0 * z0 + w1 * z1 + w2 * z2
        sub_z = zbuf[miny:maxy + 1, minx:maxx + 1]
        mask = inside & (z < sub_z)
        if not mask.any():
            continue
        sub_z[mask] = z[mask]
        img[miny:maxy + 1, minx:maxx + 1][mask] = col


def render_preview(spec: dict, out_path, size: int = 512,
                   camera: dict | None = None, mesh: Mesh | None = None) -> Path:
    if mesh is None:
        mesh = build_car(spec)
    arr = render_array(mesh, spec, size=size, camera=camera)
    p = Path(out_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr, "RGB").save(p)
    return p


def _font(size: int):
    for name in ("DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def contact_sheet(specs: dict[str, dict], out_path, cols: int = 3,
                  size: int = 384, pad: int = 8) -> Path:
    n = len(specs)
    rows = math.ceil(n / cols)
    label_h = 44
    cell_w = size + pad * 2
    cell_h = size + label_h + pad * 2
    W, H = cols * cell_w, rows * cell_h
    sheet = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(sheet)
    font = _font(13)
    small = _font(11)

    for i, (name, spec) in enumerate(specs.items()):
        cx, cy = i % cols, i // cols
        ox, oy = cx * cell_w + pad, cy * cell_h + pad
        arr = render_array(build_car(spec), spec, size=size)
        sheet.paste(Image.fromarray(arr, "RGB"), (ox, oy))
        draw.text((ox, oy + size + 3), spec["meta"]["display_name"][:34], fill=(235, 235, 235), font=font)
        dims = spec["dimensions"]
        total = dims["overhang_front"] + dims["wheelbase"] + dims["overhang_rear"]
        draw.text((ox, oy + size + 20),
                  f"{total:.2f}m  wing:{spec['wing']['type']}", fill=(150, 150, 155), font=small)
    p = Path(out_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(p)
    return p
