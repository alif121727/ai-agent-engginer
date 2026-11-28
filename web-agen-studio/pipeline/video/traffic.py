"""Jadwal lalu lintas + logika menyalip. Semua fungsi deterministik dari waktu."""
from dataclasses import dataclass

SOLO_FROM = 0.7667  # detik 23 dari 30: hero melaju sendirian

# (mulai, selesai, lane tujuan) sebagai fraksi durasi.
OVERTAKES = [(0.10, 0.20, 0), (0.30, 0.40, 2), (0.43, 0.60, 0), (0.63, 0.73, 2)]

HERO_LANE = 1


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
    x: float
    scale: float
    variant: int
    alpha: float = 1.0


def traffic_at(t: float, dur: float, width: float) -> list:
    """Mobil lain di jalan. Kosong setelah SOLO_FROM supaya hero sendirian."""
    if t >= SOLO_FROM * dur:
        return []
    mobil: list[Car] = []
    hero_x = width * 0.30

    # Sasaran yang disalip: mulai sedikit di depan hero, berakhir di belakang.
    for t0, t1, lane in events(dur):
        if t0 - 0.6 <= t <= t1 + 0.8:
            frac = (t - (t0 - 0.6)) / ((t1 + 0.8) - (t0 - 0.6))
            x = hero_x + width * 0.22 - frac * width * 0.95
            mobil.append(Car(lane=lane, x=x, scale=0.82, variant=1 + (lane % 2)))

    # Lalu lintas latar: spawn deterministik tiap 0.7 detik.
    k = 0
    while k * 0.7 < min(t, SOLO_FROM * dur - 1.2):
        ts = k * 0.7
        umur = t - ts
        if 0 <= umur <= 5.5:
            lane = (k * 2) % 3
            speed = 240 + (k * 53) % 200
            x = width * 1.15 - speed * umur
            if x > -width * 0.35:
                # Mobil di lane yang sama tidak boleh saling menimpa.
                if not any(c.lane == lane and abs(c.x - x) < width * 0.13 for c in mobil):
                    mobil.append(Car(lane=lane, x=x, scale=0.74, variant=k % 3, alpha=0.9))
        k += 1
    return mobil
