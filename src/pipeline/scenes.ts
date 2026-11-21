import type { Brief, ScenePlan, Theme } from '../core/types.ts';
import {
  DEFAULT_NEGATIVES,
  toPromptString,
  type CameraMove,
  type MotionPrompt,
} from '../core/motion-prompt.ts';

interface SceneSpec {
  key: string;
  label: string;
  shot: string;
  camera: string;
  lens: string;
  weight: number;
  /** Gerakan kamera untuk I2V. Satu per klip — lihat aturan di motion-prompt.ts. */
  move: CameraMove;
  /** Aksi subjek konkret; bukan deskripsi ulang gambar. */
  action: string;
  /** Gerakan ambient halus. */
  ambient: string;
}

const BASE_SCENES: SceneSpec[] = [
  {
    key: 'hook',
    label: 'Hook',
    shot: 'extreme close-up lampu depan, grill, dan velg',
    camera: 'static dengan dorongan pelan',
    lens: '85mm',
    weight: 1,
    move: 'slow_dolly_in',
    action: 'headlight glass catches a slow sweep of light as the lens eases closer',
    ambient: 'dust motes drift through the beam, reflections crawl across the paint',
  },
  {
    key: 'exterior',
    label: 'Eksterior',
    shot: 'full body tiga perempat depan',
    camera: 'orbit lambat mengelilingi mobil',
    lens: '35mm',
    weight: 1.2,
    move: 'orbit_clockwise',
    action: 'the bodywork slides past as the viewpoint travels around the car',
    ambient: 'wet ground mirrors the body, thin clouds move behind',
  },
  {
    key: 'features',
    label: 'Fitur & spesifikasi',
    shot: 'detail bodi, ventilasi, dan badge',
    camera: 'slider horizontal dengan fokus rakitan',
    lens: '50mm',
    weight: 1.1,
    move: 'pan_right',
    action: 'the surface detail travels across frame, edges catching the key light',
    ambient: 'fine dust settles slowly, reflections shift along the panel gaps',
  },
  {
    key: 'interior',
    label: 'Interior & detail',
    shot: 'kabin dari pintu pengemudi, jok, setir',
    camera: 'dolly masuk perlahan',
    lens: '35mm',
    weight: 1,
    move: 'crane_up',
    action: 'the cabin rises into view as the lens lifts over the wheel',
    ambient: 'soft daylight breathes through the windows, stitching glints',
  },
  {
    key: 'action',
    label: 'Aksi & performa',
    shot: 'mobil melaju di jalan dengan motion blur',
    camera: 'tracking rendah, speed ramp',
    lens: '35mm',
    weight: 1.3,
    move: 'zoom_in',
    action: 'the car surges forward, road surface streaking beneath it',
    ambient: 'heat shimmer trails the body, roadside light flares past',
  },
  {
    key: 'cta',
    label: 'CTA / end card',
    shot: 'mobil berhenti, lampu menyala, ruang untuk teks',
    camera: 'static dengan parallax halus',
    lens: '50mm',
    weight: 0.9,
    move: 'dolly_out',
    action: 'the car settles and the frame eases back to leave room for text',
    ambient: 'indicator glow pulses gently, floor reflection softens',
  },
];

const EXTRA_SCENES: SceneSpec[] = [
  {
    key: 'detail_wheel',
    label: 'Detail velg & rem',
    shot: 'close-up velg forged dan kaliper rem',
    camera: 'pan melingkar pendek',
    lens: '85mm',
    weight: 1,
    move: 'pan_left',
    action: 'spokes slide past the lens, brake disc glinting between them',
    ambient: 'brake dust drifts, highlights travel around the rim',
  },
  {
    key: 'detail_engine',
    label: 'Mesin',
    shot: 'ruang mesin dan kap mesin terbuka',
    camera: 'tilt naik lambat',
    lens: '50mm',
    weight: 1,
    move: 'crane_up',
    action: 'the engine bay reveals itself as the camera lifts',
    ambient: 'faint heat haze rises from the block',
  },
  {
    key: 'night',
    label: 'Malam kota',
    shot: 'mobil di jalan basah dengan refleksi lampu kota',
    camera: 'orbit rendah',
    lens: '35mm',
    weight: 1.2,
    move: 'orbit_clockwise',
    action: 'the silhouette turns slowly against the city glow',
    ambient: 'neon reflections ripple on wet asphalt, distant traffic blurs past',
  },
  {
    key: 'lifestyle',
    label: 'Gaya hidup',
    shot: 'pengemudi bersiap, tangan di setir, tanpa wajah jelas',
    camera: 'handheld halus',
    lens: '50mm',
    weight: 1,
    move: 'slow_dolly_in',
    action: 'a hand settles on the wheel and tightens slightly',
    ambient: 'cabin light shifts, fabric creases as weight settles',
  },
];

export const NEGATIVE_PROMPT = [
  'teks',
  'watermark',
  'logo',
  'plat nomor terbaca',
  'wajah jelas',
  'roda cacat',
  'velg tidak simetris',
  'lampu tidak simetris',
  'proporsi aneh',
  'kartun',
  'ilustrasi',
  'render 3d polos',
  'mobil fiktif',
  // These are the specific artefacts that make a generated car look like a toy.
  'lukisan digital',
  'warna terlalu jenuh',
  'kulit plastik',
  'permukaan berminyak',
  'blur berlebih',
  'distorsi perspektif',
  'roda mengambang',
  'bayangan ganda',
  'badan mobil bengkok',
  'teks melayang',
].join(', ');

export function buildSceneList(durationSec: number, keys?: string[]): SceneSpec[] {
  if (keys?.length) {
    // Template menentukan resepnya. Kunci yang tidak dikenal dibuang supaya
    // template hasil AI yang salah ketik tidak merusak render.
    const chosen = keys
      .map((k) => BASE_SCENES.find((s) => s.key === k) ?? EXTRA_SCENES.find((s) => s.key === k))
      .filter((s): s is SceneSpec => Boolean(s));
    if (chosen.length) {
      const scenes = [...chosen];
      // Video panjang tetap butuh isi: ulangi resep dengan kunci unik supaya
      // setiap scene punya aset sendiri.
      let round = 1;
      while (scenes.length < Math.max(4, Math.floor(durationSec / 6)) && round < 6) {
        for (const s of chosen) {
          if (scenes.length >= Math.max(4, Math.floor(durationSec / 6))) break;
          scenes.splice(scenes.length - 1, 0, { ...s, key: `${s.key}_r${round}`, label: `${s.label} ${round + 1}` });
        }
        round++;
      }
      return scenes;
    }
  }
  const scenes = [...BASE_SCENES];
  // One extra scene per ~10s above the 30s baseline. Beyond the hand-written
  // extras the list cycles with distinct keys, so long videos stay dynamic.
  const extraCount = Math.max(0, Math.min(14, Math.floor((durationSec - 30) / 10)));
  for (let i = 0; i < extraCount; i++) {
    const template = EXTRA_SCENES[i % EXTRA_SCENES.length];
    const round = Math.floor(i / EXTRA_SCENES.length);
    const spec: SceneSpec =
      round === 0
        ? template
        : { ...template, key: `${template.key}_${round + 1}`, label: `${template.label} ${round + 1}` };
    scenes.splice(scenes.length - 1, 0, spec);
  }
  return scenes;
}

export function planScenes(input: {
  brief: Brief;
  durationSec: number;
  theme: Theme;
  aspect: string;
  /** Resep scene dari template; kosong berarti alur bawaan. */
  sceneKeys?: string[];
  /** Batas durasi per klip dari kebijakan gerak; default 6 detik. */
  maxClipSeconds?: number;
  /** Kekuatan gerakan 1-10 dari UI; memetakan ke amplitudo kamera. */
  motionIntensity?: number;
}): ScenePlan[] {
  // Durasi NaN/infinite membuat perhitungan sisa durasi tak pernah mencapai 0,
  // sehingga loop di bawah berputar selamanya. Nilai tak sah dijepit ke minimum
  // kontrak video, bukan dibiarkan menggantung.
  const durationSec = Number.isFinite(input.durationSec) && input.durationSec > 0
    ? Math.round(input.durationSec)
    : 30;
  const specs = buildSceneList(durationSec, input.sceneKeys);
  const totalWeight = specs.reduce((sum, s) => sum + s.weight, 0);

  // Distribute duration by weight, then give the rounding remainder to the
  // longest scenes so the sum equals the requested duration exactly.
  const durations = specs.map((spec) => Math.max(2, Math.round((spec.weight / totalWeight) * durationSec)));
  let diff = durationSec - durations.reduce((a, b) => a + b, 0);
  while (diff !== 0) {
    const order = durations
      .map((d, i) => ({ i, d }))
      .sort((a, b) => (diff > 0 ? b.d - a.d : a.d - b.d));
    for (const { i } of order) {
      if (diff === 0) break;
      if (diff < 0 && durations[i] <= 2) continue;
      durations[i] += diff > 0 ? 1 : -1;
      diff += diff > 0 ? -1 : 1;
    }
    if (order.every(({ i }) => durations[i] <= 2)) break;
  }

  const advantages = input.brief.keunggulan ?? [];
  const maxClip = input.maxClipSeconds ?? 6;
  const intensity = Math.max(1, Math.min(10, input.motionIntensity ?? 5));
  // Nilai tengah slider (5) HARUS 1.0, yaitu amplitudo yang sudah dikalibrasi
  // lolos critic. Pemetaan linear 1..10 ke 0.6..1.3 membuat nilai tengah 0.91,
  // dan itu cukup menurunkan dolly/zoom di bawah ambang.
  const strength = Math.round(
    (intensity <= 5 ? 0.7 + ((intensity - 1) / 4) * 0.3 : 1 + ((intensity - 5) / 5) * 0.3) * 100,
  ) / 100;

  let start = 0;
  return specs.map((spec, index) => {
    const duration = durations[index];
    const motionPrompt: MotionPrompt = {
      subject_action: spec.action,
      camera_move: spec.move,
      environmental_effects: spec.ambient,
      negative_constraints: DEFAULT_NEGATIVES,
      // Klip panjang dipecah oleh renderer; nilai di sini sudah dijepit agar
      // tidak ada prompt yang meminta gerakan lebih lama dari batas kebijakan.
      duration_seconds: Math.max(3, Math.min(maxClip, duration)),
    };
    const scene: ScenePlan = {
      index,
      key: spec.key,
      label: spec.label,
      start: Math.round(start * 10) / 10,
      duration,
      shot: spec.shot,
      camera: spec.camera,
      lens: spec.lens,
      lighting: input.theme.lighting,
      location: locationFor(spec.key, input.theme),
      prompt: buildPrompt({
        theme: input.theme,
        model: input.brief.model,
        shot: spec.shot,
        camera: spec.camera,
        lens: spec.lens,
        aspect: input.aspect,
        mood: input.brief.gaya ?? input.theme.mood,
        location: locationFor(spec.key, input.theme),
        angle: COMPOSITION[baseKey(spec.key)] ?? 'three-quarter front',
        variant: index,
      }),
      negativePrompt: NEGATIVE_PROMPT,
      onScreenText: onScreenTextFor(baseKey(spec.key), input.brief, advantages),
      voiceover: '',
      motionPrompt,
      motionStrength: strength,
    };
    start += duration;
    return scene;
  });
}

/** Kunci template yang diulang diberi akhiran `_r1`, `_r2`; ini aslinya. */
function baseKey(key: string): string {
  return key.replace(/_r\d+$/, '');
}

function locationFor(rawKey: string, theme: Theme): string {
  const key = baseKey(rawKey);
  switch (key) {
    case 'interior':
    case 'lifestyle':
      return 'kabin mobil';
    case 'night':
      return 'jalan kota basah saat malam';
    case 'action':
      return 'jalan aspal terbuka';
    case 'detail_engine':
      return 'garasi studio gelap';
    default:
      return theme.id === 'porsche' ? 'studio terang' : 'studio gelap dengan lampu aksen';
  }
}

/**
 * Generated stills share the same subject, so without an explicit per-scene
 * angle and location the images collapse into near-duplicates and the
 * similarity gate rejects them. Each key gets a distinct camera position.
 */
const COMPOSITION: Record<string, string> = {
  hook: 'extreme low angle, dramatic silhouette, wet asphalt reflection',
  exterior: 'three-quarter front, full body in frame, wide environment',
  features: 'side profile, badge and trim in focus, shallow background',
  interior: 'cockpit view from passenger seat, dashboard and wheel in focus',
  action: 'rear three-quarter, motion blur background, low tracking angle',
  detail_wheel: 'macro close-up of forged wheel and brake caliper',
  detail_engine: 'top-down engine bay, open hood, mechanical detail',
  night: 'night street, neon reflections, long exposure light trails',
  lifestyle: 'driver hand on wheel, blurred cabin background, no visible face',
  cta: 'hero front view, centred, studio backdrop, clean floor reflection',
};

function buildPrompt(input: {
  theme: Theme;
  model: string;
  shot: string;
  camera: string;
  lens: string;
  aspect: string;
  mood: string;
  location: string;
  angle: string;
  variant: number;
}): string {
  return [
    `fotografi otomotif realistis dari ${input.theme.descriptor}`,
    `model: ${input.model}`,
    `lokasi: ${input.location}`,
    `jenis shot: ${input.shot}`,
    `komposisi: ${input.angle}`,
    `kamera: ${input.camera}, lensa ${input.lens}`,
    `pencahayaan: ${input.theme.lighting}`,
    `suasana: ${input.mood}`,
    'depth of field dangkal, pantulan cat mengilap, material realistis, detail velg tajam',
    // Concrete photographic cues pull generators away from the plastic,
    // over-saturated look; naming the medium works better than "realistic".
    'difoto dengan kamera full frame, lensa prime, f/1.8, ISO 100, RAW tanpa filter',
    'cahaya alami dengan bayangan lembut, refleksi lingkungan pada bodi',
    'tekstur cat metalik, jahitan interior terlihat, karet ban berdebu halus',
    'foto jurnalistik otomotif, warna akurat, tidak ada teks, tidak ada watermark',
    'tidak ada logo merek, tidak ada tulisan pada bodi',
  ].join(', ');
}

/**
 * Prompt untuk image-to-video. Gambar referensi SUDAH mendefinisikan subjek,
 * warna, dan latar; mengulanginya di sini membuat model meniru foto alih-alih
 * menggerakkannya, dan gerakan melemah. Jadi isinya hanya gerakan.
 */
export function i2vPrompt(scene: ScenePlan): string {
  if (scene.motionPrompt) return toPromptString(scene.motionPrompt);
  return `${scene.camera}, smooth fluid motion at moderate speed`;
}

/** Prompt untuk text-to-image (keyframe). Di sini deskripsi subjek justru wajib. */
export function t2iPrompt(scene: ScenePlan): string {
  return scene.prompt;
}

/**
 * Captions must stay short enough to read in two seconds, so long spec lines
 * are cut at the first separator rather than wrapped.
 */
function shorten(text: string, max = 42): string {
  const clean = text.split(/·|\(/)[0].trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).trimEnd() + '…';
}

function onScreenTextFor(key: string, brief: Brief, advantages: string[]): string {
  const tagline = brief.tagline?.trim();
  switch (key) {
    case 'hook':
      return tagline ? shorten(tagline, 46) : brief.model;
    case 'exterior':
      return brief.model;
    case 'features':
      return advantages[0] ? shorten(advantages[0]) : '';
    case 'detail_engine':
      return advantages[0] ? shorten(advantages[0]) : '';
    case 'interior':
      return advantages[1] ? shorten(advantages[1]) : '';
    case 'action':
      return advantages[2] ? shorten(advantages[2]) : '';
    case 'cta':
      return brief.model;
    default:
      return '';
  }
}

export function estimateCost(input: {
  durationSec: number;
  sceneCount: number;
  withVideo: boolean;
  estimates: { perSceneImage: number; perSceneVideo: number; perSecondRender: number; perSecondSpeech: number };
}): number {
  const image = input.sceneCount * input.estimates.perSceneImage;
  const video = input.withVideo ? input.sceneCount * input.estimates.perSceneVideo : 0;
  const render = input.durationSec * input.estimates.perSecondRender;
  const speech = input.durationSec * input.estimates.perSecondSpeech;
  return Math.round((image + video + render + speech) * 100) / 100;
}
