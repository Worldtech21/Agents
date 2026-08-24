/**
 * Parse the supervisor's answer string into its structured contract.
 *
 * `POST /chat` returns `answer: string`. The supervisor prompt requires that
 * string to be one JSON object and nothing else, but a model is not a schema
 * validator: this module treats the answer as untrusted text, recovers the
 * object when it can, and reports a typed failure when it cannot — it never
 * throws into a React render.
 */

import type {
  RawEmployeeReply,
  RawEntitlement,
  RawRecommendationPayload,
  RawRequestIntent,
  RawSodConflict,
  RawSupervisorError,
} from '@infrastructure/types/supervisor';

export type SupervisorParseResult =
  | { readonly kind: 'recommendation'; readonly payload: RawRecommendationPayload }
  | { readonly kind: 'employee'; readonly reply: RawEmployeeReply }
  | { readonly kind: 'error'; readonly error: RawSupervisorError['error'] }
  | { readonly kind: 'unparseable'; readonly reason: string; readonly raw: string };

/** Parse an answer string into one of the supervisor's documented shapes. */
export function parseSupervisorAnswer(answer: string): SupervisorParseResult {
  const text = (answer ?? '').trim();
  if (!text) {
    return { kind: 'unparseable', reason: 'The supervisor returned an empty answer.', raw: '' };
  }

  const candidate = extractJsonObject(text);
  if (candidate === null) {
    return {
      kind: 'unparseable',
      reason: 'The supervisor replied with text rather than the JSON object it is required to emit.',
      raw: text,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    return {
      kind: 'unparseable',
      reason: `The supervisor's reply was not valid JSON: ${
        error instanceof Error ? error.message : 'unknown parse error'
      }`,
      raw: text,
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      kind: 'unparseable',
      reason: 'The supervisor returned JSON that is not an object.',
      raw: text,
    };
  }

  const record = parsed as Record<string, unknown>;

  // Checked first: employee mode is the one shape that announces itself, so a
  // reply carrying `mode` is never mistaken for a recommendation with gaps.
  if (record.mode === 'employee') {
    return { kind: 'employee', reply: normaliseEmployeeReply(record) };
  }

  if (isSupervisorError(record)) {
    const error = record.error as Record<string, unknown>;
    return {
      kind: 'error',
      error: {
        code: typeof error.code === 'string' ? error.code : 'INCOMPLETE_DATA',
        message:
          typeof error.message === 'string'
            ? error.message
            : 'The supervisor could not produce a recommendation.',
      },
    };
  }

  if (!hasRecommendationShape(record)) {
    return {
      kind: 'unparseable',
      reason:
        'The supervisor returned a JSON object with none of the fields a recommendation is required to carry.',
      raw: text,
    };
  }

  return { kind: 'recommendation', payload: normalisePayload(record) };
}

/* ------------------------------------------------------------ narrowing --- */

function isSupervisorError(record: Record<string, unknown>): boolean {
  const error = record.error;
  return typeof error === 'object' && error !== null && !Array.isArray(error);
}

function hasRecommendationShape(record: Record<string, unknown>): boolean {
  return (
    'employeeProfile' in record ||
    'recommendedEntitlements' in record ||
    'optionalEntitlements' in record ||
    'separationOfDutiesAnalysis' in record
  );
}

/**
 * Coerce every field to the declared type, substituting `null`/`[]` for
 * anything missing or of the wrong type. Downstream mappers can then read the
 * payload without re-checking each field.
 */
function normalisePayload(record: Record<string, unknown>): RawRecommendationPayload {
  const profile = asRecord(record.employeeProfile);
  const sod = asRecord(record.separationOfDutiesAnalysis);
  const metadata = asRecord(record.metadata);

  return {
    employeeProfile: profile
      ? {
          name: asString(profile.name),
          employeeId: asString(profile.employeeId),
          department: asString(profile.department),
          role: asString(profile.role),
          level: asString(profile.level),
          location: asString(profile.location),
          // The prompt's example spells this `managerId`; accept `manager` too.
          managerId: asString(profile.managerId) ?? asString(profile.manager),
          costCenter: asString(profile.costCenter),
          startDate: asString(profile.startDate),
          source: asString(profile.source),
        }
      : null,
    recommendedEntitlements: asEntitlements(record.recommendedEntitlements),
    optionalEntitlements: asEntitlements(record.optionalEntitlements),
    separationOfDutiesAnalysis: sod
      ? {
          result: asString(sod.result),
          evaluatedEntitlements: asStringArray(sod.evaluatedEntitlements),
          conflictsFound: typeof sod.conflictsFound === 'boolean' ? sod.conflictsFound : null,
          source: asString(sod.source),
          conflicts: asConflicts(sod.conflicts),
        }
      : null,
    metadata: metadata
      ? {
          readOnly: typeof metadata.readOnly === 'boolean' ? metadata.readOnly : null,
          provisioningInstructions: asString(metadata.provisioningInstructions),
          incomplete: metadata.incomplete ?? null,
        }
      : null,
  };
}

/**
 * Coerce an employee-mode reply.
 *
 * `requestIntent` is dropped unless it names an entitlement: an intent that
 * cannot identify what was asked for is not something to put a confirm button
 * under, and the prompt requires null in that case anyway.
 */
function normaliseEmployeeReply(record: Record<string, unknown>): RawEmployeeReply {
  const intent = asRecord(record.requestIntent);
  const entitlementName = intent ? asString(intent.entitlementName) : null;
  const entitlementId = intent ? asString(intent.entitlementId) : null;

  return {
    mode: 'employee',
    reply: asString(record.reply) ?? '',
    requestIntent:
      intent && (entitlementName || entitlementId)
        ? ({
            subjectId: asString(intent.subjectId),
            entitlementId,
            entitlementName,
            justification: asString(intent.justification),
            approvalRequired:
              typeof intent.approvalRequired === 'boolean' ? intent.approvalRequired : null,
            policyBasis: asString(intent.policyBasis),
            riskScore: typeof intent.riskScore === 'number' ? intent.riskScore : null,
            sodConflicts: asStringArray(intent.sodConflicts),
            readyToSubmit:
              typeof intent.readyToSubmit === 'boolean' ? intent.readyToSubmit : null,
          } satisfies RawRequestIntent)
        : null,
  };
}

function asEntitlements(value: unknown): readonly RawEntitlement[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry) => ({
    entitlementId: asString(entry.entitlementId),
    entitlementName: asString(entry.entitlementName) ?? asString(entry.name),
    application: asString(entry.application),
    peerAffinity: asString(entry.peerAffinity) ?? asNumberAsString(entry.peerAffinity),
    peerCount: asString(entry.peerCount),
    riskRating: asString(entry.riskRating),
    riskScore: typeof entry.riskScore === 'number' ? entry.riskScore : null,
    policyRule: asString(entry.policyRule),
    recommendationStatus: asString(entry.recommendationStatus),
  }));
}

function asConflicts(value: unknown): readonly RawSodConflict[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(isRecord).map((entry) => ({
    ruleId: asString(entry.ruleId) ?? asString(entry.rule_id),
    rule: asString(entry.rule),
    severity: asString(entry.severity),
    description: asString(entry.description) ?? asString(entry.text),
    entitlements: asStringArray(entry.entitlements),
  }));
}

/* ------------------------------------------------------------- coercion --- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumberAsString(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? `${value}%` : null;
}

function asStringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Recover the JSON object from an answer that may carry stray prose.
 *
 * Handles the fenced-block case first (```json … ```), then falls back to the
 * outermost balanced `{…}` span, tracking string literals and escapes so a
 * brace inside a quoted value cannot end the scan early.
 */
function extractJsonObject(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const source = fenced?.[1]?.trim() ?? text;

  const start = source.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      if (inString) escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return null;
}
