/**
 * The design's dot-plus-label status marker.
 *
 * Colour arrives as a `Tone` from the BFF — a component never decides what
 * "high risk" looks like.
 */

import { TONE_VARIABLE } from '@bff/tone';
import type { Tone } from '@bff/viewmodels';
import styles from '@presentation/atoms/atoms.module.css';

export interface StatusDotProps {
  readonly tone: Tone;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly pulsing?: boolean;
  readonly className?: string;
}

const SIZE_CLASS = {
  sm: styles.dotSm ?? '',
  md: '',
  lg: styles.dotLg ?? '',
} as const;

export function StatusDot({ tone, size = 'md', pulsing = false, className }: StatusDotProps) {
  const classes = [styles.dot, SIZE_CLASS[size], pulsing ? styles.pulsing : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return <span className={classes} style={{ color: TONE_VARIABLE[tone] }} aria-hidden="true" />;
}

export interface StatusLabelProps {
  readonly tone: Tone;
  readonly label: string;
  readonly pulsing?: boolean;
  readonly className?: string;
}

/** A dot and its label, coloured together — the design's row-state marker. */
export function StatusLabel({ tone, label, pulsing = false, className }: StatusLabelProps) {
  return (
    <span
      className={[styles.statusLabel, className ?? ''].filter(Boolean).join(' ')}
      style={{ color: TONE_VARIABLE[tone] }}
    >
      <StatusDot tone={tone} pulsing={pulsing} />
      {label}
    </span>
  );
}
