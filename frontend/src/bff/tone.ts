/**
 * Semantic colour resolution.
 *
 * The design assigns colour by meaning — risk rating, run state, SoD outcome —
 * never by literal value. Every such decision is made here so a component only
 * ever receives a `Tone`, and the CSS variable behind that tone is the design's.
 */

import type { Tone } from '@bff/viewmodels';

/** The CSS custom property each tone maps to (presentation/styles/tokens.css). */
export const TONE_VARIABLE: Record<Tone, string> = {
  blue: 'var(--blue)',
  green: 'var(--green)',
  amber: 'var(--amber)',
  red: 'var(--red)',
  neutral: 'var(--ink-48)',
};

/**
 * Risk rating -> tone, matching `RISK_TONE` in Access Advisor.dc.html.
 *
 * The entitlements agent reports the rating as stored, so casing and wording
 * vary; anything unrecognised stays neutral rather than being guessed at.
 */
export function toneForRisk(rating: string | null | undefined): Tone {
  switch ((rating ?? '').trim().toLowerCase()) {
    case 'low':
      return 'green';
    case 'medium':
    case 'moderate':
      return 'amber';
    case 'high':
    case 'critical':
    case 'very high':
      return 'red';
    default:
      return 'neutral';
  }
}

/** SoD outcome -> tone. Anything that is not an explicit pass reads as a failure. */
export function toneForSodResult(result: string | null | undefined): Tone {
  const normalised = (result ?? '').trim().toLowerCase();
  if (!normalised) return 'neutral';
  if (normalised === 'pass' || normalised === 'passed' || normalised === 'clean') return 'green';
  return 'red';
}

/** Peer-affinity share -> tone, using the same thresholds the design implies. */
export function toneForAffinity(percent: number | null): Tone {
  if (percent === null) return 'neutral';
  if (percent >= 80) return 'green';
  if (percent >= 60) return 'blue';
  return 'amber';
}
