/**
 * The bordered pill used for citations and small metadata badges.
 */

import type { ReactNode } from 'react';

import styles from '@presentation/atoms/atoms.module.css';

export interface ChipProps {
  readonly children: ReactNode;
  readonly title?: string;
  readonly className?: string;
}

export function Chip({ children, title, className }: ChipProps) {
  return (
    <span className={[styles.chip, className ?? ''].filter(Boolean).join(' ')} title={title}>
      {children}
    </span>
  );
}
