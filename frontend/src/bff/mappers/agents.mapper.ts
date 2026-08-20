/**
 * `AgentInfoDTO[]` + `MCPServerStatusDTO[]` -> the sidebar's agent mesh.
 *
 * The design's mesh lists the supervisor above the workers. The supervisor is
 * the graph root rather than a registered worker, so it has no `/agents` entry
 * and is synthesised here from the roster it presides over.
 */

import type { AgentMeshItemVM, MeshSummaryVM, Tone } from '@bff/viewmodels';
import type { AgentInfoDTO, MCPServerStatusDTO } from '@infrastructure/types/api';

const SUPERVISOR_KEY = 'supervisor';

/** `new_joiners_agent` -> `New Joiners`, matching the design's short labels. */
export function humaniseAgentName(agent: AgentInfoDTO): string {
  const fromTitle = agent.title.replace(/\s*agent$/i, '').trim();
  if (fromTitle) return fromTitle;
  return agent.name
    .replace(/_agent$/i, '')
    .split('_')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

function toneForAgent(connected: boolean, hasServers: boolean, isActive: boolean): Tone {
  if (isActive) return 'blue';
  if (!hasServers) return 'neutral';
  return connected ? 'green' : 'red';
}

export interface MeshInput {
  readonly agents: readonly AgentInfoDTO[];
  readonly mcpServers: readonly MCPServerStatusDTO[];
  /** Agent name currently emitting trace steps, if a run is in flight. */
  readonly activeAgentName?: string | null;
  /** True while a supervisor run is streaming. */
  readonly running?: boolean;
  readonly supervisorModel?: string | null;
}

export function toMeshSummary(input: MeshInput): MeshSummaryVM {
  const connectivity = new Map(input.mcpServers.map((server) => [server.name, server]));
  const active = input.activeAgentName ?? null;

  const workers: AgentMeshItemVM[] = input.agents.map((agent) => {
    const bound = agent.mcp_servers.map((name) => connectivity.get(name));
    const hasServers = agent.mcp_servers.length > 0;
    const connected = hasServers && bound.every((server) => server?.connected === true);
    const isActive = active === agent.name;

    return {
      key: agent.name,
      name: humaniseAgentName(agent),
      toolsLabel: agent.tools.length > 0 ? String(agent.tools.length) : '—',
      description: agent.description,
      connected,
      tone: toneForAgent(connected, hasServers, isActive),
      statusLabel: isActive
        ? 'Working'
        : !hasServers
          ? 'No MCP server bound'
          : connected
            ? 'Connected'
            : 'MCP unreachable',
    };
  });

  const supervisorActive = active === SUPERVISOR_KEY || active === 'supervisor_agent';
  const supervisor: AgentMeshItemVM = {
    key: SUPERVISOR_KEY,
    name: 'Supervisor',
    toolsLabel: '—',
    description: input.supervisorModel
      ? `Routes to ${input.agents.length} workers · ${input.supervisorModel}`
      : `Routes to ${input.agents.length} workers`,
    connected: true,
    tone: supervisorActive ? 'blue' : 'green',
    statusLabel: supervisorActive ? 'Working' : 'Ready',
  };

  const running = input.running === true;
  const anyUnreachable = workers.some((worker) => worker.tone === 'red');

  return {
    label: running ? 'Working' : anyUnreachable ? 'Degraded' : 'All healthy',
    tone: running ? 'blue' : anyUnreachable ? 'red' : 'neutral',
    agents: [supervisor, ...workers],
  };
}
