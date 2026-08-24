/**
 * Everything HR mode needs, assembled in one place.
 *
 * The recommendation path is unchanged — the queue, the run, the trace and the
 * report all work as they did. What is new is the end of it: the accepted set
 * can now be submitted, which is what the "Open access request" button had been
 * standing in for.
 */

import { useCallback, useMemo, useState } from 'react';

import { useRaiseRequest, useRequests } from '@application/hooks/useRequests';
import { usePersona } from '@application/state/PersonaProvider';
import type { NavItemVM } from '@bff/viewmodels';
import type { AccessRequestDTO } from '@infrastructure/types/api';

export function useHrShell(queueSize: number, selectedEmployeeId: string | null) {
  const { actor } = usePersona();
  const raise = useRaiseRequest();
  const [submitSummary, setSubmitSummary] = useState<string | null>(null);

  const history = useRequests({ requester_id: actor?.actorId ?? '' }, Boolean(actor));

  /**
   * Raise one request per ticked entitlement, for the joiner on screen.
   *
   * The backend judges each separately, so the outcome is a mix and the summary
   * says so. Reporting "submitted" alone would hide that some were granted on
   * the spot and others are now sitting with a manager.
   */
  const submitRequests = useCallback(
    async (entitlementIds: readonly string[]) => {
      if (!actor || !selectedEmployeeId || entitlementIds.length === 0) return;
      setSubmitSummary(null);
      try {
        const records = await raise.raise({
          requester_id: actor.actorId,
          requester_type: 'HR',
          subject_id: selectedEmployeeId,
          entitlements: entitlementIds.map((id) => ({ entitlement_id: id })),
          justification: `Onboarding ${selectedEmployeeId}`,
        });
        setSubmitSummary(summarise(records));
      } catch (error) {
        setSubmitSummary(
          `Nothing was submitted: ${
            error instanceof Error ? error.message : 'the request failed'
          }`,
        );
      }
    },
    [actor, selectedEmployeeId, raise],
  );

  const navItems = useMemo<NavItemVM[]>(
    () => [
      { key: 'queue', label: 'Queue', icon: 'queue', badge: String(queueSize) },
      {
        key: 'report',
        label: 'Recommendation',
        icon: 'report',
        badge: selectedEmployeeId ?? '—',
      },
      {
        key: 'hrRequests',
        label: 'Requests',
        icon: 'history',
        badge: String(history.rows.length),
      },
      { key: 'chat', label: 'Console', icon: 'chat', badge: '—' },
    ],
    [queueSize, selectedEmployeeId, history.rows.length],
  );

  return {
    history,
    submitRequests,
    submitSummary,
    isSubmitting: raise.isRaising,
    navItems,
  };
}

/** One sentence covering a mixed batch. */
function summarise(records: readonly AccessRequestDTO[]): string {
  if (records.length === 0) return 'Nothing was submitted.';

  const granted = records.filter((r) =>
    ['AUTO_GRANTED', 'GRANTED'].includes(r.status.toUpperCase()),
  );
  const pending = records.filter((r) => r.status.toUpperCase() === 'PENDING_APPROVAL');
  const blocked = records.filter((r) => r.status.toUpperCase() === 'BLOCKED_NO_APPROVER');
  const failed = records.filter((r) => r.status.toUpperCase() === 'PROVISIONING_FAILED');

  const parts: string[] = [];
  if (granted.length > 0) {
    parts.push(`${granted.length} granted (${granted.map((r) => r.entitlement_name).join(', ')})`);
  }
  if (pending.length > 0) {
    // Named, because it is the one fact HR needs to chase later.
    const approver = pending[0]?.approver_id ?? 'the manager';
    parts.push(`${pending.length} sent to ${approver} for approval`);
  }
  if (blocked.length > 0) {
    parts.push(`${blocked.length} could not be routed — no manager on record`);
  }
  if (failed.length > 0) {
    parts.push(`${failed.length} failed to apply`);
  }

  return `${parts.join(' · ')}. See Requests for the detail.`;
}
