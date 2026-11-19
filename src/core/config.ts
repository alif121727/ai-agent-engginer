import path from 'node:path';
import { paths, readJson } from './fsx.ts';
import type { AgentsConfig, Theme } from './types.ts';

export interface Defaults {
  minDurasi: number;
  maxDurasi: number;
  workTime: { mode: 'real' | 'fixed'; total: number; perRole: number };
  agentPreset: string;
  visualAdapters: string[];
  connection: {
    probeIntervalMs: number;
    probeTimeoutMs: number;
    failuresToOffline: number;
    successesToOnline: number;
    probeUrls: string[];
    pauseLocalRendering: boolean;
    pauseWhenNoViewer: boolean;
  };
  cost: {
    maxCostPerJob: number;
    maxCostPerHari: number;
    currency: string;
    estimates: {
      perSceneImage: number;
      perSceneVideo: number;
      perSecondRender: number;
      perSecondSpeech: number;
    };
  };
  quality: {
    minWidth: number;
    minHeight: number;
    minSharpness: number;
    maxRegenerations: number;
    sceneHashDistance: number;
    forbidTextInImage: boolean;
  };
  publish: {
    timezone: string;
    lateToleranceMenit: number;
    dryRun: boolean;
    maxRetries: number;
  };
  render: { width: number; height: number; fps: number; crf: number; preset: string; loudnessLufs: number };
}

export interface VisualAdapterDef {
  id: string;
  label: string;
  kind: 'local' | 'video-gen' | 'image-gen' | 'stock-api';
  enabled: boolean;
  requiresKey: boolean;
  envKey?: string;
  model?: string;
  creditsFile?: string;
  description?: string;
}

export function loadDefaults(): Defaults {
  return readJson<Defaults>(path.join(paths.config, 'defaults.json'), {} as Defaults);
}

export function loadAgents(): AgentsConfig {
  return readJson<AgentsConfig>(path.join(paths.config, 'agents.json'), {
    presets: {},
    defaultPreset: '9-orang',
    agents: {},
  });
}

export function loadAdapters(): { adapters: Record<string, VisualAdapterDef> } {
  return readJson(path.join(paths.config, 'visuals.json'), { adapters: {} });
}

export const THEMES_FILE = 'templates/otomotif/themes.json';

export function loadThemes(): { defaultTheme: string; themes: Record<string, Theme> } {
  return readJson(path.join(paths.root, THEMES_FILE), { defaultTheme: 'generic', themes: {} });
}

export function adapterOrder(defaults: Defaults, overrides?: string[]): string[] {
  return overrides?.length ? overrides : defaults.visualAdapters;
}

export function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

export function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
