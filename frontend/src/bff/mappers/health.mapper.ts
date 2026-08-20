/**
 * `HealthDTO` / `MCPServerStatusDTO` -> the shell's health view models.
 */

import type { McpServerVM, ServiceHealthVM, Tone } from '@bff/viewmodels';
import type { HealthDTO, MCPServerStatusDTO } from '@infrastructure/types/api';

/** Turn `identities_mcp` into `Identities`, the wording the design's mesh uses. */
export function humaniseServerName(name: string): string {
  const stripped = name.replace(/_mcp$/i, '').replace(/[_-]+/g, ' ').trim();
  if (!stripped) return name;
  return stripped
    .split(' ')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

export function toMcpServerVM(dto: MCPServerStatusDTO): McpServerVM {
  const tone: Tone = dto.connected ? 'green' : dto.configured ? 'red' : 'neutral';
  const statusLabel = dto.connected
    ? 'Connected'
    : dto.configured
      ? 'Unreachable'
      : 'Not configured';

  return {
    name: dto.name,
    label: humaniseServerName(dto.name),
    transport: dto.transport,
    toolsLabel: dto.tool_count > 0 ? String(dto.tool_count) : '—',
    connected: dto.connected,
    tone,
    statusLabel,
    error: dto.error,
  };
}

export function toServiceHealth(dto: HealthDTO): ServiceHealthVM {
  const mcpServers = dto.mcp_servers.map(toMcpServerVM);
  const connectedServerCount = mcpServers.filter((server) => server.connected).length;
  const configuredServerCount = dto.mcp_servers.filter((server) => server.configured).length;

  const provider = dto.llm;
  const providerLabel = provider
    ? `${provider.provider}${provider.installed ? '' : ' (package missing)'}`
    : 'unknown provider';

  return {
    ready: dto.graph_ready,
    statusLabel: dto.graph_ready ? 'All healthy' : 'Degraded',
    tone: dto.graph_ready ? 'green' : 'red',
    appName: dto.app,
    environment: dto.environment,
    model: dto.model,
    supervisorModel: dto.supervisor_model,
    providerLabel,
    agentNames: dto.agents,
    mcpServers,
    connectedServerCount,
    configuredServerCount,
    error: dto.error,
  };
}
