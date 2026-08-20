/**
 * The design's five button treatments, as one component.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';

import styles from '@presentation/atoms/atoms.module.css';

export type ButtonVariant = 'primary' | 'outline' | 'quiet' | 'card' | 'ghost';
export type ButtonSize = 'lg' | 'md' | 'sm' | 'xs';

const SIZE_CLASS: Record<ButtonSize, string> = {
  lg: styles.sizeLg ?? '',
  md: styles.sizeMd ?? '',
  sm: styles.sizeSm ?? '',
  xs: styles.sizeXs ?? '',
};

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: styles.primary ?? '',
  outline: styles.outline ?? '',
  quiet: styles.quiet ?? '',
  card: styles.card ?? '',
  ghost: styles.ghost ?? '',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Dims the button and marks it busy for assistive technology. */
  readonly busy?: boolean;
  readonly children?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  busy = false,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    busy ? styles.busy : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type="button" className={classes} aria-busy={busy || undefined} {...rest}>
      {children}
    </button>
  );
}
