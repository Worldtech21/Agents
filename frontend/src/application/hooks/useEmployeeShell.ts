/**
 * Everything employee mode needs, assembled in one place.
 *
 * `AppShell` is the composition root and should stay composition only, so the
 * wiring for each mode lives beside the hooks it wires. This one owns the
 * assistant conversation, the verdict behind its confirmation card, the
 * approval inbox and the request history.
 *
 * The one piece of real logic here is `confirm`: it is where a conversation
 * becomes a written request.
 */

import { useCallback, useMemo } from 'react';

import { useAssistant } from '@application/hooks/useAssistant';
import {
  useApprovalInbox,
  useDecision,
  useMyRequests,
  useRaiseRequest,
} from '@application/hooks/useRequests';
import { useVerdict } from '@application/hooks/useVerdict';
import { usePersona } from '@application/state/PersonaProvider';
import type { NavItemVM, VerdictVM } from '@bff/viewmodels';

export function useEmployeeShell() {
  const { actor } = usePersona();
  const assistant = useAssistant();
  const inbox = useApprovalInbox();
  const history = useMyRequests();
  const decision = useDecision();
  const raise = useRaiseRequest();

  const verdict = useVerdict(assistant.pendingIntent, actor?.actorId ?? null);

  /**
   * Turn the verdict into a real request.
   *
   * The backend evaluates it once more before writing, so what comes back —
   * not what the card predicted — is what the employee is told. That is why the
   * outcome is read off the returned record rather than composed from the
   * verdict we already had.
   */
  const confirm = useCallback(
    async (confirmed: VerdictVM) => {
      if (!actor) return;
      try {
        const [record] = await raise.raise({
          requester_id: actor.actorId,
          requester_type: 'EMPLOYEE',
          subject_id: actor.actorId,
          entitlements: [
            {
              ...(confirmed.entitlementId
                ? { entitlement_id: confirmed.entitlementId }
                : { entitlement_name: confirmed.entitlementName }),
              justification: assistant.pendingIntent?.justification ?? '',
            },
          ],
        });
        assistant.clearIntent();
        if (record) assistant.note(describeOutcome(record.status, record.entitlement_name));
      } catch (error) {
        assistant.note(
          `That request could not be raised: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    },
    [actor, assistant, raise],
  );

  const decide = useCallback(
    (requestId: string, verdictKind: 'approve' | 'reject', note: string) => {
      const action = verdictKind === 'approve' ? decision.approve : decision.reject;
      void action(requestId, note).catch(() => {
        // Surfaced through `decision.error`; the screen renders it.
      });
    },
    [decision],
  );

  const navItems = useMemo<NavItemVM[]>(
    () => [
      { key: 'assistant', label: 'Assistant', icon: 'chat', badge: String(assistant.turns.length) },
      {
        key: 'approvals',
        label: 'Approvals',
        icon: 'inbox',
        badge: String(inbox.rows.length),
        ...(inbox.rows.length > 0 ? { tone: 'amber' as const } : {}),
      },
      {
        key: 'myRequests',
        label: 'My requests',
        icon: 'history',
        badge: String(history.rows.length),
      },
    ],
    [assistant.turns.length, inbox.rows.length, history.rows.length],
  );

  return { assistant, inbox, history, decision, raise, verdict, confirm, decide, navItems };
}

/** What the employee is told once the backend has ruled. */
function describeOutcome(status: string, entitlement: string): string {
  switch (status.toUpperCase()) {
    case 'AUTO_GRANTED':
    case 'GRANTED':
      return `Done — ${entitlement} has been granted. You can use it now.`;
    case 'PENDING_APPROVAL':
      return `Sent. ${entitlement} is now with your manager, and you will see their decision under My requests.`;
    case 'BLOCKED_NO_APPROVER':
      return `${entitlement} needs approval, but no manager is on record for you, so it cannot be routed. Raise it with IAM directly.`;
    case 'PROVISIONING_FAILED':
      return `${entitlement} was approved but could not be applied. It is recorded under My requests so it can be retried.`;
    default:
      return `${entitlement} was recorded with status ${status}.`;
  }
}
