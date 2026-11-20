// Jembatan tipis ke pembuat prompt bersama (src/core/prompts.ts).
// Prompt sengaja TIDAK diduplikasi di studio: kalau logikanya disalin, prompt
// di UI bisa menyebut mesin yang berbeda dari yang dipakai pipeline render.
import {
  engineSfxPrompts,
  videoScenePrompts,
  videoQaPrompt,
  engineSummary,
  AUDIO_NEGATIVE,
  VIDEO_NEGATIVE,
  VIDEO_STYLE_TAG,
  COMBINED_NEGATIVE,
  type CarPromptInput,
  type EngineSfx,
  type VideoScene,
} from '../../../src/core/prompts.ts';
import type { Car } from '../data/catalog.ts';

export type { EngineSfx, VideoScene, CarPromptInput };
export { AUDIO_NEGATIVE, VIDEO_NEGATIVE, VIDEO_STYLE_TAG, COMBINED_NEGATIVE, engineSummary };

export function toPromptInput(car: Car): CarPromptInput {
  return {
    model: car.model,
    merk: car.merk,
    mesin: car.mesin,
    tenaga: car.tenaga,
    torsi: car.torsi,
    kategori: car.kategori,
    tahun: car.tahun,
    nol100: car.nol100,
    vmax: car.vmax,
  };
}

export function sfxFor(car: Car): EngineSfx[] {
  return engineSfxPrompts(toPromptInput(car));
}

export function scenesFor(car: Car, vertical = false): VideoScene[] {
  return videoScenePrompts(toPromptInput(car), { vertical });
}

export function qaPromptFor(car: Car): string {
  return videoQaPrompt(toPromptInput(car));
}
