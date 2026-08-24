/**
 * The icon set, transcribed from the design's `ICONS` map.
 *
 * Every glyph is a single stroked path at the design's 1.6 stroke weight, so
 * icons inherit `currentColor` and need no per-theme handling.
 */

import type { CSSProperties } from 'react';

export type IconName =
  | 'queue'
  | 'report'
  | 'chat'
  | 'play'
  | 'spin'
  | 'sun'
  | 'moon'
  | 'shield'
  | 'search'
  | 'check'
  | 'plus'
  | 'close'
  | 'replay'
  | 'alert'
  | 'user'
  | 'inbox'
  | 'history'
  | 'checkCircle';

const PATHS: Record<IconName, readonly string[]> = {
  queue: ['M4 7h16M4 12h16M4 17h10'],
  report: ['M6 3h9l4 4v14H6zM15 3v4h4'],
  chat: ['M4 5h16v11H9l-5 4z'],
  play: ['M7 4.5l12 7.5-12 7.5z'],
  spin: ['M12 3a9 9 0 1 0 9 9'],
  sun: [
    'M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m11.4 0 1.4 1.4M4.9 4.9l1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  ],
  moon: ['M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z'],
  shield: ['M12 3 4 6.5v5c0 4.6 3.3 8.4 8 9.5 4.7-1.1 8-4.9 8-9.5v-5L12 3Z', 'm9.4 12 2 2 3.3-3.6'],
  search: ['M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0', 'm20 20-3.6-3.6'],
  check: ['m5 13 4.5 4.5L19 7'],
  plus: ['M12 5v14M5 12h14'],
  close: ['M6 6l12 12M18 6 6 18'],
  replay: ['M20 12a8 8 0 1 1-2.6-5.9', 'M20 4v5h-5'],
  alert: ['M12 8v5', 'M12 16.5v.01', 'M10.3 3.9 2.6 17.3A1.6 1.6 0 0 0 4 19.8h16a1.6 1.6 0 0 0 1.4-2.5L13.7 3.9a1.6 1.6 0 0 0-2.8 0Z'],
  user: ['M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0', 'M4 20a8 8 0 0 1 16 0'],
  inbox: ['M3 13h5l1.5 3h5L16 13h5', 'M5.5 5h13l2.5 8v6H3v-6L5.5 5Z'],
  history: ['M12 7v5l3.5 2', 'M20 12a8 8 0 1 1-2.6-5.9', 'M20 4v5h-5'],
  checkCircle: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'm8.5 12 2.5 2.5 4.5-5'],
};

export interface IconProps {
  readonly name: IconName;
  readonly size?: number;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly fill?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function Icon({
  name,
  size = 16,
  stroke = 'currentColor',
  strokeWidth = 1.6,
  fill = 'none',
  className,
  style,
}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}
