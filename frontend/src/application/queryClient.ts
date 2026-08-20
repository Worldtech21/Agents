/**
 * React Query configuration and the key registry.
 *
 * Keys live here rather than at their call sites so a cache write from a
 * streaming run and a cache read from the queue screen cannot drift apart.
 */

import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@infrastructure/api/client';

export const queryKeys = {
  health: () => ['health'] as const,
  agents: () => ['agents'] as const,
  mcpStatus: () => ['agents', 'mcp'] as const,
  capabilities: () => ['chat', 'capabilities'] as const,
  recommendation: (employeeId: string) => ['recommendation', employeeId] as const,
  recommendations: () => ['recommendation'] as const,
  threadState: (threadId: string) => ['chat', 'thread', threadId] as const,
} as const;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Health and roster shift only when the service restarts.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (error instanceof ApiError) {
            return error.isRetryable && failureCount < 2;
          }
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8_000),
      },
      mutations: {
        // A supervisor run is expensive and side-effect-shaped from the user's
        // point of view; never repeat one automatically.
        retry: false,
      },
    },
  });
}
