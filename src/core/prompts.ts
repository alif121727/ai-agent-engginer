/**
 * Prompt produksi untuk generator eksternal (SFX: ElevenLabs/Stable Audio,
 * video: Veo/Kling/Seedance). Semua kalimat dibangun dari data katalog nyata —
 * tata letak mesin, aspirasi, tenaga, akselerasi — jadi tidak ada angka atau
 * detail yang dikarang. Prompt ditulis bahasa Inggris karena model audio/video
 * memberi hasil jauh lebih akurat dengan prompt berbahasa Inggris.
 *
 * Modul ini murni (tanpa Node/DOM) supaya bisa dipakai backend dan studio.
 */

import { parseEngine, type EngineSpec } from './engine-spec.ts';

export type CarPromptInput = {
  model: string;
  merk: string;
  mesin: string;
  tenaga?: string;
  torsi?: string;
  kategori?: string;
  tahun?: string;
  nol100?: string;
  vmax?: string;
};

/* --------------------------------------------------------------- kosakata */

const LAYOUT_WORDS: Record<string, string> = {
  V8: 'V8',
  V10: 'V10',
  V12: 'V12',
  V6: 'V6',
  I6: 'inline-six',
  I4: 'inline-four',
  'flat-6': 'flat-six',
  'flat-4': 'flat-four',
  rotary: 'rotary',
  electric: 'electric motor',
};

const CYL_WORDS: Record<number, string> = {
  2: 'two-cylinder',
  4: 'four-cylinder',
  6: 'six-cylinder',
  8: 'eight-cylinder',
  10: 'ten-cylinder',
  12: 'twelve-cylinder',
};

function engineNoun(spec: EngineSpec): string {
  if (spec.electric) return 'electric motor';
  const layout = LAYOUT_WORDS[spec.layout] ?? `${spec.cylinders}-cylinder`;
  if (spec.rotary) return 'twin-rotor rotary engine';
  // "V8" sudah menyebut jumlah silinder; "flat-six" juga.
  return layout;
}

function aspirationWord(spec: EngineSpec): string {
  switch (spec.aspiration) {
    case 'twin-turbo':
      return 'twin-turbocharged';
    case 'turbo':
      return 'turbocharged';
    case 'supercharged':
      return 'supercharged';
    case 'electric':
      return '';
    default:
      return 'naturally aspirated';
  }
}

/**
 * Kode mesin di dalam tanda kurung, mis. "(RB26DETT)". Kubikasi seperti
 * "(4.7–6.4L)" juga ada dalam kurung tapi itu bukan kode mesin, jadi disaring.
 */
function engineCode(mesin: string): string {
  const m = mesin.match(/\(([^)]{2,20})\)/);
  if (!m) return '';
  const code = m[1].trim();
  return /^\d|cu in|\bL\b/i.test(code) ? '' : code;
}

/** Angka katalog memakai koma desimal dan "dtk"; prompt berbahasa Inggris butuh titik dan "s". */
function englishNumber(v?: string): string {
  return (v ?? '').replace(/(\d),(\d)/g, '$1.$2').replace(/\s*dtk\b/gi, ' s').trim();
}

/** Frasa audio untuk prompt QA; artikel "an" hanya untuk bunyi vokal. */
function qaAudioCue(spec: EngineSpec): string {
  if (spec.electric) return 'motor whine matching an electric drivetrain, absence of exhaust note';
  return `engine note matching a ${engineNoun(spec)}`;
}

function character(spec: EngineSpec, kategori: string): string {
  if (spec.electric) return 'smooth high-pitched';
  if (kategori === 'balap') return 'hard-edged race-spec';
  if (kategori === 'klasik') return 'warm classic analog';
  if (kategori === 'modifikasi') return 'tuned aftermarket';
  if (spec.layout === 'V12' || spec.layout === 'V10') return 'exotic high-strung';
  if (spec.layout === 'V8') return 'deep rumbling';
  if (spec.rotary) return 'high-revving buzzing rotary';
  return 'crisp modern';
}

/* ------------------------------------------------------------ SFX mesin */

export type EngineSfx = {
  id: 'start' | 'rev' | 'exhaust' | 'passby' | 'idle';
  label: string;
  /** Dipakai pipeline mana: scene yang cocok. */
  scene: string;
  prompt: string;
};

const SFX_QUALITY = 'high quality, studio recording, realistic, no music, no voice, dry signal';

/**
 * Lima efek suara mesin untuk satu mobil. Semuanya menyebut karakter mesin
 * yang sebenarnya supaya generator tidak menebak (mis. memberi V8 blower untuk
 * Supra inline-six turbo).
 */
export function engineSfxPrompts(car: CarPromptInput): EngineSfx[] {
  const spec = parseEngine({ mesin: car.mesin, tenaga: car.tenaga, kategori: car.kategori });
  const noun = engineNoun(spec);
  const asp = aspirationWord(spec);
  const code = engineCode(car.mesin);
  const who = [asp, noun].filter(Boolean).join(' ');
  const char = character(spec, car.kategori ?? '');
  const codeTag = code ? ` (${code})` : '';

  if (spec.electric) {
    return [
      {
        id: 'start',
        label: 'Menyala & idle',
        scene: 'Motor bay',
        prompt: `Electric car powering on, soft contactor click, inverter hum settling into idle, high-pitched electric motor whine, clean futuristic EV sound, ${car.model}, ${SFX_QUALITY}`,
      },
      {
        id: 'rev',
        label: 'Akselerasi',
        scene: 'Driving',
        prompt: `Futuristic electric car acceleration, rising high-pitched electric motor whine, sci-fi whoosh, smooth and clean sound design, ${car.model}, ${SFX_QUALITY}`,
      },
      {
        id: 'exhaust',
        label: 'Motor & ban',
        scene: 'Drivetrain',
        prompt: `Close-up of an electric drivetrain, faint motor whine and tyre roll on asphalt, no exhaust note, subtle regenerative whine, ${SFX_QUALITY}`,
      },
      {
        id: 'passby',
        label: 'Melintas',
        scene: 'Action',
        prompt: `Electric car passing by at speed, Doppler effect, aerodynamic whoosh, tyre roar on tarmac, no engine rumble, ${SFX_QUALITY}`,
      },
      {
        id: 'idle',
        label: 'Diam',
        scene: 'Interior',
        prompt: `Quiet electric car cabin at standstill, near-silent, faint battery cooling fan, premium EV silence, ${SFX_QUALITY}`,
      },
    ];
  }

  const forced = spec.forced;
  const turboCue = forced ? ', turbo spool and blow-off flutter, turbo whistle' : '';
  const crackle = car.kategori === 'balap' || car.kategori === 'modifikasi'
    ? ', exhaust crackle and pop on lift-off, backfire'
    : spec.layout === 'V8' || spec.layout === 'V12'
      ? ', subtle exhaust overrun crackle'
      : '';

  return [
    {
      id: 'start',
      label: 'Start & idle',
      scene: 'Engine bay',
      prompt:
        `Car engine ignition start, starter motor cranking, ${who} engine${codeTag} coming to life, ` +
        `settling into a ${char} idle at ${spec.idle} rpm, close-up microphone, ${SFX_QUALITY}`,
    },
    {
      id: 'rev',
      label: 'Rev & akselerasi',
      scene: 'Driving',
      prompt:
        `High-performance ${who} engine revving hard through the gears up to ${spec.redline} rpm, ` +
        `${char} exhaust note${turboCue}${crackle}, ${car.model}, ${SFX_QUALITY}`,
    },
    {
      id: 'exhaust',
      label: 'Knalpot dekat',
      scene: 'Detail',
      prompt:
        `Close-mic exhaust recording of a ${who} engine, ${char} tone, blipping the throttle, ` +
        `${forced ? 'wastegate flutter, ' : ''}tailpipe resonance, ${SFX_QUALITY}`,
    },
    {
      id: 'passby',
      label: 'Melintas (Doppler)',
      scene: 'Action',
      prompt:
        `${who} car passing by at high speed, Doppler effect, ${char} exhaust note sweeping past, ` +
        `${forced ? 'turbo spool, ' : ''}tyre noise on tarmac, realistic racing sound, ${SFX_QUALITY}`,
    },
    {
      id: 'idle',
      label: 'Idle kabin',
      scene: 'Interior',
      prompt:
        `Interior of a ${car.model}, engine idling at ${spec.idle} rpm, ${char} note muffled through the firewall, ` +
        `faint cabin ambience, ${SFX_QUALITY}`,
    },
  ];
}

/** Negative prompt audio — dipakai bareng semua SFX di atas. */
export const AUDIO_NEGATIVE =
  'music, melody, voice, speech, singing, robotic voice, clipping audio, background hiss, ' +
  'wind noise, distortion, cartoon sound, synthesized beeps, phone recording';

/* ------------------------------------------------------------ prompt video */

export const VIDEO_STYLE_TAG =
  '4K UHD, photorealistic, cinematic color grading, shot on Sony A7S III, 35mm lens, ' +
  'shallow depth of field, high dynamic range, realistic reflections and materials, ' +
  'natural lighting, stabilized gimbal, no text, no watermark';

export const VIDEO_NEGATIVE =
  'cartoon, anime, illustration, CGI look, low resolution, blurry, distorted car shape, ' +
  'warped badge, extra fingers, unrealistic physics, flickering, plastic skin, oversaturated, ' +
  'text artifacts, watermark, duplicate wheels, extra wheels, melted body panels';

export const VERTICAL_PREFIX =
  'Vertical 9:16 format, social media style, clean composition, presenter centered, fast engaging pacing';

export type VideoScene = {
  n: number;
  title: string;
  /** Detik aman untuk model video AI (5–10 dtk per klip). */
  dur: number;
  prompt: string;
};

/**
 * Delapan scene gaya review sinematik. Tiap scene menyebut mobil, mesin, dan
 * angka nyata dari katalog; detail yang tidak ada di katalog (warna cat)
 * sengaja tidak disebut daripada dikarang.
 */
export function videoScenePrompts(car: CarPromptInput, opts?: { vertical?: boolean }): VideoScene[] {
  const spec = parseEngine({ mesin: car.mesin, tenaga: car.tenaga, kategori: car.kategori });
  const noun = engineNoun(spec);
  const asp = aspirationWord(spec);
  const who = [asp, noun].filter(Boolean).join(' ');
  const name = car.model;
  const vertical = opts?.vertical ? `${VERTICAL_PREFIX}. ` : '';
  const style = ` + ${VIDEO_STYLE_TAG}`;
  // Nilai kosong di katalog diisi teks Indonesia ("tidak disebut di sumber");
  // teks itu tidak boleh bocor ke prompt berbahasa Inggris.
  const stated = (v?: string) => (v && !/tidak (disebut|tercatat)/i.test(v) ? englishNumber(v) : '');
  const power = stated(car.tenaga);
  const zeroTo = stated(car.nol100);
  const perf = [power, zeroTo ? `0–100 km/h in ${zeroTo}` : ''].filter(Boolean).join(' and ');
  const perfTag = perf ? `, ${perf}` : '';

  return [
    {
      n: 1,
      title: 'Opening / hook',
      dur: 7,
      prompt:
        `${vertical}Cinematic opening shot of a ${name} parked on a rooftop at golden hour, slow orbit around the front ` +
        `three-quarter angle, close-up of the badge and body lines, presenter walking into frame, smooth gimbal movement, ` +
        `warm sunset lighting, realistic paint reflections${style}`,
    },
    {
      n: 2,
      title: 'Eksterior walkaround',
      dur: 9,
      prompt:
        `${vertical}Exterior walkaround of a ${name}, camera tracking along the body from front to rear, close-ups of the ` +
        `grille, headlights, alloy wheels, brake calipers and rear spoiler, presenter gesturing at design details, ` +
        `natural daylight, realistic metallic paint reflections${style}`,
    },
    {
      n: 3,
      title: 'Detail makro',
      dur: 6,
      prompt:
        `${vertical}Macro detail shots of a ${name}: badge, ${spec.electric ? 'charge port' : 'exhaust tips'}, mirror caps, ` +
        `wheel spokes, side air vent, ` +
        `slow cinematic camera push-in, shallow depth of field, realistic material textures${style}`,
    },
    {
      n: 4,
      title: 'Interior',
      dur: 9,
      prompt:
        `${vertical}Car interior review of a ${name}, presenter in the driver seat demonstrating the infotainment screen ` +
        `and digital gauge cluster, slow pan across the sport seats, steering wheel and trim, ambient cabin lighting, ` +
        `realistic leather and alcantara textures, natural window light${style}`,
    },
    {
      n: 5,
      title: spec.electric ? 'Motor & power-on' : 'Ruang mesin & start',
      dur: 6,
      prompt: spec.electric
        ? `${vertical}Close-up of the ${name} electric drivetrain underbody, battery pack and motor housing${perfTag}, ` +
          `presenter pointing at high-voltage components, cut to the power button press and instrument cluster waking up, ` +
          `no engine sound, realistic mechanical detail${style}`
        : `${vertical}Close-up of the ${name} engine bay with the ${who} engine${perfTag}, presenter pointing at engine ` +
          `components, cut to the key turning and engine start-up, subtle engine vibration, realistic mechanical detail${style}`,
    },
    {
      n: 6,
      title: 'Driving review',
      dur: 11,
      prompt:
        `${vertical}Cinematic driving review of a ${name} on a winding coastal mountain road, dynamic tracking shots from ` +
        `exterior and interior POV, close-up of the steering wheel and dashboard, realistic motion blur, ` +
        `${spec.electric ? 'near-silent cabin, subtle motor whine' : 'engine vibration'}, ` +
        `golden hour lighting, smooth stabilized camera${style}`,
    },
    {
      n: 7,
      title: 'Aksi & performa',
      dur: 6,
      prompt:
        `${vertical}${name} accelerating on an open highway, rear three-quarter tracking shot, ` +
        `${spec.electric ? 'no exhaust, silent launch' : 'exhaust tips in frame'}, ` +
        `slight tyre smoke on launch, realistic motion blur, dynamic camera movement, dusk lighting${style}`,
    },
    {
      n: 8,
      title: 'Penutup / verdict',
      dur: 7,
      prompt:
        `${vertical}Presenter standing beside a ${name} at sunset, talking to camera, slow dolly-out revealing the full car, ` +
        `warm cinematic lighting, calm confident framing, realistic skin tones and car reflections${style}`,
    },
  ];
}

/** Prompt penilai kualitas video (dipakai manual sebelum publikasi). */
export function videoQaPrompt(car: CarPromptInput): string {
  return (
    `You are a professional automotive video reviewer. Evaluate this ${car.model} review video on: ` +
    `1) visual quality (resolution, sharpness, noise, compression), ` +
    `2) realism (materials, reflections, skin tones, physics, AI artifacts), ` +
    `3) cinematography (camera, framing, lighting, depth of field), ` +
    `4) audio (${qaAudioCue(parseEngine({ mesin: car.mesin, kategori: car.kategori }))}, voice clarity, background), ` +
    `5) content (clarity of review, presenter delivery, coverage). ` +
    `Output a structured table with a score from 1 to 10 per criterion, the overall verdict, ` +
    `and concrete improvement suggestions. Flag any invented specification that is not verifiable.`
  );
}

/* -------------------------------------------------------------- negatif */

/** Negative prompt gabungan untuk video + audio realisme. */
export const COMBINED_NEGATIVE = `${VIDEO_NEGATIVE}, robotic voice, clipping audio, background hiss`;

/** Ringkas profil mesin untuk ditampilkan di UI. */
export function engineSummary(car: CarPromptInput): string {
  const spec = parseEngine({ mesin: car.mesin, tenaga: car.tenaga, kategori: car.kategori });
  if (spec.electric) return `motor listrik · hingga ${spec.redline} rpm ekuivalen`;
  const cyl = CYL_WORDS[spec.cylinders] ?? `${spec.cylinders} silinder`;
  return `${LAYOUT_WORDS[spec.layout] ?? spec.layout} · ${cyl} · ${aspirationWord(spec)} · redline ${spec.redline} rpm`;
}
