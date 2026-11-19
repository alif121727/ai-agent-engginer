import type { Brief, ScenePlan, Theme } from '../core/types.ts';

interface SceneSpec {
  key: string;
  label: string;
  shot: string;
  camera: string;
  lens: string;
  weight: number;
}

const BASE_SCENES: SceneSpec[] = [
  {
    key: 'hook',
    label: 'Hook',
    shot: 'extreme close-up lampu depan, grill, dan velg',
    camera: 'static dengan dorongan pelan',
    lens: '85mm',
    weight: 1,
  },
  {
    key: 'exterior',
    label: 'Eksterior',
    shot: 'full body tiga perempat depan',
    camera: 'orbit lambat mengelilingi mobil',
    lens: '35mm',
    weight: 1.2,
  },
  {
    key: 'features',
    label: 'Fitur & spesifikasi',
    shot: 'detail bodi, ventilasi, dan badge',
    camera: 'slider horizontal dengan fokus rakitan',
    lens: '50mm',
    weight: 1.1,
  },
  {
    key: 'interior',
    label: 'Interior & detail',
    shot: 'kabin dari pintu pengemudi, jok, setir',
    camera: 'dolly masuk perlahan',
    lens: '35mm',
    weight: 1,
  },
  {
    key: 'action',
    label: 'Aksi & performa',
    shot: 'mobil melaju di jalan dengan motion blur',
    camera: 'tracking rendah, speed ramp',
    lens: '35mm',
    weight: 1.3,
  },
  {
    key: 'cta',
    label: 'CTA / end card',
    shot: 'mobil berhenti, lampu menyala, ruang untuk teks',
    camera: 'static dengan parallax halus',
    lens: '50mm',
    weight: 0.9,
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
  },
  {
    key: 'detail_engine',
    label: 'Mesin',
    shot: 'ruang mesin dan kap mesin terbuka',
    camera: 'tilt naik lambat',
    lens: '50mm',
    weight: 1,
  },
  {
    key: 'night',
    label: 'Malam kota',
    shot: 'mobil di jalan basah dengan refleksi lampu kota',
    camera: 'orbit rendah',
    lens: '35mm',
    weight: 1.2,
  },
  {
    key: 'lifestyle',
    label: 'Gaya hidup',
    shot: 'pengemudi bersiap, tangan di setir, tanpa wajah jelas',
    camera: 'handheld halus',
    lens: '50mm',
    weight: 1,
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
].join(', ');

export function buildSceneList(durationSec: number): SceneSpec[] {
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
}): ScenePlan[] {
  const specs = buildSceneList(input.durationSec);
  const totalWeight = specs.reduce((sum, s) => sum + s.weight, 0);

  // Distribute duration by weight, then give the rounding remainder to the
  // longest scenes so the sum equals the requested duration exactly.
  const durations = specs.map((spec) => Math.max(2, Math.round((spec.weight / totalWeight) * input.durationSec)));
  let diff = input.durationSec - durations.reduce((a, b) => a + b, 0);
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
  let start = 0;
  return specs.map((spec, index) => {
    const duration = durations[index];
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
      }),
      negativePrompt: NEGATIVE_PROMPT,
      onScreenText: onScreenTextFor(spec.key, input.brief, advantages),
      voiceover: '',
    };
    start += duration;
    return scene;
  });
}

function locationFor(key: string, theme: Theme): string {
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

function buildPrompt(input: {
  theme: Theme;
  model: string;
  shot: string;
  camera: string;
  lens: string;
  aspect: string;
  mood: string;
}): string {
  return [
    `fotografi otomotif realistis dari ${input.theme.descriptor}`,
    `model: ${input.model}`,
    `jenis shot: ${input.shot}`,
    `kamera: ${input.camera}, lensa ${input.lens}`,
    `pencahayaan: ${input.theme.lighting}`,
    `suasana: ${input.mood}`,
    'depth of field dangkal, pantulan cat mengilap, material realistis, detail velg tajam',
    'foto jurnalistik otomotif, sensor full frame, warna akurat, tidak ada teks',
  ].join(', ');
}

function onScreenTextFor(key: string, brief: Brief, advantages: string[]): string {
  const tagline = brief.tagline?.trim();
  switch (key) {
    case 'hook':
      return tagline || brief.model;
    case 'exterior':
      return brief.model;
    case 'features':
      return advantages[0] ?? '';
    case 'interior':
      return advantages[1] ?? '';
    case 'action':
      return advantages[2] ?? '';
    case 'cta':
      return tagline ? `${brief.model} — ${tagline}` : brief.model;
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
