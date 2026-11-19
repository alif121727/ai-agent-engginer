import type { Theme } from './types.ts';

export function normalize(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Longest matching keyword wins so "nissan gt-r" beats a bare "gt" style match
 * and "296 gtb" does not fall through to the generic theme.
 */
export function pickTheme(model: string, themes: Record<string, Theme>, defaultTheme: string): Theme {
  const haystack = normalize(model);
  let best: { theme: Theme; length: number } | null = null;
  for (const theme of Object.values(themes)) {
    for (const keyword of theme.keywords) {
      const needle = normalize(keyword);
      if (!needle) continue;
      if (haystack.includes(needle) && (!best || needle.length > best.length)) {
        best = { theme, length: needle.length };
      }
    }
  }
  return best?.theme ?? themes[defaultTheme] ?? Object.values(themes)[0];
}
