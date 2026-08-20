/**
 * `GET /health` — the shell's readiness banner and the model/provider footer.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from '@application/queryClient';
import { toServiceHealth } from '@bff/mappers/health.mapper';
import type { ServiceHealthVM } from '@bff/viewmodels';
import { fetchHealth } from '@infrastructure/api/endpoints';

export function useServiceHealth(): UseQueryResult<ServiceHealthVM, Error> {
  return useQuery({
    queryKey: queryKeys.health(),
    queryFn: ({ signal }) => fetchHealth(signal),
    select: toServiceHealth,
    // A degraded service is worth noticing without a reload.
    refetchInterval: 60_000,
  });
}
