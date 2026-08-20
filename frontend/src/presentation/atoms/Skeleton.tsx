/**
 * Loading placeholders.
 *
 * Shaped to the content they stand in for, so the layout does not jump when
 * real data lands. The design's `hint-placeholder-count` attributes are what
 * decided the default row counts used by the screen-level skeletons.
 */

import type { CSSProperties } from 'react';

import styles from '@presentation/atoms/atoms.module.css';

export interface SkeletonProps {
  readonly width?: string;
  readonly height?: string;
  readonly shape?: 'line' | 'pill' | 'card';
  readonly className?: string;
  readonly style?: CSSProperties;
}

const SHAPE_CLASS = {
  line: '',
  pill: styles.skeletonPill ?? '',
  card: styles.skeletonCard ?? '',
} as const;

export function Skeleton({
  width = '100%',
  height = '14px',
  shape = 'line',
  className,
  style,
}: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={[styles.skeleton, SHAPE_CLASS[shape], className ?? ''].filter(Boolean).join(' ')}
      style={{ display: 'block', width, height, ...style }}
    />
  );
}

/** Announce a loading region once, rather than one message per placeholder. */
export function SkeletonRegion({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
