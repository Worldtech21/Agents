/**
 * The single BFF entry point for a supervisor run.
 *
 * A run has four possible endings and all four are *answers*, not failures: a
 * recommendation, an employee-mode reply, a documented refusal
 * (`MISSING_EMPLOYEE_ID` and friends), or a reply that did not honour the JSON
 * contract. React Query only ever sees a rejected promise for transport
 * failures; everything the supervisor itself said arrives here as data.
 */

import {
  toRecommendation,
  toSupervisorRefusal,
  type RecommendationContext,
} from '@bff/mappers/recommendation.mapper';
import { toRequestIntent } from '@bff/mappers/requests.mapper';
import { parseSupervisorAnswer } from '@bff/parse/supervisorPayload';
import type { RecommendationVM, RequestIntentVM, SupervisorRefusalVM } from '@bff/viewmodels';
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
    case 'employee':
      // An HR surface asked, and employee mode answered. That means the run
      // carried the wrong metadata; report it rather than render it as prose.
      return {
        kind: 'unparseable',
        reason:
          'The supervisor replied in employee self-service mode to a recommendation request.',
        raw: answer,
        threadId: context.threadId,
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

/* ------------------------------------------------------- employee mode --- */

/**
 * The employee assistant's endings, kept separate from the HR ones.
 *
 * The two modes share a supervisor and a parser but not an outcome type: an
 * employee reply is not a recommendation with fields missing, and folding it
 * into `RecommendationOutcome` would put a branch every HR call site has to
 * handle and can never see.
 */
export type AssistantOutcome =
  | {
      readonly kind: 'reply';
      /** Prose written for the employee, rendered as the chat bubble. */
      readonly reply: string;
      /**
       * What the assistant proposed. A proposal only — the confirmation card is
       * drawn from `POST /requests/analyze`, never from this.
       */
      readonly intent: RequestIntentVM | null;
    }
  | { readonly kind: 'refusal'; readonly view: SupervisorRefusalVM }
  | { readonly kind: 'unparseable'; readonly reason: string; readonly raw: string };

/** Parse an assistant answer for the employee console. */
export function toAssistantOutcome(answer: string, threadId: string): AssistantOutcome {
  const parsed = parseSupervisorAnswer(answer);

  switch (parsed.kind) {
    case 'employee':
      return {
        kind: 'reply',
        reply: parsed.reply.reply,
        intent: toRequestIntent(parsed.reply.requestIntent),
      };
    case 'error':
      return { kind: 'refusal', view: toSupervisorRefusal(parsed.error, threadId) };
    case 'recommendation':
      // The supervisor fell back to the HR contract — the employee preamble did
      // not take. Say so plainly rather than showing an employee a JSON dump.
      return {
        kind: 'unparseable',
        reason: 'The assistant replied with an onboarding recommendation rather than an answer.',
        raw: answer,
      };
    case 'unparseable':
      return { kind: 'unparseable', reason: parsed.reason, raw: parsed.raw };
  }
}
