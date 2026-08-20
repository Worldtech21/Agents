/**
 * The 4px affinity bar used in the queue table and the entitlement cards.
 */

import styles from '@presentation/atoms/atoms.module.css';

export interface ProgressBarProps {
  /** Pre-formatted width from the BFF, e.g. `"80%"`. */
  readonly width: string;
  readonly label: string;
  /** Numeric value for assistive technology; omitted when not reported. */
  readonly value?: number | null;
  readonly className?: string;
}

export function ProgressBar({ width, label, value = null, className }: ProgressBarProps) {
  return (
    <div
      className={[styles.track, className ?? ''].filter(Boolean).join(' ')}
      role="progressbar"
      aria-label={label}
      aria-valuenow={value ?? undefined}
      aria-valuemin={value === null ? undefined : 0}
      aria-valuemax={value === null ? undefined : 100}
      aria-valuetext={value === null ? 'not reported' : `${value}%`}
    >
      <div className={styles.fill} style={{ width }} />
    </div>
  );
}
