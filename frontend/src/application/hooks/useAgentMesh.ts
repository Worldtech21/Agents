/**
 * `GET /agents` + `GET /agents/mcp` -> the sidebar mesh.
 *
 * Two queries rather than one so MCP connectivity can be polled on its own
 * cadence: the roster is fixed at boot, but a server can drop at any time.
 */

import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from '@application/queryClient';
import { toMeshSummary } from '@bff/mappers/agents.mapper';
import type { MeshSummaryVM } from '@bff/viewmodels';
import { fetchAgents, fetchMcpStatus } from '@infrastructure/api/endpoints';
import type { AgentInfoDTO, MCPServerStatusDTO } from '@infrastructure/types/api';

export function useAgentRoster(): UseQueryResult<AgentInfoDTO[], Error> {
  return useQuery({
    queryKey: queryKeys.agents(),
    queryFn: ({ signal }) => fetchAgents(signal),
    staleTime: 5 * 60_000,
  });
}

export function useMcpStatus(): UseQueryResult<MCPServerStatusDTO[], Error> {
  return useQuery({
    queryKey: queryKeys.mcpStatus(),
    queryFn: ({ signal }) => fetchMcpStatus(signal),
    refetchInterval: 60_000,
  });
}

export interface AgentMeshState {
  readonly mesh: MeshSummaryVM;
  readonly agents: readonly AgentInfoDTO[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

export function useAgentMesh(options: {
  activeAgentKey?: string | null;
  running?: boolean;
  supervisorModel?: string | null;
}): AgentMeshState {
  const roster = useAgentRoster();
  const mcp = useMcpStatus();

  const agents = useMemo(() => roster.data ?? [], [roster.data]);
  const mcpServers = useMemo(() => mcp.data ?? [], [mcp.data]);

  const mesh = useMemo(
    () =>
      toMeshSummary({
        agents,
        mcpServers,
        activeAgentName: options.activeAgentKey ?? null,
        running: options.running ?? false,
        supervisorModel: options.supervisorModel ?? null,
      }),
    [agents, mcpServers, options.activeAgentKey, options.running, options.supervisorModel],
  );

  return {
    mesh,
    agents,
    isLoading: roster.isLoading || mcp.isLoading,
    error: roster.error ?? mcp.error ?? null,
    refetch: () => {
      void roster.refetch();
      void mcp.refetch();
    },
  };
}
