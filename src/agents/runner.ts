import { agentDef } from './registry.ts';
import {
  readArtifactFile,
  writeArtifactFile,
  OfflineError,
  CostApprovalRequired,
  ToolNotAllowedError,
  ArtifactWriteError,
  PermanentError,
  type AgentContext,
} from './guard.ts';
import { callTool } from './tools.ts';
import { recordEvent } from '../core/bus.ts';
import { logger } from '../core/log.ts';
import type { AgentDef, Brief } from '../core/types.ts';

export interface StageOutcome {
  ok: boolean;
  skipped?: boolean;
  data?: unknown;
  error?: string;
  /** Network failures must not consume an agent retry. */
  offline?: boolean;
  /** Configuration errors: retrying would only repeat the same failure. */
  permanent?: boolean;
  costApproval?: { estimate: number; limit: number };
}

export interface RunStageInput {
  jobId: string;
  agentId: string;
  brief: Brief;
  isOffline(): boolean;
  setStageMessage(msg: string): Promise<void>;
  setStageProgress(pct: number): Promise<void>;
}

const stageToolCalls: Record<string, string[]> = {
  pm: ['read_brief', 'plan_jobs'],
  pm_qa: ['read_brief', 'plan_jobs'],
  research: ['read_themes', 'write_research'],
  research_script: ['read_themes', 'write_research', 'write_script'],
  script: ['read_research', 'write_script'],
  storyboard: ['read_script', 'write_storyboard'],
  visual: ['read_storyboard', 'list_visual_adapters', 'generate_image', 'write_assets'],
  motion: ['read_storyboard', 'read_assets', 'write_motion'],
  sound: ['read_script', 'write_audio_plan'],
  render: ['read_all_artifacts', 'render_video'],
  qa: ['read_all_artifacts', 'probe_video', 'inspect_preview', 'approve_job'],
  script_storyboard: ['read_brief', 'read_research', 'write_script', 'read_script', 'write_storyboard'],
  visual_motion: [
    'read_storyboard',
    'list_visual_adapters',
    'generate_image',
    'write_assets',
    'read_assets',
    'write_motion',
  ],
  render_qa: [
    'read_all_artifacts',
    'read_script',
    'write_audio_plan',
    'probe_video',
    'render_video',
    'inspect_preview',
    'approve_job',
  ],
};

export function contextFor(input: RunStageInput, agent: AgentDef): AgentContext {
  return {
    jobId: input.jobId,
    agent,
    brief: input.brief as unknown as Record<string, unknown>,
    readArtifact: <T,>(file: string) => readArtifactFile<T>(input.jobId, file),
    writeArtifact: (file: string, value: unknown) => writeArtifactFile(input.jobId, file, value),
    log: async (level, message, data) => {
      await recordEvent({
        jobId: input.jobId,
        level,
        scope: `agent:${agent.id}`,
        agentId: agent.id,
        message,
        data,
      });
    },
    setStageMessage: input.setStageMessage,
    setStageProgress: input.setStageProgress,
    isOffline: input.isOffline,
    assertOnline: () => {
      if (input.isOffline()) throw new OfflineError();
    },
  };
}

/**
 * Runs one agent stage. Tool calls are individually guarded, so an agent that
 * tries something outside its job desk fails loudly instead of quietly doing
 * another agent's work.
 */
export async function runStage(input: RunStageInput): Promise<StageOutcome> {
  const agent = agentDef(input.agentId);
  const ctx = contextFor(input, agent);
  const calls = stageToolCalls[agent.id] ?? [];
  try {
    await ctx.log('info', `mulai job desk ${agent.name}`, { tools: agent.allowedTools });
    let last: unknown;
    for (const toolName of calls) {
      ctx.assertOnline();
      last = await callTool(toolName, ctx);
    }
    if (agent.id === 'render' || agent.id === 'render_qa') {
      const renderResult = ctx.readArtifact<Record<string, unknown>>('render-result.json');
      if (renderResult) await callTool('write_render', ctx, { render: renderResult });
    }
    await ctx.log('info', `${agent.name} selesai`);
    return { ok: true, data: last };
  } catch (err) {
    if (err instanceof OfflineError) {
      await ctx.log('warn', 'dihentikan karena internet putus, akan lanjut dari checkpoint');
      return { ok: false, offline: true, error: err.message };
    }
    if (err instanceof ToolNotAllowedError || err instanceof ArtifactWriteError) {
      await recordEvent({
        jobId: input.jobId,
        level: 'error',
        scope: 'guard',
        agentId: agent.id,
        message: `PELANGGARAN JOB DESK: ${err.message}`,
      });
      return { ok: false, error: err.message };
    }
    if (err instanceof PermanentError) {
      await ctx.log('error', err.message);
      return { ok: false, error: err.message, permanent: true };
    }
    if (err instanceof CostApprovalRequired) {
      return { ok: false, costApproval: { estimate: err.estimate, limit: err.limit }, error: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    logger('runner').error(`tahap ${agent.id} gagal`, message);
    await ctx.log('error', `tahap gagal: ${message}`);
    return { ok: false, error: message };
  }
}

/** Test hook: prove the guard rejects tools outside a job desk. */
export async function assertGuardRejects(agentId: string, toolName: string): Promise<boolean> {
  const agent = agentDef(agentId);
  if (agent.allowedTools.includes(toolName)) return false;
  const ctx = contextFor(
    {
      jobId: 'test',
      agentId,
      brief: { model: 'test' },
      isOffline: () => false,
      setStageMessage: async () => {},
      setStageProgress: async () => {},
    },
    agent,
  );
  try {
    await callTool(toolName, ctx);
    return false;
  } catch (err) {
    return err instanceof ToolNotAllowedError;
  }
}
