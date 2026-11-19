import path from 'node:path';
import fs from 'node:fs';
import { jobDir, readJson, writeJsonAtomic } from '../core/fsx.ts';

export interface StageCheckpoint<T = unknown> {
  stage: string;
  status: 'done' | 'partial';
  updatedAt: string;
  data: T;
}

export function checkpointFile(jobId: string, stage: string): string {
  return path.join(jobDir(jobId), 'checkpoints', `${stage}.json`);
}

export function readCheckpoint<T>(jobId: string, stage: string): StageCheckpoint<T> | null {
  const file = checkpointFile(jobId, stage);
  if (!fs.existsSync(file)) return null;
  return readJson<StageCheckpoint<T> | null>(file, null);
}

export function writeCheckpoint<T>(jobId: string, stage: string, data: T, status: 'done' | 'partial' = 'done'): void {
  writeJsonAtomic(checkpointFile(jobId, stage), {
    stage,
    status,
    updatedAt: new Date().toISOString(),
    data,
  } satisfies StageCheckpoint<T>);
}

export function clearCheckpoint(jobId: string, stage: string): void {
  const file = checkpointFile(jobId, stage);
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
}

/** Per-scene checkpoint so a re-run resumes at the first missing scene. */
export interface SceneCheckpoint {
  sceneIndex: number;
  done: number[];
}

export function readSceneCheckpoint(jobId: string, stage: string): SceneCheckpoint {
  return readCheckpoint<SceneCheckpoint>(jobId, stage)?.data ?? { sceneIndex: 0, done: [] };
}

export function markSceneDone(jobId: string, stage: string, sceneIndex: number): void {
  const current = readSceneCheckpoint(jobId, stage);
  if (!current.done.includes(sceneIndex)) current.done.push(sceneIndex);
  current.done.sort((a, b) => a - b);
  current.sceneIndex = current.done.length;
  writeCheckpoint(jobId, stage, current, 'partial');
}

export function markStageComplete(jobId: string, stage: string): void {
  const current = readSceneCheckpoint(jobId, stage);
  writeCheckpoint(jobId, stage, current, 'done');
}

export function isStageComplete(jobId: string, stage: string): boolean {
  return readCheckpoint(jobId, stage)?.status === 'done';
}
