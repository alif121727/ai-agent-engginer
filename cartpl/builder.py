"""Bangun mesh quad dari CarSpec final.

Tidak ada angka geometri di file ini: semua konstanta datang dari
`spec["geometry"]` (termasuk `geometry.proportions` dan `geometry.shading`),
`spec["dimensions"]`, `spec["sections"]`, dan `spec["wheels"]`.
Kalau butuh angka baru, tambahkan ke schema + template dulu (aturan keras
di PROMPT).

Konvensi sumbu: +Z depan, +Y atas, +X kanan. Satuan meter.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from .livery import generate_mask
from .lods import pick_lod

KIND_BODY, KIND_GLASS, KIND_CARBON, KIND_TIRE, KIND_RIM, KIND_ARCH = range(6)
KIND_BRAKE, KIND_TRIM, KIND_LAMP = range(6, 9)

EPS = 1e-12
GROUND = 0.0


@dataclass
class Mesh:
    Q: np.ndarray           # (n_quads, 4, 3) float32
    VN: np.ndarray          # (n_quads, 4, 3) float32 normal per vertex
    C: np.ndarray           # (n_quads, 3)    float32 centroid
    K: np.ndarray           # (n_quads,)      int32 jenis material
    B: np.ndarray           # (n_quads,)      float32 bias shading
    color: np.ndarray       # (n_quads, 3)    float32 albedo bodi per quad
    lights: list = field(default_factory=list)
    length: float = 0.0
    half_width: float = 0.0
    height: float = 0.0

    @property
    def n_quads(self) -> int:
        return int(self.Q.shape[0])

    @property
    def n_verts(self) -> int:
        return int(self.Q.shape[0] * 4)

    def to_bytes(self) -> bytes:
        """Representasi stabil untuk hashing snapshot."""
        return b"".join([
            np.round(self.Q, 5).astype(np.float32).tobytes(),
            np.round(self.VN, 4).astype(np.float32).tobytes(),
            self.K.astype(np.int32).tobytes(),
        ])


def _pchip(zs, vs, zi):
    from scipy.interpolate import PchipInterpolator

    return PchipInterpolator(zs, vs)(zi)


def _interp_at(sections: list[dict], key: str, z: float) -> float:
    zs = [s["z"] for s in sections]
    vs = [s[key] for s in sections]
    z = min(max(z, zs[0]), zs[-1])
    return float(_pchip(zs, vs, [z])[0])


class _Acc:
    """Akumulator quad + normal per vertex."""

    def __init__(self):
        self.Q, self.C, self.K, self.B, self.VN = [], [], [], [], []

    def add(self, pts, kind: int, bias: float = 0.0, normals=None):
        q = np.asarray(pts, np.float64)
        self.Q.append(q)
        self.C.append(q.mean(0))
        self.K.append(kind)
        self.B.append(bias)
        if normals is None:
            n = np.cross(q[2] - q[0], q[3] - q[1])
            ln = np.linalg.norm(n)
            n = n / ln if ln > EPS else np.array([0.0, 1.0, 0.0])
            normals = np.array([n, n, n, n])
        self.VN.append(np.asarray(normals, np.float64))

    def box(self, center, size, kind: int, bias: float = 0.0):
        cx, cy, cz = center
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        faces = [
            ([(-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)], (0, 0, 1)),
            ([(-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz), (hx, -hy, -hz)], (0, 0, -1)),
            ([(-hx, hy, -hz), (-hx, hy, hz), (hx, hy, hz), (hx, hy, -hz)], (0, 1, 0)),
            ([(-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz), (-hx, -hy, hz)], (0, -1, 0)),
            ([(hx, -hy, -hz), (hx, hy, -hz), (hx, hy, hz), (hx, -hy, hz)], (1, 0, 0)),
            ([(-hx, -hy, -hz), (-hx, -hy, hz), (-hx, hy, hz), (-hx, hy, -hz)], (-1, 0, 0)),
        ]
        for pts, nn in faces:
            v = np.array(nn, np.float64)
            self.add([(cx + p[0], cy + p[1], cz + p[2]) for p in pts], kind, bias,
                     np.array([v, v, v, v]))


def _loft(acc: _Acc, sections: list[dict], exponent: float, nsec: int, nring: int,
          side_kind: int, roof_kind: int, cap_kind: int, geo: dict) -> np.ndarray:
    prop = geo["proportions"]
    zs = np.array([s["z"] for s in sections], np.float64)
    zi = np.linspace(zs[0], zs[-1], nsec)
    hw = _pchip(zs, [s["half_width"] for s in sections], zi)
    yb = _pchip(zs, [s["y_bottom"] for s in sections], zi)
    yt = _pchip(zs, [s["y_top"] for s in sections], zi)

    ang = np.linspace(0, 2 * np.pi, nring, endpoint=False)
    c, s = np.cos(ang), np.sin(ang)
    ex = 2.0 / exponent
    px = np.sign(c) * np.abs(c) ** ex
    py = np.sign(s) * np.abs(s) ** ex

    V = np.zeros((nsec, nring, 3), np.float64)
    V[:, :, 0] = hw[:, None] * px[None, :]
    V[:, :, 1] = ((yb + yt) / 2)[:, None] + ((yt - yb) / 2)[:, None] * py[None, :]
    V[:, :, 2] = zi[:, None]

    acc_n = np.zeros((nsec, nring, 3), np.float64)
    quads = []
    for i in range(nsec - 1):
        cen = (V[i].mean(0) + V[i + 1].mean(0)) / 2
        for j in range(nring):
            j2 = (j + 1) % nring
            idx = ((i, j), (i + 1, j), (i + 1, j2), (i, j2))
            q = np.array([V[a] for a in idx])
            nrm = np.cross(q[2] - q[0], q[3] - q[1])
            ln = np.linalg.norm(nrm)
            if ln < EPS:
                continue
            nrm /= ln
            if np.dot(nrm, q.mean(0) - cen) < 0:
                nrm = -nrm
            for a in idx:
                acc_n[a] += nrm
            quads.append((q, idx, nrm))

    for q, idx, nrm in quads:
        kind = roof_kind if nrm[1] > prop["roof_normal_threshold"] else side_kind
        if side_kind == KIND_BODY and nrm[1] < prop["underside_threshold"]:
            kind = KIND_CARBON
        vn = np.array([acc_n[a] for a in idx])
        vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), EPS)
        acc.add(q, kind, 0.0, vn)

    for i, sgn in ((0, -1), (nsec - 1, 1)):
        ring = V[i]
        cen = ring.mean(0)
        nn = np.array([0.0, 0.0, sgn])
        for j in range(nring):
            j2 = (j + 1) % nring
            acc.add([cen, ring[j], ring[j2], ring[j2]], cap_kind, 0.0,
                    np.array([nn, nn, nn, nn]))
    return V


def _wheel(acc: _Acc, spec: dict, sx: int, wz: float, r: float, nspoke: int) -> None:
    geo, wh = spec["geometry"], spec["wheels"]
    sh = geo["shading"]
    bw = _interp_at(spec["sections"], "half_width", wz)
    x_out = sx * (bw - geo["wheel_out_inset_m"])
    x_in = sx * (bw - geo["wheel_out_inset_m"] - geo["wheel_depth_m"])
    m = geo["tire_segments"]
    th = np.linspace(0, 2 * np.pi, m, endpoint=False)

    for j in range(m):
        t0, t1 = th[j], th[(j + 1) % m]
        tm = (t0 + t1) / 2
        v = np.array([0.0, math.cos(tm), math.sin(tm)])
        acc.add([
            (x_in, r + r * math.cos(t0), wz + r * math.sin(t0)),
            (x_out, r + r * math.cos(t0), wz + r * math.sin(t0)),
            (x_out, r + r * math.cos(t1), wz + r * math.sin(t1)),
            (x_in, r + r * math.cos(t1), wz + r * math.sin(t1)),
        ], KIND_TIRE, sh["bias_tire"], np.array([v, v, v, v]))

    def disc(xp, rad, kind, bias, clip_ground=False):
        ring = np.array([(xp, r + rad * math.cos(t), wz + rad * math.sin(t)) for t in th])
        cen = np.array([xp, r, wz])
        if clip_ground:
            ring[:, 1] = np.maximum(ring[:, 1], GROUND)
            cen[1] = max(cen[1], GROUND)
        n = np.array([sx, 0.0, 0.0])
        for j in range(m):
            j2 = (j + 1) % m
            acc.add([cen, ring[j], ring[j2], ring[j2]], kind, bias,
                    np.array([n, n, n, n]))

    disc(x_out, r, KIND_TIRE, sh["bias_tire_disc"])
    disc(x_out + sx * geo["rim_disc_offset_m"], r * geo["rim_disc_frac"],
         KIND_RIM, sh["bias_rim"])

    if nspoke > 0:
        rr = r * geo["spoke_outer_frac"]
        r0 = geo["spoke_inner_radius_m"]
        hwid = geo["spoke_half_width_m"]
        px_ = x_out + sx * geo["rim_disc_offset_m"]
        for k in range(nspoke):
            a0 = 2 * math.pi * k / nspoke
            sa, ca = math.sin(a0), math.cos(a0)
            py0, pz0 = r + rr * ca, wz + rr * sa
            py1, pz1 = r + r0 * ca, wz + r0 * sa
            acc.add([
                (px_, py0 - hwid * sa, pz0 + hwid * ca),
                (px_, py0 + hwid * sa, pz0 - hwid * ca),
                (px_, py1 + hwid * sa, pz1 - hwid * ca),
                (px_, py1 - hwid * sa, pz1 + hwid * ca),
            ], KIND_RIM, sh["bias_spoke"], np.array([[sx, 0, 0]] * 4))

    ca_ang = math.radians(geo["brake_angle_deg"] + geo["brake_angle_step_deg"] * sx)
    br = r * geo["brake_radius_frac"]
    acc.box(
        (x_out - sx * geo["rim_disc_offset_m"], r + br * math.cos(ca_ang), wz + br * math.sin(ca_ang)),
        geo["brake_box_dims_m"], KIND_BRAKE, sh["bias_brake"],
    )
    disc(sx * (bw - geo["rim_disc_offset_m"]), r * geo["arch_radius_frac"],
         KIND_ARCH, sh["bias_arch"], clip_ground=True)


def _wing(acc: _Acc, spec: dict, deck_y: float, rear_z: float) -> None:
    wing, geo = spec["wing"], spec["geometry"]
    if wing["type"] == "none":
        return
    prop, sh = geo["proportions"], geo["shading"]
    kind = KIND_CARBON if wing.get("material", "carbon") == "carbon" else KIND_BODY
    bias = sh["bias_carbon"] if kind == KIND_CARBON else 0.0
    span, chord = wing["span_m"], wing["chord_m"]
    y = deck_y + wing.get("height_above_deck_m", 0.0)
    acc.box((0.0, y, rear_z), (span, chord, chord), kind, bias)
    n_sup = wing.get("supports", 0)
    if n_sup:
        sup = chord * prop["wing_support_scale"]
        for i in range(n_sup):
            x = -span / 2 + span * (i + 0.5) / n_sup
            acc.box((x, deck_y + (y - deck_y) / 2, rear_z), (sup, y - deck_y, sup), kind, bias)
    if wing.get("endplates"):
        ep = chord * prop["wing_support_scale"]
        for sx in (-1, 1):
            acc.box((sx * span / 2, y, rear_z), (ep, ep * 2, ep * 2), kind, bias)


def _aero_front(acc: _Acc, spec: dict, front_z: float, floor_y: float) -> None:
    aero, geo, dims = spec["aero_front"], spec["geometry"], spec["dimensions"]
    prop, sh = geo["proportions"], geo["shading"]
    hw = dims["body_width_max"]
    if aero["splitter"] and aero.get("splitter_depth_m", 0) > 0:
        acc.box((0.0, floor_y, front_z - aero["splitter_depth_m"] / 2),
                (hw * 2 * prop["splitter_width_frac"], prop["splitter_thickness_m"],
                 aero["splitter_depth_m"]),
                KIND_CARBON, sh["bias_carbon"])
    for i in range(aero.get("canards", 0)):
        for sx in (-1, 1):
            y = floor_y + prop["canard_y0_frac"] + i * prop["canard_dy_m"]
            acc.box((sx * hw * prop["canard_x_frac"], y, front_z - prop["canard_z_offset_m"]),
                    prop["canard_dims_m"], KIND_CARBON, sh["bias_carbon"])


def _side_details(acc: _Acc, spec: dict, floor_y: float,
                  wheel_z_front: float, wheel_z_rear: float) -> None:
    side, dims, geo = spec["side_details"], spec["dimensions"], spec["geometry"]
    prop, sh = geo["proportions"], geo["shading"]
    hw = dims["body_width_max"]
    mid_z = (wheel_z_front + wheel_z_rear) / 2
    if side["intake_side"] != "none":
        depth = (prop["intake_depth_scoop_m"] if side["intake_side"] == "scoop"
                 else prop["intake_depth_full_m"])
        for sx in (-1, 1):
            acc.box((sx * hw * prop["intake_x_frac"], floor_y + prop["intake_y0_frac"], mid_z),
                    (prop["intake_thickness_m"], prop["intake_height_m"], depth),
                    KIND_TRIM, sh["bias_trim"])
    if side["sill_skirt"]:
        for sx in (-1, 1):
            acc.box((sx * hw * prop["sill_x_frac"], floor_y + prop["sill_y0_frac"], mid_z),
                    (prop["sill_thickness_m"], prop["sill_height_m"],
                     wheel_z_front - wheel_z_rear - prop["sill_shrink_m"]),
                    KIND_CARBON, sh["bias_carbon"])
    mirror_w = {"teardrop": prop["mirror_teardrop_m"],
                "angular": prop["mirror_angular_m"],
                "camera": prop["mirror_camera_m"]}[side["mirror_shape"]]
    for sx in (-1, 1):
        acc.box((sx * (hw * prop["mirror_x_frac"]),
                 floor_y + prop["mirror_y0_frac"],
                 wheel_z_front + prop["mirror_z_offset_m"]), mirror_w, KIND_BODY)


def _lights(acc: _Acc, spec: dict, front_z: float, rear_z: float, floor_y: float) -> list:
    lights, geo, dims = spec["lights"], spec["geometry"], spec["dimensions"]
    prop, sh = geo["proportions"], geo["shading"]
    hw = dims["body_width_max"]
    out = []

    def panel(z, y0, y1, x0, x1, nz, color, tag):
        for sx in (-1, 1):
            a, b = sorted((sx * x0, sx * x1))
            pts = [(a, y1, z), (b, y1, z), (b, y0, z), (a, y0, z)]
            n = np.array(nz, np.float64)
            acc.add(pts, KIND_LAMP, sh["bias_lamp"], np.array([n, n, n, n]))
            out.append((pts, nz, tuple(color), tag))

    head_y0 = floor_y + prop["light_y0_frac"]
    head_y1 = head_y0 + prop["light_h_m"]
    tail_y0 = floor_y + prop["tail_y0_frac"]
    tail_y1 = tail_y0 + prop["tail_h_m"]

    style_head = lights["headlight"]
    if style_head == "quad-round":
        for sx in (-1, 1):
            for dx in (prop["quad_dx1_m"], prop["quad_dx2_m"]):
                panel(front_z, head_y0, head_y1,
                      sx * (dx - prop["quad_hw_m"]), sx * (dx + prop["quad_hw_m"]),
                      (0, 0, 1), lights["headlight_color"], "head")
    elif style_head == "thin-led":
        panel(front_z, head_y0, head_y0 + prop["thin_h_m"],
              prop["head_inner_m"], hw * prop["head_outer_frac"], (0, 0, 1),
              lights["headlight_color"], "head")
    else:
        panel(front_z, head_y0, head_y1,
              prop["head_inner_m"], hw * prop["head_outer_frac"], (0, 0, 1),
              lights["headlight_color"], "head")

    style_tail = lights["taillight"]
    if style_tail == "full-width":
        for sx in (-1, 1):
            a, b = sorted((sx * prop["tail_inner_m"], sx * hw * prop["tail_outer_frac"]))
            pts = [(a, tail_y1, rear_z), (b, tail_y1, rear_z),
                   (b, tail_y0, rear_z), (a, tail_y0, rear_z)]
            n = np.array([0.0, 0.0, -1.0])
            acc.add(pts, KIND_LAMP, sh["bias_lamp"], np.array([n, n, n, n]))
            out.append((pts, (0, 0, -1), tuple(lights["taillight_color"]), "tail"))
    elif style_tail == "y-shape":
        for sx in (-1, 1):
            a, b = sorted((sx * prop["tail_gap_m"], sx * hw * prop["tail_outer_frac"]))
            pts = [(a, tail_y1, rear_z), (b, tail_y1 - prop["y_drop_m"], rear_z),
                   (b, tail_y0 + prop["y_rise_m"], rear_z), (a, tail_y0, rear_z)]
            n = np.array([0.0, 0.0, -1.0])
            acc.add(pts, KIND_LAMP, sh["bias_lamp"], np.array([n, n, n, n]))
            out.append((pts, (0, 0, -1), tuple(lights["taillight_color"]), "tail"))
    else:
        panel(rear_z, tail_y0, tail_y1,
              prop["tail_gap_m"] * 2, hw * prop["tail_outer_frac"], (0, 0, -1),
              lights["taillight_color"], "tail")
    return out


def build_car(spec: dict, lod=None) -> Mesh:
    """Bangun mesh. `lod` None = LOD paling detail."""
    if lod is None:
        lod = pick_lod(spec, 0.0)
    geo, dims = spec["geometry"], spec["dimensions"]

    nsec = lod["n_sections"]
    nring = lod["n_ring"]
    nspoke = lod["spokes"] if "spokes" in lod else spec["wheels"]["spokes"]

    acc = _Acc()
    _loft(acc, spec["sections"], spec["superellipse_exponent"], nsec, nring,
          KIND_BODY, KIND_BODY, KIND_BODY, geo)
    cabin = spec["cabin"]
    cabin_sec = max(8, geo["cabin_n_sections"] * nsec // max(1, geo["body_n_sections"]))
    _loft(acc, cabin["sections"], cabin["superellipse_exponent"],
          cabin_sec, geo["cabin_n_ring"], KIND_GLASS, KIND_BODY, KIND_GLASS, geo)

    total = dims["overhang_front"] + dims["wheelbase"] + dims["overhang_rear"]
    front_z = total / 2
    rear_z = -total / 2
    wz_front = front_z - dims["overhang_front"]
    wz_rear = rear_z + dims["overhang_rear"]
    r = spec["wheels"]["rim_diameter_m"] / 2 + spec["wheels"]["tire_sidewall_m"]

    for sx in (-1, 1):
        _wheel(acc, spec, sx, wz_front, r, nspoke)
        _wheel(acc, spec, sx, wz_rear, r, nspoke)

    floor_y = dims["ride_height"]
    deck_y = max(s["y_top"] for s in spec["sections"][-3:])
    _wing(acc, spec, deck_y, rear_z + spec["wing"].get("chord_m", 0.0)
          * geo["proportions"]["wing_rear_offset_frac"])
    _aero_front(acc, spec, front_z, floor_y)
    _side_details(acc, spec, floor_y, wz_front, wz_rear)
    lights = _lights(acc, spec, front_z, rear_z, floor_y)

    Q = np.array(acc.Q, np.float32)
    K = np.array(acc.K, np.int32)
    base = np.array(spec["colors"]["body_base"], np.float32)
    color = np.tile(base, (len(acc.Q), 1))

    liv = spec.get("livery") or {"style": "none"}
    if liv.get("style", "none") != "none":
        sec = np.array(liv.get("secondary", spec["colors"]["livery_secondary_default"]),
                       np.float32)
        zmin, zmax = Q[:, :, 2].min(), Q[:, :, 2].max()
        ymin, ymax = Q[:, :, 1].min(), Q[:, :, 1].max()
        aspect = geo["proportions"]["livery_aspect"]
        C = np.array(acc.C, np.float64)
        for i in range(len(acc.Q)):
            u = (C[i, 2] - zmin) / max(zmax - zmin, EPS)
            v = (C[i, 1] - ymin) / max(ymax - ymin, EPS)
            if generate_mask(liv, u, v, aspect=aspect) > 0.5 and K[i] in (KIND_BODY, KIND_CARBON):
                color[i] = sec

    return Mesh(
        Q=Q,
        VN=np.array(acc.VN, np.float32),
        C=np.array(acc.C, np.float32),
        K=K,
        B=np.array(acc.B, np.float32),
        color=color,
        lights=lights,
        length=float(spec["sections"][-1]["z"] - spec["sections"][0]["z"]),
        half_width=float(max(s["half_width"] for s in spec["sections"])),
        height=float(max(s["y_top"] for s in spec["cabin"]["sections"])),
    )
