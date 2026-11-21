/**
 * Kebijakan gerak global — satu titik penegakan untuk semua job, lama maupun baru.
 *
 * Tanpa satu choke point, "pipeline gerakan" hanya jadi fitur opsional: job lama
 * tetap merender dengan prompt yang mendeskripsikan gambar, dan tidak ada yang
 * menolaknya. `assertPolicyApplied()` dipanggil tepat sebelum render, sehingga
 * tidak ada jalur kode yang menghasilkan video tanpa melewati kebijakan ini.
 */
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './fsx.ts';
import { CAMERA_MOVES, type CameraMove, type MotionPrompt } from './motion-prompt.ts';

export interface MotionPolicy {
  version: number;
  enforced: boolean;
  primaryProvider: string;
  fallbackProvider: string;
  draftProvider: string;
  pipeline: 'single_stage' | 'two_stage';
  maxClipSeconds: number;
  minClipSeconds: number;
  cameraMovesAllowed: CameraMove[];
  requireMotionCritic: boolean;
  /** Ambang untuk seluruh video. */
  minMotionScore: number;
  /** Ambang per klip; klip statis harus gagal walau total video lolos. */
  minSceneMotionScore: number;
  backfill: {
    enabled: boolean;
    batchSize: number;
    dryRunDefault: boolean;
    staleInProgressHours: number;
  };
}

export class PolicyViolation extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(message: string, code: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'PolicyViolation';
    this.code = code;
    this.details = details;
  }
}

let cached: MotionPolicy | null = null;

/**
 * Gagal cepat bila `enforced` hilang. Kebijakan yang tidak menyatakan dirinya
 * wajib adalah kebijakan yang akan dilewati diam-diam.
 */
export function loadPolicy(file = path.join(paths.config, 'motion-policy.json')): MotionPolicy {
  if (cached && file === path.join(paths.config, 'motion-policy.json')) return cached;
  if (!fs.existsSync(file)) {
    throw new PolicyViolation(`berkas kebijakan gerak tidak ada: ${file}`, 'POLICY_MISSING', { file });
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { motion_policy?: Record<string, unknown> };
  const p = raw.motion_policy;
  if (!p) throw new PolicyViolation('motion_policy tidak ditemukan di berkas', 'POLICY_MALFORMED', { file });
  if (typeof p.enforced !== 'boolean') {
    throw new PolicyViolation('motion_policy.enforced wajib ada (true/false)', 'POLICY_UNENFORCED', { file });
  }

  const allowed = Array.isArray(p.camera_moves_allowed)
    ? (p.camera_moves_allowed as string[]).filter((m): m is CameraMove => (CAMERA_MOVES as readonly string[]).includes(m))
    : [...CAMERA_MOVES];

  const policy: MotionPolicy = {
    version: Number(p.version ?? 0),
    enforced: p.enforced,
    primaryProvider: String(p.primary_provider ?? 'seedance_i2v'),
    fallbackProvider: String(p.fallback_provider ?? 'wan_i2v'),
    draftProvider: String(p.draft_provider ?? 'ltx_i2v'),
    pipeline: p.pipeline === 'single_stage' ? 'single_stage' : 'two_stage',
    maxClipSeconds: Number(p.max_clip_seconds ?? 6),
    minClipSeconds: Number(p.min_clip_seconds ?? 3),
    cameraMovesAllowed: allowed.length ? allowed : [...CAMERA_MOVES],
    requireMotionCritic: p.require_motion_critic !== false,
    minMotionScore: Number(p.min_motion_score ?? 0.2),
    minSceneMotionScore: Number(p.min_scene_motion_score ?? p.min_motion_score ?? 0.2),
    backfill: {
      enabled: (p.backfill as Record<string, unknown>)?.enabled !== false,
      batchSize: Number((p.backfill as Record<string, unknown>)?.batch_size ?? 5),
      dryRunDefault: (p.backfill as Record<string, unknown>)?.dry_run_default !== false,
      staleInProgressHours: Number((p.backfill as Record<string, unknown>)?.stale_in_progress_hours ?? 24),
    },
  };
  cached = policy;
  return policy;
}

/** Hanya untuk tes: paksa baca ulang berkas. */
export function resetPolicyCache(): void {
  cached = null;
}

export interface PolicySubject {
  pipeline_version?: number | null;
  motion_prompt_schema_version?: number | null;
}

/**
 * Gate tunggal. Dipanggil sebelum render apa pun. Bila job masih di versi lama,
 * render DITOLAK — bukan diturunkan diam-diam ke pipeline lama.
 */
export function assertPolicyApplied(
  subject: PolicySubject,
  policy: MotionPolicy = loadPolicy(),
): void {
  if (!policy.enforced) return;
  const pipeline = subject.pipeline_version ?? 0;
  if (pipeline < policy.version) {
    throw new PolicyViolation(
      `job belum memakai kebijakan gerak v${policy.version} (masih v${pipeline}); jalankan backfill lebih dulu`,
      'PIPELINE_OUTDATED',
      { pipelineVersion: pipeline, required: policy.version },
    );
  }
  const schema = subject.motion_prompt_schema_version ?? 0;
  if (schema < 1) {
    throw new PolicyViolation(
      'job belum punya MotionPrompt terstruktur (schema v0)',
      'MOTION_SCHEMA_OUTDATED',
      { schemaVersion: schema, required: 1 },
    );
  }
}

/** Status yang dipakai UI dan backfill. */
export type MotionUpgradeStatus = 'pending' | 'in_progress' | 'done' | 'failed';

export interface MotionStamp {
  pipeline_version: number;
  motion_prompt_schema_version: number;
  motion_upgrade_status: MotionUpgradeStatus;
  motion_upgraded_at: string | null;
}

/** Nilai untuk job baru: langsung di versi terbaru, tidak pernah v0. */
export function stampNewJob(policy: MotionPolicy = loadPolicy()): MotionStamp {
  return {
    pipeline_version: policy.version,
    motion_prompt_schema_version: 1,
    motion_upgrade_status: 'done',
    motion_upgraded_at: new Date().toISOString(),
  };
}

/**
 * Dipakai backfill: perbarui hanya field kebijakan, jangan sentuh hasil render.
 */
export function stampUpgraded(
  status: MotionUpgradeStatus,
  policy: MotionPolicy = loadPolicy(),
): Partial<MotionStamp> {
  return {
    pipeline_version: status === 'done' ? policy.version : 0,
    motion_prompt_schema_version: status === 'done' ? 1 : 0,
    motion_upgrade_status: status,
    motion_upgraded_at: status === 'done' ? new Date().toISOString() : null,
  };
}

/** Prompt gerak harus memakai gerakan kamera yang diizinkan kebijakan. */
export function assertMotionAllowed(prompt: MotionPrompt, policy: MotionPolicy = loadPolicy()): void {
  if (!policy.enforced) return;
  if (!policy.cameraMovesAllowed.includes(prompt.camera_move)) {
    throw new PolicyViolation(
      `gerakan kamera "${prompt.camera_move}" tidak diizinkan kebijakan`,
      'CAMERA_MOVE_NOT_ALLOWED',
      { move: prompt.camera_move, allowed: policy.cameraMovesAllowed },
    );
  }
}
