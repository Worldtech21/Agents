/**
 * Environment configuration, read once and frozen.
 *
 * Nothing outside this module touches `import.meta.env`, so swapping the build
 * tool or injecting config at runtime is a change in one file.
 */

export interface AppEnvironment {
  /** Origin of the FastAPI service. Empty string means same-origin (dev proxy). */
  readonly apiBaseUrl: string;
  /** Router prefix the backend mounts under — `Settings.api_prefix`. */
  readonly apiPrefix: string;
  /** Timeout for non-streaming JSON calls, in milliseconds. */
  readonly apiTimeoutMs: number;
  /** Stream modes requested from `POST /chat/stream`. */
  readonly streamModes: readonly StreamModeName[];
}

/** Mirrors `StreamModeName` in app/schemas/chat.py. */
export type StreamModeName =
  | 'values'
  | 'updates'
  | 'messages'
  | 'custom'
  | 'debug'
  | 'tasks'
  | 'checkpoints';

const KNOWN_STREAM_MODES: readonly StreamModeName[] = [
  'values',
  'updates',
  'messages',
  'custom',
  'debug',
  'tasks',
  'checkpoints',
];

function parseStreamModes(raw: string | undefined): readonly StreamModeName[] {
  if (!raw) return ['updates', 'messages', 'custom'];
  const parsed = raw
    .split(',')
    .map((mode) => mode.trim())
    .filter((mode): mode is StreamModeName =>
      (KNOWN_STREAM_MODES as readonly string[]).includes(mode),
    );
  return parsed.length > 0 ? parsed : ['updates', 'messages', 'custom'];
}

function parseTimeout(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export const env: AppEnvironment = Object.freeze({
  apiBaseUrl: stripTrailingSlash(import.meta.env.VITE_API_BASE_URL ?? ''),
  apiPrefix: stripTrailingSlash(import.meta.env.VITE_API_PREFIX ?? '/api/v1'),
  apiTimeoutMs: parseTimeout(import.meta.env.VITE_API_TIMEOUT_MS),
  streamModes: parseStreamModes(import.meta.env.VITE_STREAM_MODES),
});

/** Absolute (or same-origin absolute-path) URL for an API route. */
export function apiUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${env.apiBaseUrl}${env.apiPrefix}${suffix}`;
}
