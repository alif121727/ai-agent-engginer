/**
 * Gerakan kamera konkret untuk zoompan.
 *
 * Amplitudo dikalibrasi dengan motion critic pada dua foto berbeda (detail
 * tinggi dan rendah) memakai rantai filter produksi penuh, 1080x1920, 5 detik:
 *
 *   static (napas 0.05)   -> 0.06  (gagal, sesuai desain)
 *   slow_dolly_in         -> 0.40
 *   zoom_in / zoom_out    -> 0.37 / 0.42
 *   dolly_out             -> 0.47..0.52
 *   pan_left / pan_right  -> 0.63..0.76
 *   orbit_clockwise       -> 0.91..0.99
 *   crane_up              -> 1.00
 *
 * Nilai lama (zoom 0.26, drift 0.32) hanya mencapai ~0.20 pada metrik ini,
 * yaitu alasan shot hook terukur nyaris beku. Ruang gerak zoompan sebanding
 * dengan (1 - 1/zoom), jadi zoom dasar dinaikkan agar pan/orbit punya jarak
 * tempuh nyata.
 */
import type { CameraMove } from '../core/motion-prompt.ts';

export interface CameraMotion {
  /** Ekspresi `zoom` untuk zoompan. */
  z: string;
  x: string;
  y: string;
}

const EASE = (frames: number) => `(0.5-0.5*cos(PI*on/${Math.max(2, frames)}))`;

/** Panjang klip acuan saat amplitudo dikalibrasi (5 detik @ 30 fps). */
const REFERENCE_FRAMES = 150;

/**
 * `strength` (0.6..1.3 dari slider) menskalakan amplitudo. Nilai default
 * gerakan sudah di atas ambang critic dengan margin, sehingga kekuatan penuh
 * tetap aman dan kekuatan minimum masih lolos untuk gerakan besar.
 */
export function cameraMotion(move: CameraMove, frames: number, strength = 1): CameraMotion {
  const e = EASE(frames);
  // Kecepatan kamera dibuat konstan: amplitudo ikut panjang klip. Kalibrasi
  // dilakukan pada 150 frame (5 detik); klip 6.5 detik yang memakai amplitudo
  // sama menyebar gerakan ke 195 frame sehingga kecepatan per frame turun 23%
  // dan scene yang sama tiba-tiba gagal critic.
  const speed = Math.max(0.5, Math.min(2, frames / REFERENCE_FRAMES));
  const s = Math.max(0.3, Math.min(1.5, strength)) * speed;
  const zoomIn = (0.42 * s).toFixed(3);
  const drift = Math.min(1.2, 0.72 * s).toFixed(3);
  const halfDrift = Math.min(0.9, 0.36 * s).toFixed(3);

  switch (move) {
    case 'slow_dolly_in':
      return {
        z: `min(1+${zoomIn}*${e},1.60)`,
        x: `(iw-iw/zoom)*(0.86-${drift}*${e})`,
        y: `(ih-ih/zoom)*(0.66-${halfDrift}*${e})`,
      };
    case 'dolly_out':
      return {
        z: `max(1.60-${zoomIn}*${e},1.0)`,
        x: `(iw-iw/zoom)*(0.14+${drift}*${e})`,
        y: `(ih-ih/zoom)*(0.34+${halfDrift}*${e})`,
      };
    case 'pan_left':
      return {
        z: '1.55',
        x: `(iw-iw/zoom)*(1-${e})`,
        y: '(ih-ih/zoom)*0.5',
      };
    case 'pan_right':
      return {
        z: '1.55',
        x: `(iw-iw/zoom)*${e}`,
        y: '(ih-ih/zoom)*0.5',
      };
    case 'orbit_clockwise':
      return {
        z: `min(1.30+0.30*${e},1.60)`,
        x: `(iw-iw/zoom)*(0.5+0.46*sin(on/${Math.max(2, frames)}*PI))`,
        y: `(ih-ih/zoom)*(0.5+0.34*cos(on/${Math.max(2, frames)}*PI))`,
      };
    case 'crane_up':
      return {
        z: `min(1.24+0.36*${e},1.60)`,
        x: `(iw-iw/zoom)*(0.5+0.30*${e})`,
        y: `(ih-ih/zoom)*(1-${e})`,
      };
    case 'zoom_in':
      return {
        z: `min(1+0.55*${e},1.60)`,
        x: `(iw-iw/zoom)*(0.80-0.34*${e})`,
        y: `(ih-ih/zoom)*(0.66-0.26*${e})`,
      };
    case 'zoom_out':
      return {
        z: `max(1.55-0.55*${e},1.0)`,
        x: `(iw-iw/zoom)*(0.46+0.34*${e})`,
        y: `(ih-ih/zoom)*(0.40+0.26*${e})`,
      };
    case 'static':
    default:
      // Bahkan "static" butuh napas halus; klip yang benar-benar diam ditolak
      // critic, dan itu memang tujuannya — gunakan hanya untuk end card.
      return {
        z: `min(1+0.05*${e},1.05)`,
        x: '(iw-iw/zoom)*0.5',
        y: '(ih-ih/zoom)*0.5',
      };
  }
}

export function cameraFilterFor(
  move: CameraMove,
  frames: number,
  width: number,
  height: number,
  fps: number,
  strength = 1,
): string {
  const total = Math.max(2, frames);
  const m = cameraMotion(move, total, strength);
  return `zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=${total}:s=${width}x${height}:fps=${fps}`;
}
