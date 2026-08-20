/**
 * The single BFF entry point for a supervisor run.
 *
 * A run has three possible endings and all three are *answers*, not failures:
 * a recommendation, a documented refusal (`MISSING_EMPLOYEE_ID` and friends),
 * or a reply that did not honour the JSON contract. React Query only ever sees
 * a rejected promise for transport failures; everything the supervisor itself
 * said arrives here as data.
 */

import {
  toRecommendation,
  toSupervisorRefusal,
  type RecommendationContext,
} from '@bff/mappers/recommendation.mapper';
import { parseSupervisorAnswer } from '@bff/parse/supervisorPayload';
import type { RecommendationVM, SupervisorRefusalVM } from '@bff/viewmodels';
import type { RawRecommendationPayload } from '@infrastructure/types/supervisor';

export type RecommendationOutcome =
  | {
      readonly kind: 'recommendation';
      readonly view: RecommendationVM;
      /** Kept so the JSON panel can echo the supervisor's own values. */
      readonly payload: RawRecommendationPayload;
    }
  | { readonly kind: 'refusal'; readonly view: SupervisorRefusalVM }
  | {
      readonly kind: 'unparseable';
      readonly reason: string;
      readonly raw: string;
      readonly threadId: string;
    };

/** Parse and map a supervisor answer in one step. */
export function toRecommendationOutcome(
  answer: string,
  context: RecommendationContext,
): RecommendationOutcome {
  const parsed = parseSupervisorAnswer(answer);

  switch (parsed.kind) {
    case 'recommendation':
      return {
        kind: 'recommendation',
        view: toRecommendation(parsed.payload, context),
        payload: parsed.payload,
      };
    case 'error':
      return { kind: 'refusal', view: toSupervisorRefusal(parsed.error, context.threadId) };
    case 'unparseable':
      return {
        kind: 'unparseable',
        reason: parsed.reason,
        raw: parsed.raw,
        threadId: context.threadId,
      };
  }
}

/** Convenience narrowing for callers that only care about the success case. */
export function asRecommendation(
  outcome: RecommendationOutcome | undefined,
): RecommendationVM | null {
  return outcome?.kind === 'recommendation' ? outcome.view : null;
}
