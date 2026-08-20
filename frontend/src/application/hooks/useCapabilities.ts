/**
 * `GET /chat/capabilities` — what the streaming endpoints can emit.
 *
 * Read once at boot so the trace panel can say which surface it is reading and
 * whether subgraph namespaces are being sent (without them, every step would
 * be attributed to the supervisor).
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from '@application/queryClient';
import { fetchCapabilities } from '@infrastructure/api/endpoints';
import type { StreamCapabilitiesDTO } from '@infrastructure/types/api';

export function useCapabilities(): UseQueryResult<StreamCapabilitiesDTO, Error> {
  return useQuery({
    queryKey: queryKeys.capabilities(),
    queryFn: ({ signal }) => fetchCapabilities(signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
