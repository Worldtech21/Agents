/**
 * Reading and deciding access requests.
 *
 * These are the application's first mutations. The query client already sets
 * `retry: false` on mutations, which is the policy this needs: raising a
 * request or deciding one must never be repeated automatically.
 *
 * Every mutation invalidates both the request listings and `/personas` — the
 * approvals badge lives on the persona list, so a decision that did not
 * refresh it would leave a manager staring at a count for an empty inbox.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { queryKeys } from '@application/queryClient';
import { usePersona } from '@application/state/PersonaProvider';
import { toCatalogEntries, toRequestRows } from '@bff/mappers/requests.mapper';
import type { AccessRequestVM, CatalogEntryVM } from '@bff/viewmodels';
import { ApiError } from '@infrastructure/api/client';
import {
  approveRequest,
  fetchCatalog,
  fetchRequests,
  postRequests,
  rejectRequest,
} from '@infrastructure/api/endpoints';
import type { AccessRequestDTO, RaiseRequestDTO, RequestFilters } from '@infrastructure/types/api';

/** Display names by actor id, so a row says "Ramesh" rather than "EMP001". */
function useActorNames(): ReadonlyMap<string, string> {
  const { personas } = usePersona();
  return useMemo(
    () => new Map(personas.map((persona) => [persona.actorId.toUpperCase(), persona.name])),
    [personas],
  );
}

export interface RequestListState {
  readonly rows: readonly AccessRequestVM[];
  readonly isLoading: boolean;
  readonly error: ApiError | null;
  readonly refetch: () => void;
}

/**
 * One listing, serving three screens.
 *
 * Filtered by `approver_id` it is a manager's inbox; by `requester_id` it is
 * that person's own history; by neither it is everything. The backend applies
 * the filters, so the shape of the call is the shape of the question.
 */
export function useRequests(filters: RequestFilters, enabled = true): RequestListState {
  const { actor } = usePersona();
  const names = useActorNames();

  const query = useQuery({
    queryKey: queryKeys.requestList(filters),
    queryFn: ({ signal }) => fetchRequests(filters, signal),
    enabled,
    // A decision made in another persona should surface without a reload.
    staleTime: 5_000,
  });

  const rows = useMemo(
    () => toRequestRows(query.data ?? [], { viewerId: actor?.actorId ?? '', names }),
    [query.data, actor?.actorId, names],
  );

  return {
    rows,
    isLoading: query.isLoading,
    error: query.error instanceof ApiError ? query.error : null,
    refetch: () => void query.refetch(),
  };
}

/** The approval inbox for the acting persona. Disabled until one is known. */
export function useApprovalInbox(): RequestListState {
  const { actor } = usePersona();
  return useRequests(
    { approver_id: actor?.actorId ?? '', status: 'PENDING_APPROVAL' },
    Boolean(actor),
  );
}

/** Everything the acting persona has raised, decided or not. */
export function useMyRequests(): RequestListState {
  const { actor } = usePersona();
  return useRequests({ requester_id: actor?.actorId ?? '' }, Boolean(actor));
}

export interface DecisionState {
  readonly approve: (requestId: string, note: string) => Promise<AccessRequestDTO>;
  readonly reject: (requestId: string, note: string) => Promise<AccessRequestDTO>;
  readonly isDeciding: boolean;
  readonly error: ApiError | null;
  readonly decidingId: string | null;
}

/**
 * Approving and rejecting.
 *
 * The backend rejects a decision from anyone but the named approver with a
 * 403; this hook always sends the acting persona, so that check is a genuine
 * guard rather than a formality.
 */
export function useDecision(): DecisionState {
  const { actor } = usePersona();
  const client = useQueryClient();

  const invalidate = useCallback(() => {
    void client.invalidateQueries({ queryKey: queryKeys.requests() });
    void client.invalidateQueries({ queryKey: queryKeys.personas() });
  }, [client]);

  const mutation = useMutation({
    mutationFn: ({
      requestId,
      note,
      decision,
    }: {
      requestId: string;
      note: string;
      decision: 'approve' | 'reject';
    }) => {
      const payload = { approver_id: actor?.actorId ?? '', note };
      return decision === 'approve'
        ? approveRequest(requestId, payload)
        : rejectRequest(requestId, payload);
    },
    onSuccess: invalidate,
  });

  return {
    approve: (requestId, note) =>
      mutation.mutateAsync({ requestId, note, decision: 'approve' }),
    reject: (requestId, note) => mutation.mutateAsync({ requestId, note, decision: 'reject' }),
    isDeciding: mutation.isPending,
    error: mutation.error instanceof ApiError ? mutation.error : null,
    decidingId: mutation.isPending ? (mutation.variables?.requestId ?? null) : null,
  };
}

export interface RaiseState {
  readonly raise: (payload: RaiseRequestDTO) => Promise<AccessRequestDTO[]>;
  readonly isRaising: boolean;
  readonly error: ApiError | null;
}

/** Raising requests — one entitlement from the assistant, or a whole set from HR. */
export function useRaiseRequest(): RaiseState {
  const client = useQueryClient();

  const mutation = useMutation({
    mutationFn: (payload: RaiseRequestDTO) => postRequests(payload),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.requests() });
      void client.invalidateQueries({ queryKey: queryKeys.personas() });
    },
  });

  return {
    raise: (payload) => mutation.mutateAsync(payload),
    isRaising: mutation.isPending,
    error: mutation.error instanceof ApiError ? mutation.error : null,
  };
}

/** The entitlement catalog, already labelled with each item's approval verdict. */
export function useCatalog(): {
  readonly entries: readonly CatalogEntryVM[];
  readonly isLoading: boolean;
} {
  const query = useQuery({
    queryKey: queryKeys.catalog(),
    queryFn: ({ signal }) => fetchCatalog(signal),
    // The catalog is reference data; it changes when somebody edits policy.
    staleTime: 5 * 60_000,
  });

  return {
    entries: useMemo(() => toCatalogEntries(query.data ?? []), [query.data]),
    isLoading: query.isLoading,
  };
}
