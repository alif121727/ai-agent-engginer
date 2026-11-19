import path from 'node:path';
import { paths, readJson, writeJsonAtomic } from '../core/fsx.ts';

export interface LlmCapability {
  model: string;
  baseUrl: string;
  supportsImages: boolean;
  supportsJsonMode: boolean;
  checkedAt: string;
  note?: string;
}

export const LLM_CONFIG_FILE = path.join(paths.config, 'llm.json');

export function loadCapability(): LlmCapability {
  return readJson<LlmCapability>(LLM_CONFIG_FILE, {
    model: process.env.LLM_MODEL ?? 'unknown',
    baseUrl: process.env.LLM_BASE_URL ?? '',
    supportsImages: false,
    supportsJsonMode: false,
    checkedAt: '',
    note: 'belum diuji',
  });
}

export function saveCapability(cap: LlmCapability): void {
  writeJsonAtomic(LLM_CONFIG_FILE, cap);
}

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

/**
 * Sends one tiny image and records whether the model accepted it. QA visual
 * review only runs when this flag is true, so we never claim a visual was
 * reviewed by a model that cannot see images.
 */
export async function probeLlmCapability(): Promise<LlmCapability> {
  const model = process.env.LLM_MODEL ?? '';
  const baseUrl = (process.env.LLM_BASE_URL ?? '').replace(/\/$/, '');
  const apiKey = process.env.LLM_API_KEY ?? '';
  const base: LlmCapability = {
    model,
    baseUrl,
    supportsImages: false,
    supportsJsonMode: false,
    checkedAt: new Date().toISOString(),
  };
  if (!baseUrl || !apiKey) {
    return { ...base, note: 'LLM_BASE_URL/LLM_API_KEY tidak diset, pemeriksaan dilewati' };
  }
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 8,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Balas satu kata: ok' },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${TINY_PNG_BASE64}` } },
            ],
          },
        ],
      }),
    });
    base.supportsImages = res.ok;
    if (!res.ok) base.note = `HTTP ${res.status} saat mengirim gambar`;
    return base;
  } catch (err) {
    return { ...base, note: err instanceof Error ? err.message : String(err) };
  }
}
