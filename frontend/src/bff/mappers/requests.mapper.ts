/**
 * Access requests -> inbox rows, history rows and the confirmation card.
 *
 * Two audiences read the same record and need different words for it. A
 * manager looking at their inbox sees "Sneha asked for this"; the requester
 * looking at their own history sees "waiting on Ramesh". `viewerId` is what
 * decides which reading applies, so the status label is written once here
 * rather than branched inside a component.
 */

import { toneForRequestStatus, toneForRisk } from '@bff/tone';
import type {
  AccessRequestVM,
  CatalogEntryVM,
  RequestIntentVM,
  Tone,
  VerdictVM,
} from '@bff/viewmodels';
import type {
  AccessRequestDTO,
  CatalogEntryDTO,
  VerdictDTO,
} from '@infrastructure/types/api';
import type { RawRequestIntent } from '@infrastructure/types/supervisor';

const UNKNOWN = '—';

/** Statuses after which nothing further can happen to a request. */
const SETTLED = new Set(['AUTO_GRANTED', 'GRANTED', 'REJECTED']);
/** Statuses still waiting on somebody. */
const PENDING = new Set(['PENDING_APPROVAL', 'APPROVED', 'BLOCKED_NO_APPROVER']);

export interface RequestViewContext {
  /** The acting persona. Decides whether a row reads as "yours" or "theirs". */
  readonly viewerId: string;
  /** Display names by actor id, so a row can say "Ramesh" rather than "EMP001". */
  readonly names?: ReadonlyMap<string, string>;
}

export function toRequestRows(
  dtos: readonly AccessRequestDTO[],
  context: RequestViewContext,
): AccessRequestVM[] {
  return dtos.map((dto) => toRequestRow(dto, context));
}

export function toRequestRow(
  dto: AccessRequestDTO,
  context: RequestViewContext,
): AccessRequestVM {
  const status = dto.status.trim().toUpperCase();
  const viewer = context.viewerId.trim().toUpperCase();

  return {
    requestId: dto.request_id,
    entitlementName: dto.entitlement_name || UNKNOWN,
    application: dto.application || UNKNOWN,
    statusLabel: toStatusLabel(status, dto, viewer, context),
    statusTone: toneForRequestStatus(status),
    isPending: PENDING.has(status),
    isSettled: SETTLED.has(status),
    riskLabel: toRiskLabel(dto.risk_category, dto.risk_score),
    riskTone: toneForRisk(dto.risk_category),
    policyBasis: dto.policy_basis,
    sodConflicts: dto.sod_conflicts,
    // Suppressed when the request is about the viewer: "for you" is noise on
    // every row of your own history.
    subjectLabel:
      dto.subject_id.toUpperCase() === viewer
        ? ''
        : `for ${nameFor(dto.subject_id, context)}`,
    requesterLabel: nameFor(dto.requester_id, context),
    approverLabel: dto.approver_id ? nameFor(dto.approver_id, context) : '',
    justification: dto.justification,
    decisionNote: dto.decision_note,
    timestampLabel: toTimestampLabel(dto),
  } satisfies AccessRequestVM;
}

/**
 * The verdict, phrased for the person about to act on it.
 *
 * Everything here comes from `POST /requests/analyze` — never from the
 * assistant's own account of the rules. That is the point of the card.
 */
export function toVerdict(
  dto: VerdictDTO,
  context: RequestViewContext & { readonly subjectIsViewer?: boolean },
): VerdictVM {
  const approver = dto.approver_id ? nameFor(dto.approver_id, context) : '';
  const risk = toRiskLabel(dto.risk_category, dto.risk_score);
  const summary = toVerdictSummary(dto, approver, risk);

  return {
    subjectId: dto.subject_id,
    entitlementId: dto.entitlement_id,
    entitlementName: dto.entitlement_name,
    application: dto.application,
    riskLabel: risk,
    riskTone: toneForRisk(dto.risk_category),
    approvalRequired: dto.approval_required,
    policyBasis: dto.policy_basis,
    sodConflicts: dto.sod_conflicts.map(
      (conflict) => `${conflict.sod_id} · conflicts with ${conflict.conflicting_entitlement}`,
    ),
    alreadyHeld: dto.already_held,
    approverId: dto.approver_id,
    approverMissing: dto.approver_missing,
    actionLabel: toActionLabel(dto, approver),
    // Nothing to submit when they hold it already, or when approval is needed
    // and there is nobody to send it to.
    actionDisabled: dto.already_held || dto.approver_missing,
    summary: summary.text,
    summaryTone: summary.tone,
  } satisfies VerdictVM;
}

/** What the assistant proposed, before the backend has been asked. */
export function toRequestIntent(raw: RawRequestIntent | null): RequestIntentVM | null {
  if (!raw) return null;
  return {
    entitlementId: raw.entitlementId,
    entitlementName: raw.entitlementName,
    justification: raw.justification ?? '',
    readyToSubmit: raw.readyToSubmit === true,
  } satisfies RequestIntentVM;
}

export function toCatalogEntries(dtos: readonly CatalogEntryDTO[]): CatalogEntryVM[] {
  return dtos.map((dto) => ({
    entitlementId: dto.entitlement_id,
    entitlementName: dto.entitlement_name,
    application: dto.application,
    riskLabel: toRiskLabel(dto.risk_category, dto.risk_score),
    riskTone: toneForRisk(dto.risk_category),
    approvalRequired: dto.approval_required,
    approvalLabel: dto.approval_required ? 'Needs approval' : 'Granted on request',
  } satisfies CatalogEntryVM));
}

/* ----------------------------------------------------------------- copy --- */

function toStatusLabel(
  status: string,
  dto: AccessRequestDTO,
  viewer: string,
  context: RequestViewContext,
): string {
  switch (status) {
    case 'AUTO_GRANTED':
      return 'Granted';
    case 'GRANTED':
      return 'Granted';
    case 'APPROVED':
      return 'Approved — applying';
    case 'REJECTED':
      return 'Refused';
    case 'PROVISIONING_FAILED':
      return 'Grant failed';
    case 'BLOCKED_NO_APPROVER':
      return 'No approver on record';
    case 'PENDING_APPROVAL':
      // The same row, read from either end of the decision.
      return dto.approver_id.toUpperCase() === viewer
        ? 'Waiting on you'
        : `Waiting on ${nameFor(dto.approver_id, context)}`;
    default:
      return status || UNKNOWN;
  }
}

function toVerdictSummary(
  dto: VerdictDTO,
  approver: string,
  risk: string,
): { text: string; tone: Tone } {
  if (dto.already_held) {
    return { text: `You already have ${dto.entitlement_name}.`, tone: 'neutral' };
  }
  if (!dto.approval_required) {
    return {
      text: `${dto.entitlement_name} is ${risk.toLowerCase()} and needs no approval — it can be granted straight away.`,
      tone: 'green',
    };
  }
  if (dto.approver_missing) {
    return {
      text: `${dto.entitlement_name} needs approval, but no manager is on record — this cannot be routed. Raise it with IAM.`,
      tone: 'red',
    };
  }
  return {
    text: `${dto.entitlement_name} is ${risk.toLowerCase()} and needs approval from ${approver}.`,
    tone: 'amber',
  };
}

function toActionLabel(dto: VerdictDTO, approver: string): string {
  if (dto.already_held) return 'You already hold this';
  if (dto.approver_missing) return 'Cannot be routed';
  return dto.approval_required ? `Send to ${approver}` : 'Request access';
}

function toRiskLabel(category: string, score: number | null): string {
  if (!category && score === null) return 'Unscored';
  if (score === null) return category;
  return category ? `${category} (${score})` : `Risk ${score}`;
}

function nameFor(actorId: string, context: RequestViewContext): string {
  if (!actorId) return UNKNOWN;
  return context.names?.get(actorId.toUpperCase()) ?? actorId;
}

/**
 * The most recent thing that happened, since a row shows one date not three.
 *
 * Granted beats decided beats raised: a reader wants to know where it got to,
 * not when it started.
 */
function toTimestampLabel(dto: AccessRequestDTO): string {
  const stamp = dto.granted_at || dto.decided_at || dto.created_at;
  if (!stamp) return '';
  const parsed = new Date(stamp);
  if (Number.isNaN(parsed.getTime())) return stamp;
  return parsed.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
