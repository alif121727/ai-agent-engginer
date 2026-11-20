import fs from 'node:fs';
import type { ScenePlan } from '../core/types.ts';
import type { AssetRecord } from '../core/types.ts';
import { ffprobe, frameSharpness, perceptualHash, hamming, detectText } from '../render/ffmpeg.ts';

export interface QualityIssue {
  sceneIndex: number;
  reason: string;
  code:
    | 'missing'
    | 'fallback'
    | 'too-small'
    | 'blurry'
    | 'text-detected'
    | 'duplicate'
    | 'unreadable';
}

export interface QualityReport {
  passed: boolean;
  issues: QualityIssue[];
  hashes: Record<number, string>;
  sharpness: Record<number, number>;
  checkedAt: string;
}

/**
 * Compares the short and long edge instead of width/height, so a portrait 9:16
 * frame (1080x1920) and a square 1:1 frame (1080x1080) pass the same bar as
 * landscape 1920x1080. Comparing raw width rejected every vertical reel, and
 * the free image provider caps 9:16 output at 1024x1792 by design.
 *
 * `minWidth`/`minHeight` describe a landscape reference frame (1280x720), so
 * the short edge inherits the smaller of the two. The long edge is capped at
 * 1024: nothing we ask of a source is larger, and a shorter long edge is
 * visibly soft once the renderer upscales it.
 */
const MAX_DEMANDED_LONG_EDGE = 1024;

export function isBelowMinimum(width: number, height: number, options: { minWidth: number; minHeight: number }): boolean {
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  const shortMin = Math.min(options.minWidth, options.minHeight);
  const longMin = Math.min(Math.max(options.minWidth, options.minHeight), MAX_DEMANDED_LONG_EDGE);
  return shortEdge < shortMin || longEdge < longMin;
}

export interface QualityOptions {
  minWidth: number;
  minHeight: number;
  minSharpness: number;
  /** Generated stills are softer than camera photos; they get their own floor. */
  minSharpnessGenerated?: number;
  sceneHashDistance: number;
  forbidTextInImage: boolean;
  /** `final` jobs must not contain code-drawn fallback assets. */
  mode: 'draft' | 'final';
}

export function checkAssets(input: {
  scenes: ScenePlan[];
  assets: AssetRecord[];
  options: QualityOptions;
}): QualityReport {
  const issues: QualityIssue[] = [];
  const hashes: Record<number, string> = {};
  const sharpness: Record<number, number> = {};
  const byScene = new Map<number, AssetRecord>();
  for (const asset of input.assets) byScene.set(asset.sceneIndex, asset);

  for (const scene of input.scenes) {
    const asset = byScene.get(scene.index);
    if (!asset) {
      issues.push({ sceneIndex: scene.index, code: 'missing', reason: 'scene belum punya aset' });
      continue;
    }
    if (asset.fallback) {
      issues.push({
        sceneIndex: scene.index,
        code: 'fallback',
        reason: 'aset dibuat kode (FALLBACK), tidak fotorealistik',
      });
      if (input.options.mode === 'final') continue;
    }
    if (!fs.existsSync(asset.path)) {
      issues.push({ sceneIndex: scene.index, code: 'unreadable', reason: 'berkas aset hilang' });
      continue;
    }
    const probe = ffprobe(asset.path);
    if (!probe.ok) {
      issues.push({ sceneIndex: scene.index, code: 'unreadable', reason: probe.error ?? 'tidak terbaca' });
      continue;
    }
    if (isBelowMinimum(probe.width ?? 0, probe.height ?? 0, input.options)) {
      issues.push({
        sceneIndex: scene.index,
        code: 'too-small',
        reason: `resolusi ${probe.width}x${probe.height} di bawah minimum`,
      });
    }
    const sharp = frameSharpness(asset.path, Math.min(1, (probe.durationSec ?? 2) / 2));
    sharpness[scene.index] = sharp;
    const generated = asset.provider !== 'local';
    const floor = generated
      ? input.options.minSharpnessGenerated ?? input.options.minSharpness
      : input.options.minSharpness;
    if (sharp < floor) {
      issues.push({ sceneIndex: scene.index, code: 'blurry', reason: `ketajaman ${sharp} di bawah minimum` });
    }
    if (input.options.forbidTextInImage) {
      const ocr = detectText(asset.path, Math.min(1, (probe.durationSec ?? 2) / 2));
      if (ocr.hasText) {
        issues.push({ sceneIndex: scene.index, code: 'text-detected', reason: `teks terdeteksi: ${ocr.text.slice(0, 40)}` });
      }
    }
    hashes[scene.index] = perceptualHash(asset.path, Math.min(0.5, (probe.durationSec ?? 2) / 2));
  }

  const ordered = input.scenes.map((s) => s.index).filter((i) => hashes[i]);
  for (let i = 1; i < ordered.length; i++) {
    const prev = hashes[ordered[i - 1]];
    const cur = hashes[ordered[i]];
    if (hamming(prev, cur) < input.options.sceneHashDistance) {
      issues.push({
        sceneIndex: ordered[i],
        code: 'duplicate',
        reason: 'scene terlalu mirip dengan scene sebelumnya',
      });
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    hashes,
    sharpness,
    checkedAt: new Date().toISOString(),
  };
}
