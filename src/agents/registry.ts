import { loadAgents } from '../core/config.ts';
import type { AgentDef, AgentsConfig } from '../core/types.ts';

export function agentsConfig(): AgentsConfig {
  return loadAgents();
}

export function agentDef(id: string): AgentDef {
  const cfg = agentsConfig();
  const agent = cfg.agents[id];
  if (!agent) throw new Error(`agen ${id} tidak ada di config/agents.json`);
  return agent;
}

/** Preset order is the dispatch order; presets are data, not code. */
export function presetAgents(preset: string): AgentDef[] {
  const cfg = agentsConfig();
  const ids = cfg.presets[preset] ?? cfg.presets[cfg.defaultPreset];
  if (!ids) throw new Error(`preset ${preset} tidak ada di config/agents.json`);
  return ids.map((id) => agentDef(id));
}

export function listPresets(): { name: string; agents: string[] }[] {
  const cfg = agentsConfig();
  return Object.entries(cfg.presets).map(([name, agents]) => ({ name, agents }));
}

/** Stage plan per agent, in dispatch order. */
export function stagesFor(preset: string): { agentId: string; name: string }[] {
  return presetAgents(preset).map((agent) => ({
    agentId: agent.id,
    name: stageNameFor(agent.id),
  }));
}

export function stageNameFor(agentId: string): string {
  switch (agentId) {
    case 'pm':
      return 'rencana';
    case 'pm_qa':
      return 'rencana-dan-qa';
    case 'research':
      return 'riset';
    case 'research_script':
      return 'riset-dan-naskah';
    case 'script':
      return 'naskah';
    case 'storyboard':
      return 'storyboard';
    case 'visual':
      return 'aset-visual';
    case 'motion':
      return 'motion';
    case 'sound':
      return 'audio';
    case 'render':
      return 'render';
    case 'qa':
      return 'qa';
    case 'script_storyboard':
      return 'naskah-dan-storyboard';
    case 'visual_motion':
      return 'visual-dan-motion';
    case 'render_qa':
      return 'render-dan-qa';
    default:
      return agentId;
  }
}
