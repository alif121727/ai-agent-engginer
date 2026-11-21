import { loadThemes } from './config.ts';
import { pickTheme } from './theme.ts';
import { findTemplate, type Template } from './templates.ts';
import type { Brief, Theme } from './types.ts';

/**
 * Satu pintu masuk untuk "tema apa dan scene apa" pada satu brief.
 *
 * Sebelum ini, `planScenes()` dipanggil dari empat tempat berbeda dan setiap
 * tempat memilih tema sendiri lewat `pickTheme()`. Akibatnya template yang
 * dipilih pengguna hanya dihormati di satu jalur, sementara worker tetap
 * memakai alur bawaan. Semua jalur sekarang lewat sini.
 */
export type BriefLook = {
  theme: Theme;
  template: Template | undefined;
  aspect: '9:16' | '16:9' | '1:1';
};

/** Tema AI disimpan di brief; hanya field yang dikenal Theme yang dipakai. */
function themeFromBrief(brief: Brief, fallback: Theme): Theme {
  const ai = brief.temaAi;
  if (!ai?.id) return fallback;
  return {
    id: ai.id,
    keywords: ai.keywords ?? fallback.keywords,
    palette: ai.palette ?? fallback.palette,
    mood: ai.mood ?? fallback.mood,
    grade: ai.grade ?? fallback.grade,
    cameraLanguage: ai.cameraLanguage ?? fallback.cameraLanguage,
    lighting: ai.lighting ?? fallback.lighting,
    descriptor: ai.descriptor ?? fallback.descriptor,
  };
}

export function resolveBriefLook(brief: Brief): BriefLook {
  const themes = loadThemes();
  const template = brief.templateId ? findTemplate(brief.templateId) : undefined;
  const base = pickTheme(brief.model, themes.themes, themes.defaultTheme);
  const theme = themeFromBrief(brief, base);
  // Rasio eksplisit di brief selalu menang; template hanya jadi default.
  const aspect = brief.rasio ?? template?.aspect ?? '16:9';
  return { theme, template, aspect };
}
