/**
 * The verdict behind a confirmation card.
 *
 * This hook exists to make one guarantee: what the employee is shown before
 * they press a button comes from the rules engine, not from the model. The
 * assistant proposes an entitlement; `POST /requests/analyze` is asked the same
 * question and its answer is what renders. Where the two disagree, the model is
 * simply not consulted.
 *
 * `/requests/analyze` writes nothing and runs no agents, so asking it on every
 * proposal costs a few milliseconds.
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { queryKeys } from '@application/queryClient';
import { usePersona } from '@application/state/PersonaProvider';
import { toVerdict } from '@bff/mappers/requests.mapper';
import type { RequestIntentVM, VerdictVM } from '@bff/viewmodels';
import { ApiError } from '@infrastructure/api/client';
import { postAnalyze } from '@infrastructure/api/endpoints';

export interface VerdictState {
  readonly verdict: VerdictVM | null;
  readonly isLoading: boolean;
  readonly error: ApiError | null;
}

/**
 * Resolve *intent* against policy for *subjectId*.
 *
 * Idle until the assistant has both named an entitlement and said it is ready
 * to submit — asking mid-clarification would put a confirm button under a
 * conversation that has not finished having itself.
 */
export function useVerdict(
  intent: RequestIntentVM | null,
  subjectId: string | null,
): VerdictState {
  const { personas } = usePersona();

  const entitlement = intent?.entitlementId ?? intent?.entitlementName ?? '';
  const enabled = Boolean(subjectId && entitlement && intent?.readyToSubmit);

  const query = useQuery({
    queryKey: queryKeys.verdict(subjectId ?? '', entitlement),
    queryFn: ({ signal }) =>
      postAnalyze(
        {
          subject_id: subjectId ?? '',
          ...(intent?.entitlementId
            ? { entitlement_id: intent.entitlementId }
            : { entitlement_name: intent?.entitlementName ?? '' }),
        },
        signal,
      ),
    enabled,
    // The verdict follows policy and what the person already holds, both of
    // which can move while a conversation is open.
    staleTime: 0,
  });

  const names = useMemo(
    () => new Map(personas.map((persona) => [persona.actorId.toUpperCase(), persona.name])),
    [personas],
  );

  const verdict = useMemo(
    () =>
      query.data
        ? toVerdict(query.data.verdict, { viewerId: subjectId ?? '', names })
        : null,
    [query.data, subjectId, names],
  );

  return {
    verdict,
    isLoading: enabled && query.isLoading,
    error: query.error instanceof ApiError ? query.error : null,
  };
}
