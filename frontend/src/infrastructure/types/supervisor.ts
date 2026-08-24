/**
 * The supervisor's structured output contract.
 *
 * `POST /chat` returns `answer` as a *string*. The supervisor prompt
 * (app/agents/prompts.py: SUPERVISOR_PROMPT) requires that string to be one
 * JSON object and nothing else, in one of the two shapes below. These types
 * describe that object; parsing and validating it is the BFF's job
 * (bff/parse/supervisorPayload.ts).
 *
 * Every field is typed as nullable because the prompt instructs the supervisor
 * to emit `null` wherever a worker could not supply a value — a `null` here is
 * a reported gap, not a parse failure.
 */

/** app/agents/prompts.py — the `employeeProfile` block. */
export interface RawEmployeeProfile {
  readonly name: string | null;
  readonly employeeId: string | null;
  readonly department: string | null;
  readonly role: string | null;
  readonly level: string | null;
  readonly location: string | null;
  readonly managerId: string | null;
  readonly costCenter: string | null;
  /** ISO-8601 date, e.g. "2026-08-01". */
  readonly startDate: string | null;
  /** Which worker the section's facts came from. */
  readonly source: string | null;
}

/** One entry of `recommendedEntitlements` or `optionalEntitlements`. */
export interface RawEntitlement {
  readonly entitlementId: string | null;
  readonly entitlementName: string | null;
  readonly application: string | null;
  /** Free text as the peer affinity agent reported it, e.g. "80%". */
  readonly peerAffinity: string | null;
  /** The counts behind the proportion, e.g. "4/5". */
  readonly peerCount: string | null;
  readonly riskRating: string | null;
  /** Null unless the entitlements agent reported a number. */
  readonly riskScore: number | null;
  readonly policyRule: string | null;
  readonly recommendationStatus: string | null;
}

/** app/agents/prompts.py — the `separationOfDutiesAnalysis` block. */
export interface RawSodAnalysis {
  readonly result: string | null;
  readonly evaluatedEntitlements: readonly string[] | null;
  readonly conflictsFound: boolean | null;
  readonly source: string | null;
  /** Present when the SoD agent reported broken rules. */
  readonly conflicts?: readonly RawSodConflict[] | null;
}

export interface RawSodConflict {
  readonly ruleId?: string | null;
  readonly rule?: string | null;
  readonly severity?: string | null;
  readonly description?: string | null;
  readonly entitlements?: readonly string[] | null;
}

export interface RawRecommendationMetadata {
  readonly readOnly: boolean | null;
  readonly provisioningInstructions: string | null;
  /** Set when the run finished with gaps; free-form per the prompt. */
  readonly incomplete?: unknown;
}

/** The success shape of the supervisor's reply. */
export interface RawRecommendationPayload {
  readonly employeeProfile: RawEmployeeProfile | null;
  readonly recommendedEntitlements: readonly RawEntitlement[] | null;
  readonly optionalEntitlements: readonly RawEntitlement[] | null;
  readonly separationOfDutiesAnalysis: RawSodAnalysis | null;
  readonly metadata: RawRecommendationMetadata | null;
}

/** The codes the supervisor prompt enumerates for its refusal shape. */
export type SupervisorErrorCode =
  | 'MISSING_EMPLOYEE_ID'
  | 'EMPLOYEE_NOT_FOUND'
  | 'READ_ONLY'
  | 'INCOMPLETE_DATA';

/** The failure shape of the supervisor's reply. */
export interface RawSupervisorError {
  readonly error: {
    readonly code: SupervisorErrorCode | string;
    readonly message: string;
  };
}

/* ----------------------------------------------------- employee mode --- */

/**
 * What the assistant proposes — a *proposal*, never a decision.
 *
 * The supervisor emits this after working out which entitlement the employee
 * means. It carries the model's own reading of the rules, which the UI
 * deliberately does not render: `POST /requests/analyze` is asked the same
 * question and its answer is what the confirmation card shows. Where the two
 * disagree, the backend is right.
 */
export interface RawRequestIntent {
  readonly subjectId: string | null;
  readonly entitlementId: string | null;
  readonly entitlementName: string | null;
  readonly justification: string | null;
  readonly approvalRequired: boolean | null;
  readonly policyBasis: string | null;
  readonly riskScore: number | null;
  readonly sodConflicts: readonly string[] | null;
  /** True only once the entitlement is unambiguous and a reason was captured. */
  readonly readyToSubmit: boolean | null;
}

/**
 * The employee-mode reply shape.
 *
 * Distinguished from the recommendation by the literal `mode` key, so the HR
 * narrowing in bff/parse/supervisorPayload.ts is unaffected.
 */
export interface RawEmployeeReply {
  readonly mode: 'employee';
  /** Prose written for the employee to read directly. */
  readonly reply: string;
  /** Null while the assistant is still clarifying. */
  readonly requestIntent: RawRequestIntent | null;
}

/** Any shape, before the BFF has decided which one arrived. */
export type RawSupervisorReply =
  | RawRecommendationPayload
  | RawSupervisorError
  | RawEmployeeReply;
