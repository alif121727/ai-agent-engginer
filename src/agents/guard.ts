import path from 'node:path';
import fs from 'node:fs';
import { jobDir, readJson, writeJsonAtomic } from '../core/fsx.ts';
import type { AgentDef, JobStatus } from '../core/types.ts';

export class ToolNotAllowedError extends Error {
  tool: string;
  agentId: string;
  constructor(agentId: string, tool: string) {
    super(`Agen ${agentId} tidak berhak memakai alat ${tool}`);
    this.agentId = agentId;
    this.tool = tool;
  }
}

export class ArtifactWriteError extends Error {
  constructor(agentId: string, file: string) {
    super(`Agen ${agentId} tidak boleh menulis artefak ${file}`);
  }
}

/** Raised when a network call fails; never counts as an agent retry. */
export class OfflineError extends Error {
  constructor(message = 'koneksi internet terputus') {
    super(message);
    this.name = 'OfflineError';
  }
}

/** Configuration/permission problems that retrying cannot fix. */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

export class CostApprovalRequired extends Error {
  estimate: number;
  limit: number;
  constructor(estimate: number, limit: number) {
    super(`estimasi biaya ${estimate} melewati batas ${limit}`);
    this.name = 'CostApprovalRequired';
    this.estimate = estimate;
    this.limit = limit;
  }
}

export interface AgentContext {
  jobId: string;
  agent: AgentDef;
  brief: Record<string, unknown>;
  readArtifact<T>(file: string): T | null;
  writeArtifact(file: string, value: unknown): void;
  log(level: 'info' | 'warn' | 'error', message: string, data?: unknown): Promise<void>;
  setStageMessage(message: string): Promise<void>;
  setStageProgress(progress: number): Promise<void>;
  isOffline(): boolean;
  assertOnline(): void;
}

export type ToolImpl = (args: Record<string, unknown>, ctx: AgentContext) => Promise<unknown>;

export interface Tool {
  name: string;
  description: string;
  run: ToolImpl;
}

/**
 * Middleware that enforces the job desk: an agent may only call tools listed in
 * its own `allowedTools`, and may only write the artifacts it owns. Violations
 * are logged and the call is rejected instead of silently succeeding.
 */
export function guardTool(agent: AgentDef, tool: string): void {
  if (!agent.allowedTools.includes(tool)) throw new ToolNotAllowedError(agent.id, tool);
}

export function guardArtifactWrite(agent: AgentDef, file: string): void {
  const base = path.basename(file);
  if (!agent.artifacts.writes.includes(base)) throw new ArtifactWriteError(agent.id, base);
}

export function artifactPath(jobId: string, file: string): string {
  return path.join(jobDir(jobId), 'artifacts', path.basename(file));
}

export function readArtifactFile<T>(jobId: string, file: string): T | null {
  const target = artifactPath(jobId, file);
  if (!fs.existsSync(target)) return null;
  return readJson<T | null>(target, null);
}

export function writeArtifactFile(jobId: string, file: string, value: unknown): void {
  writeJsonAtomic(artifactPath(jobId, file), value);
}

export type { JobStatus };
