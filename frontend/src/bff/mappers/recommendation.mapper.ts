/**
 * The supervisor's JSON contract -> the recommendation screen's view models.
 *
 * This is where wire vocabulary becomes display vocabulary: `"80%"` becomes a
 * number *and* a label *and* a bar width, `"POL007 (Affinity Threshold - ALLOW)"`
 * splits into a citable rule id and its prose, and every `null` the supervisor
 * emitted for a gap becomes the em-dash the design shows for unknown values.
 */

import { toneForRisk, toneForSodResult } from '@bff/tone';
import type {
  EmployeeProfileVM,
  EntitlementVM,
  OptionalEntitlementVM,
  ProfileFieldVM,
  RecommendationVM,
  SodPanelVM,
  SodRuleVM,
  SupervisorRefusalVM,
} from '@bff/viewmodels';
import type {
  RawEmployeeProfile,
  RawEntitlement,
  RawRecommendationPayload,
  RawSodAnalysis,
  RawSupervisorError,
} from '@infrastructure/types/supervisor';

/** What the design shows in place of a value the agents could not supply. */
const UNKNOWN = '—';

export interface RecommendationContext {
  /** The id the run was requested for; used when the profile omits one. */
  readonly employeeId: string;
  readonly threadId: string;
  readonly receivedAt: number;
}

export function toRecommendation(
  payload: RawRecommendationPayload,
  context: RecommendationContext,
): RecommendationVM {
  const recommended = (payload.recommendedEntitlements ?? []).map(toEntitlement);
  const optional = (payload.optionalEntitlements ?? []).map(toOptionalEntitlement);

  return {
    employeeId: payload.employeeProfile?.employeeId ?? context.employeeId,
    threadId: context.threadId,
    employee: toEmployeeProfile(payload.employeeProfile, context.employeeId),
    recommended,
    optional,
    sod: toSodPanel(payload.separationOfDutiesAnalysis, recommended.length + optional.length),
    provisioningInstructions:
      payload.metadata?.provisioningInstructions ??
      'Submit a formal access request through the IAM workflow; this service does not provision.',
    readOnly: payload.metadata?.readOnly ?? true,
    incompleteNote: describeIncomplete(payload.metadata?.incomplete),
    receivedAt: context.receivedAt,
  };
}

/* -------------------------------------------------------------- profile --- */

function toEmployeeProfile(
  profile: RawEmployeeProfile | null,
  fallbackId: string,
): EmployeeProfileVM {
  const name = profile?.name ?? 'Unknown joiner';
  const employeeId = profile?.employeeId ?? fallbackId;

  const headlineParts = [profile?.role, profile?.level].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  const headlineLead = headlineParts.join(' · ');
  const headline = profile?.department
    ? headlineLead
      ? `${headlineLead} — ${profile.department}`
      : profile.department
    : headlineLead || 'Role and department not reported';

  const fields: ProfileFieldVM[] = [
    { label: 'Manager', value: profile?.managerId ?? UNKNOWN },
    { label: 'Level', value: profile?.level ?? UNKNOWN },
    { label: 'Location', value: profile?.location ?? UNKNOWN },
    { label: 'Cost center', value: profile?.costCenter ?? UNKNOWN },
    { label: 'Start date', value: formatStartDate(profile?.startDate) },
    { label: 'Reported by', value: profile?.source ?? UNKNOWN },
  ];

  return {
    employeeId,
    name,
    initials: toInitials(name),
    statusLabel: profile?.startDate ? describeStartProximity(profile.startDate) : 'Start date unknown',
    headline,
    fields,
  };
}

export function toInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase();
  return `${words[0]?.charAt(0) ?? ''}${words[words.length - 1]?.charAt(0) ?? ''}`.toUpperCase();
}

/** `2026-09-01` -> `1 Sep 2026`. Anything unparseable is passed through. */
export function formatStartDate(iso: string | null | undefined): string {
  if (!iso) return UNKNOWN;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

/** `2026-09-01` -> `1 Sep`, the compact form the queue table uses. */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return UNKNOWN;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(parsed);
}

function describeStartProximity(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return `Starts ${iso}`;
  const days = Math.round((parsed.getTime() - Date.now()) / 86_400_000);
  if (days > 1) return `Pre-hire · starts in ${days} days`;
  if (days === 1) return 'Pre-hire · starts tomorrow';
  if (days === 0) return 'Starts today';
  return `Started ${Math.abs(days)} days ago`;
}

/* --------------------------------------------------------- entitlements --- */

export function toEntitlement(raw: RawEntitlement): EntitlementVM {
  const entitlementId = raw.entitlementId ?? UNKNOWN;
  const application = raw.application ?? UNKNOWN;
  const percent = parseAffinityPercent(raw.peerAffinity);
  const { ruleId, note } = splitPolicyRule(raw.policyRule);

  return {
    entitlementId,
    name: raw.entitlementName ?? entitlementId,
    subtitle: `${entitlementId} · ${application}`,
    application,
    affinityPercent: percent,
    affinityLabel: percent === null ? (raw.peerAffinity ?? UNKNOWN) : `${percent}%`,
    affinityBarWidth: percent === null ? '0%' : `${clamp(percent, 0, 100)}%`,
    peerCountLabel: raw.peerCount ?? UNKNOWN,
    riskLabel: raw.riskRating ?? 'Unrated',
    riskTone: toneForRisk(raw.riskRating),
    riskScoreLabel: raw.riskScore === null ? 'risk not scored' : `risk ${raw.riskScore}`,
    policyRule: ruleId,
    statusLabel: shortenStatus(raw.recommendationStatus),
    note,
  };
}

function toOptionalEntitlement(raw: RawEntitlement): OptionalEntitlementVM {
  const entitlementId = raw.entitlementId ?? UNKNOWN;
  const application = raw.application ?? UNKNOWN;
  const percent = parseAffinityPercent(raw.peerAffinity);
  const affinity = percent === null ? (raw.peerAffinity ?? UNKNOWN) : `${percent}%`;
  const { note } = splitPolicyRule(raw.policyRule);

  return {
    entitlementId,
    name: raw.entitlementName ?? entitlementId,
    subtitle: `${entitlementId} · ${application}`,
    affinityLabel: raw.peerCount ? `${affinity} · ${raw.peerCount}` : affinity,
    riskLabel: raw.riskRating ?? 'Unrated',
    riskTone: toneForRisk(raw.riskRating),
    // For an optional entitlement the policy clause *is* the reason it is optional.
    reason: note || raw.policyRule || 'No reason reported.',
  };
}

/** `"80%"`, `"4/5 (80%)"` or `"80"` -> `80`; anything else -> `null`. */
export function parseAffinityPercent(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /(\d+(?:\.\d+)?)\s*%/.exec(value) ?? /^\s*(\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!match?.[1]) return null;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

/**
 * `"POL007 (Affinity Threshold - ALLOW)"` -> `{ ruleId: "POL007", note: "Affinity Threshold - ALLOW" }`.
 *
 * The supervisor is told to cite the clause but not how to punctuate it, so a
 * bare id and a bare sentence both have to survive this.
 */
export function splitPolicyRule(value: string | null | undefined): {
  ruleId: string;
  note: string;
} {
  if (!value) return { ruleId: UNKNOWN, note: '' };

  const parenthesised = /^([^(]+?)\s*\(([^)]*)\)\s*$/.exec(value.trim());
  if (parenthesised?.[1] && parenthesised[2] !== undefined) {
    return { ruleId: parenthesised[1].trim(), note: parenthesised[2].trim() };
  }

  // A leading identifier token such as `POL-BR-02 — birthright for Finance`.
  const leadingId = /^([A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)*)\s*[—:-]\s*(.+)$/.exec(value.trim());
  if (leadingId?.[1] && leadingId[2]) {
    return { ruleId: leadingId[1], note: leadingId[2].trim() };
  }

  // A bare identifier with no prose attached.
  if (/^[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)*$/.test(value.trim())) {
    return { ruleId: value.trim(), note: '' };
  }

  return { ruleId: UNKNOWN, note: value.trim() };
}

/** `"Recommended (Birthright)"` -> `"Birthright"`. */
function shortenStatus(status: string | null | undefined): string {
  if (!status) return 'Recommended';
  const parenthesised = /\(([^)]+)\)/.exec(status);
  return parenthesised?.[1]?.trim() ?? status.trim();
}

/* ------------------------------------------------------------------ SoD --- */

export function toSodPanel(sod: RawSodAnalysis | null, fallbackCount: number): SodPanelVM {
  const evaluated = sod?.evaluatedEntitlements ?? [];
  const evaluatedCount = evaluated.length > 0 ? evaluated.length : fallbackCount;
  const conflictsFound = sod?.conflictsFound ?? false;

  const rules: SodRuleVM[] = (sod?.conflicts ?? []).map((conflict, index) => {
    const ruleId = conflict.ruleId ?? conflict.rule ?? `Rule ${index + 1}`;
    return {
      key: `${ruleId}-${index}`,
      ruleId,
      severityLabel: conflict.severity ?? 'Unrated',
      tone: toneForRisk(conflict.severity),
      text:
        conflict.description ??
        (conflict.entitlements?.length
          ? `Triggered by ${conflict.entitlements.join(', ')}.`
          : 'No description reported.'),
    };
  });

  return {
    resultLabel: sod?.result ?? 'Not run',
    resultTone: sod ? toneForSodResult(sod.result) : 'neutral',
    scopeLabel: `${evaluatedCount} ${evaluatedCount === 1 ? 'entitlement' : 'entitlements'} evaluated`,
    summary: summariseSod(sod, conflictsFound, rules.length),
    rules,
    conflictsFound,
  };
}

function summariseSod(
  sod: RawSodAnalysis | null,
  conflictsFound: boolean,
  ruleCount: number,
): string {
  if (!sod) {
    return 'No separation-of-duties check was reported for this set.';
  }
  const attribution = sod.source ? ` Reported by the ${sod.source}.` : '';
  if (conflictsFound) {
    return ruleCount > 0
      ? `The evaluated set breaks ${ruleCount} separation-of-duties ${
          ruleCount === 1 ? 'rule' : 'rules'
        }. The entitlement stays listed where it belongs; resolving the conflict is a decision for the access request.${attribution}`
      : `A separation-of-duties conflict was reported for the evaluated set, without naming the rule.${attribution}`;
  }
  return `No conflict-of-interest rule is broken by the evaluated set.${attribution}`;
}

function describeIncomplete(incomplete: unknown): string | null {
  if (incomplete === null || incomplete === undefined) return null;
  if (typeof incomplete === 'string') return incomplete;
  try {
    return JSON.stringify(incomplete);
  } catch {
    return 'The supervisor reported that part of this run could not be completed.';
  }
}

/* -------------------------------------------------------------- refusal --- */

const REFUSAL_TITLES: Record<string, string> = {
  MISSING_EMPLOYEE_ID: 'An employee ID is required',
  EMPLOYEE_NOT_FOUND: 'No joiner matched that ID',
  READ_ONLY: 'This service cannot make changes',
  INCOMPLETE_DATA: 'The recommendation could not be completed',
};

export function toSupervisorRefusal(
  error: RawSupervisorError['error'],
  threadId: string,
): SupervisorRefusalVM {
  return {
    code: error.code,
    title: REFUSAL_TITLES[error.code] ?? 'The supervisor could not answer',
    message: error.message,
    threadId,
  };
}

/* ------------------------------------------------- provisioning payload --- */

/**
 * Re-emit the payload for the "View JSON" panel, narrowed to the entitlements
 * the operator left selected.
 *
 * This is what would be handed to the IAM request workflow, so it is built from
 * the supervisor's own values rather than from the view models.
 */
export function toProvisioningPayload(
  payload: RawRecommendationPayload,
  selectedIds: ReadonlySet<string>,
): string {
  const recommended = (payload.recommendedEntitlements ?? []).filter(
    (entitlement) => entitlement.entitlementId !== null && selectedIds.has(entitlement.entitlementId),
  );

  return JSON.stringify(
    {
      employeeProfile: payload.employeeProfile,
      recommendedEntitlements: recommended,
      optionalEntitlements: payload.optionalEntitlements ?? [],
      separationOfDutiesAnalysis: payload.separationOfDutiesAnalysis,
      metadata: payload.metadata,
    },
    null,
    2,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
