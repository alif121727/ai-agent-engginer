"""Jadwal lalu lintas dalam satuan meter (bukan piksel), untuk kamera 3D.

Hero berada di z=0 dan bergerak maju; mobil lain punya kecepatan relatif
terhadap hero. Mobil yang disalip melewati kamera tepat di tengah jadwal
menyalip, jadi terlihat benar-benar dilewati.
"""
from dataclasses import dataclass

SOLO_FROM = 0.7667  # detik 23 dari 30: hero melaju sendirian

# (mulai, selesai, lane tujuan) sebagai fraksi durasi.
OVERTAKES = [(0.10, 0.20, 0), (0.30, 0.40, 2), (0.43, 0.60, 0), (0.63, 0.73, 2)]

HERO_LANE = 1
LANE_W = 3.6

# Mobil yang disalip: dilewati tepat di tengah jadwal.
PASSCARS = [(0.15, 1), (0.35, 1), (0.515, 1), (0.68, 1)]

# Lalu lintas latar: (detik dilewati, lane, kecepatan relatif m/detik).
BACKGROUND = [
    (1.6, 0, 12.0), (3.2, 2, 11.0), (5.4, 0, 13.0), (7.0, 2, 10.0),
    (8.6, 0, 12.5), (11.4, 2, 11.5), (13.0, 0, 10.5), (16.4, 2, 12.0),
    (18.0, 0, 11.0), (21.2, 2, 12.5),
]
Z_FAR = 240.0
Z_NEAR = -16.0


def smoothstep(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def events(dur: float):
    return [(t0 * dur, t1 * dur, lane) for t0, t1, lane in OVERTAKES]


def hero_lane(t: float, dur: float) -> float:
    lane = float(HERO_LANE)
    for t0, t1, target in events(dur):
        if t0 - 0.45 <= t < t0:
            lane = HERO_LANE + (target - HERO_LANE) * smoothstep((t - (t0 - 0.45)) / 0.45)
        elif t0 <= t <= t1:
            lane = float(target)
        elif t1 < t <= t1 + 0.45:
            lane = target + (HERO_LANE - target) * smoothstep((t - t1) / 0.45)
    return lane


@dataclass
class Car:
    lane: int
    x: float          # meter, 0 = tengah jalan
    z: float          # meter di depan kamera; negatif = sudah dilewati
    speed: float = 0.0
    variant: int = 0
    being_passed: bool = False


def traffic_at(t: float, dur: float, width: float = 0) -> list:
    """Mobil lain di jalan. Kosong setelah SOLO_FROM supaya hero sendirian."""
    if t >= SOLO_FROM * dur:
        return []
    mobil: list[Car] = []
    for frac, lane in PASSCARS:
        tp = frac * dur
        z = (tp - t) * 13.5
        if Z_NEAR < z < Z_FAR:
            mobil.append(Car(lane=lane, x=(lane - 1) * LANE_W, z=z, speed=-13.5,
                             variant=lane % 3, being_passed=True))
    for tp, lane, rel in BACKGROUND:
        z = (tp - t) * rel
        if Z_NEAR < z < Z_FAR:
            mobil.append(Car(lane=lane, x=(lane - 1) * LANE_W, z=z, speed=-rel,
                             variant=(lane + int(tp)) % 3))
    mobil.sort(key=lambda c: -c.z)
    return mobil
