export type JobStatus =
  | 'queued'
  | 'running'
  | 'paused_offline'
  | 'awaiting_cost_approval'
  | 'awaiting_review'
  | 'done'
  | 'failed'
  | 'cancelled';

export type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export type ConnectionStatus = 'ONLINE' | 'PAUSED_OFFLINE';

export type AgentKind = 'orchestrator' | 'worker' | 'reviewer';

export interface AgentDef {
  id: string;
  name: string;
  short: string;
  role: string;
  kind: AgentKind;
  systemPrompt: string;
  allowedTools: string[];
  artifacts: { writes: string[]; reads: string[] };
  maxRetries: number;
}

export interface AgentsConfig {
  presets: Record<string, string[]>;
  defaultPreset: string;
  agents: Record<string, AgentDef>;
}

export interface Brief {
  model: string;
  tagline?: string;
  durasi?: number;
  rasio?: '16:9' | '9:16' | '1:1';
  keunggulan?: string[];
  gaya?: string;
  referensi?: string[];
  jadwalPublish?: string;
  deadlineMenit?: number;
  /** Template yang dipilih pengguna; menentukan resep scene. */
  templateId?: string;
  /** Tema buatan AI; mengalahkan tema kata kunci bawaan. */
  temaAi?: Partial<Theme>;
}

export interface ScenePlan {
  index: number;
  key: string;
  label: string;
  start: number;
  duration: number;
  shot: string;
  camera: string;
  lens: string;
  lighting: string;
  location: string;
  prompt: string;
  negativePrompt: string;
  onScreenText: string;
  voiceover: string;
}

export interface AssetRecord {
  sceneIndex: number;
  kind: 'image' | 'video' | 'fallback';
  path: string;
  source: string;
  provider: string;
  credit?: string;
  fallback?: boolean;
}

export interface Theme {
  id: string;
  keywords: string[];
  palette: { primary: string; secondary: string; accent: string };
  mood: string;
  grade: { contrast: number; saturation: number; temperature: number };
  cameraLanguage: string;
  lighting: string;
  descriptor: string;
}
