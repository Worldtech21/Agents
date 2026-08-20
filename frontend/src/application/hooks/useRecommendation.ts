/**
 * Running and reading entitlement recommendations.
 *
 * A run is a *streamed mutation* — the trace panel needs the intermediate
 * steps, so it cannot be a plain query — but its result is cached under a query
 * key so the queue, the report screen and the console all read the same object
 * and a revisit costs nothing.
 */

import { useCallback, useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  useSupervisorStream,
  type SupervisorStream,
} from '@application/hooks/useSupervisorStream';
import { queryKeys } from '@application/queryClient';
import { toRecommendationOutcome, type RecommendationOutcome } from '@bff/outcome';
import { ApiError } from '@infrastructure/api/client';
import { postChat } from '@infrastructure/api/endpoints';

/**
 * The brief handed to the supervisor.
 *
 * Deliberately plain: the supervisor prompt already fixes the sequence, the
 * output contract and the threshold source, and restating any of that here
 * would compete with it.
 */
export function buildRecommendationBrief(employeeId: string): string {
  return `Recommend entitlements for employee ${employeeId.trim()}.`;
}

/** Employee ids look like `NJ1004`; anything non-empty is still sent. */
export function normaliseEmployeeId(value: string): string {
  return value.trim().toUpperCase();
}

/* ------------------------------------------------------------------ read --- */

/**
 * The cached outcome for one employee.
 *
 * `enabled: false` keeps this a pure cache read: navigating to a report must
 * never silently start a six-worker run. `refetch()` performs the blocking
 * `POST /chat` variant, which is the right call for a deliberate re-run with no
 * trace panel attached.
 */
export function useRecommendationOutcome(employeeId: string | null) {
  return useQuery({
    queryKey: queryKeys.recommendation(employeeId ?? ''),
    queryFn: async ({ signal }) => {
      if (!employeeId) throw new ApiError('No employee id given.', { code: 'missing_employee_id' });
      const response = await postChat({ message: buildRecommendationBrief(employeeId) }, signal);
      return toRecommendationOutcome(response.answer, {
        employeeId,
        threadId: response.thread_id,
        receivedAt: Date.now(),
      });
    },
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 60 * 60_000,
  });
}

/**
 * Cached outcomes for a set of employee ids, as a map.
 *
 * `useQueries` (rather than a `getQueryData` sweep) so the queue re-renders the
 * moment a run finishes anywhere in the app.
 */
export function useRecommendationOutcomes(
  employeeIds: readonly string[],
): ReadonlyMap<string, RecommendationOutcome> {
  const results = useQueries({
    queries: employeeIds.map((employeeId) => ({
      queryKey: queryKeys.recommendation(employeeId),
      queryFn: () => {
        throw new ApiError('Recommendations are populated by an explicit run.', {
          code: 'run_required',
        });
      },
      enabled: false,
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: 60 * 60_000,
    })),
  });

  return useMemo(() => {
    const map = new Map<string, RecommendationOutcome>();
    employeeIds.forEach((employeeId, index) => {
      const data = results[index]?.data as RecommendationOutcome | undefined;
      if (data) map.set(employeeId, data);
    });
    return map;
    // `results` is a new array each render; its data identities are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeIds, results.map((result) => result.dataUpdatedAt).join(',')]);
}

/* ------------------------------------------------------------------- run --- */

export interface RecommendationRun {
  readonly stream: SupervisorStream;
  readonly runningEmployeeId: string | null;
  readonly isRunning: boolean;
  readonly lastOutcome: RecommendationOutcome | null;
  readonly run: (employeeId: string) => Promise<RecommendationOutcome | null>;
  readonly cancel: () => void;
}

export function useRecommendationRun(): RecommendationRun {
  const queryClient = useQueryClient();
  const stream = useSupervisorStream();
  const [runningEmployeeId, setRunningEmployeeId] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<RecommendationOutcome | null>(null);

  const run = useCallback(
    async (rawEmployeeId: string): Promise<RecommendationOutcome | null> => {
      const employeeId = normaliseEmployeeId(rawEmployeeId);
      if (!employeeId) return null;

      setRunningEmployeeId(employeeId);
      setLastOutcome(null);

      try {
        const result = await stream.start({
          message: buildRecommendationBrief(employeeId),
          metadata: { surface: 'recommendation', employee_id: employeeId },
        });

        // `null` means the run was superseded or cancelled; leave the cache alone.
        if (!result) return null;

        const outcome = toRecommendationOutcome(result.answer, {
          employeeId,
          threadId: result.threadId,
          receivedAt: Date.now(),
        });

        queryClient.setQueryData(queryKeys.recommendation(employeeId), outcome);
        setLastOutcome(outcome);
        return outcome;
      } finally {
        setRunningEmployeeId(null);
      }
    },
    [queryClient, stream],
  );

  const cancel = useCallback(() => {
    stream.cancel();
    setRunningEmployeeId(null);
  }, [stream]);

  return {
    stream,
    runningEmployeeId,
    isRunning: stream.isStreaming,
    lastOutcome,
    run,
    cancel,
  };
}
