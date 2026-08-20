/**
 * One supervisor run, streamed.
 *
 * Both the recommendation screen and the console sit on this hook: they differ
 * in what they do with the answer, not in how the run is driven. It owns the
 * abort controller, coalesces envelopes so a token-per-render storm cannot
 * thrash React, and guarantees the run is torn down on unmount.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { extractFinalAnswer } from '@bff/mappers/answer.mapper';
import { toStreamedToken } from '@bff/mappers/chat.mapper';
import { ApiError } from '@infrastructure/api/client';
import { fetchThreadState, streamChat } from '@infrastructure/api/endpoints';
import { extractAnswerFromThreadState } from '@bff/mappers/answer.mapper';
import type { StreamEnvelopeDTO } from '@infrastructure/types/api';

/**
 * How many trace-bearing envelopes to retain. A six-worker run settles well
 * inside this; the cap exists so a runaway loop cannot exhaust memory before
 * the recursion limit stops it.
 */
const MAX_TRACE_ENVELOPES = 600;

/** Envelope batches are applied on this cadence rather than per frame. */
const FLUSH_INTERVAL_MS = 80;

export interface SupervisorRunResult {
  readonly answer: string;
  readonly envelopes: readonly StreamEnvelopeDTO[];
  readonly threadId: string;
}

export interface StartRunOptions {
  readonly message: string;
  /** Reuse to continue a conversation; omitted starts a fresh thread. */
  readonly threadId?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface SupervisorStreamState {
  /** Control and `updates` envelopes — what the trace panel reads. */
  readonly envelopes: readonly StreamEnvelopeDTO[];
  /** Assistant text accumulated from `messages` deltas, for live typing. */
  readonly streamedText: string;
  readonly isStreaming: boolean;
  readonly error: ApiError | null;
  readonly threadId: string | null;
}

const IDLE_STATE: SupervisorStreamState = {
  envelopes: [],
  streamedText: '',
  isStreaming: false,
  error: null,
  threadId: null,
};

export interface SupervisorStream extends SupervisorStreamState {
  readonly start: (options: StartRunOptions) => Promise<SupervisorRunResult | null>;
  readonly cancel: () => void;
  readonly reset: () => void;
}

export function useSupervisorStream(): SupervisorStream {
  const [state, setState] = useState<SupervisorStreamState>(IDLE_STATE);

  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const bufferRef = useRef<{ envelopes: StreamEnvelopeDTO[]; text: string }>({
    envelopes: [],
    text: '',
  });
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
    };
  }, []);

  const flush = useCallback(() => {
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const buffered = bufferRef.current;
    if (buffered.envelopes.length === 0 && buffered.text === '') return;

    bufferRef.current = { envelopes: [], text: '' };
    if (!mountedRef.current) return;

    setState((previous) => {
      const merged = previous.envelopes.concat(buffered.envelopes);
      return {
        ...previous,
        envelopes:
          merged.length > MAX_TRACE_ENVELOPES ? merged.slice(-MAX_TRACE_ENVELOPES) : merged,
        streamedText: previous.streamedText + buffered.text,
      };
    });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      flush();
    }, FLUSH_INTERVAL_MS);
  }, [flush]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (mountedRef.current) {
      setState((previous) => ({ ...previous, isStreaming: false }));
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    bufferRef.current = { envelopes: [], text: '' };
    if (mountedRef.current) setState(IDLE_STATE);
  }, []);

  const start = useCallback(
    async (options: StartRunOptions): Promise<SupervisorRunResult | null> => {
      // A second run supersedes the first rather than interleaving with it.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const threadId = options.threadId ?? newThreadId();
      bufferRef.current = { envelopes: [], text: '' };

      setState({
        envelopes: [],
        streamedText: '',
        isStreaming: true,
        error: null,
        threadId,
      });

      const collected: StreamEnvelopeDTO[] = [];

      try {
        const stream = streamChat(
          {
            message: options.message,
            thread_id: threadId,
            ...(options.metadata ? { metadata: options.metadata } : {}),
          },
          controller.signal,
        );

        for await (const envelope of stream) {
          if (controller.signal.aborted) break;

          const token = toStreamedToken(envelope);
          if (token !== null) {
            bufferRef.current.text += token;
            scheduleFlush();
            continue;
          }

          // Everything except token deltas is trace material: `updates` for the
          // steps, `custom` for the `agent.turn_start` attribution.
          if (
            envelope.channel === 'control' ||
            envelope.event === 'updates' ||
            envelope.event === 'custom'
          ) {
            collected.push(envelope);
            bufferRef.current.envelopes.push(envelope);
            scheduleFlush();
          }
        }

        flush();

        if (controller.signal.aborted) return null;

        const answer = await resolveAnswer(collected, threadId, controller.signal);

        if (mountedRef.current) {
          setState((previous) => ({ ...previous, isStreaming: false }));
        }

        return { answer, envelopes: collected, threadId };
      } catch (error) {
        flush();
        if (isAbort(error)) return null;

        const apiError =
          error instanceof ApiError
            ? error
            : new ApiError(
                error instanceof Error ? error.message : 'The run failed unexpectedly.',
                { code: 'stream_failed' },
              );

        if (mountedRef.current) {
          setState((previous) => ({ ...previous, isStreaming: false, error: apiError }));
        }
        throw apiError;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [flush, scheduleFlush],
  );

  return { ...state, start, cancel, reset };
}

/**
 * Prefer the answer seen on the stream; fall back to the checkpointed thread.
 *
 * The fallback matters when the supervisor's closing message lands in a mode
 * this client did not subscribe to — `GET /chat/threads/{id}` has the whole
 * state regardless, as long as a checkpointer is configured.
 */
async function resolveAnswer(
  envelopes: readonly StreamEnvelopeDTO[],
  threadId: string,
  signal: AbortSignal,
): Promise<string> {
  const streamed = extractFinalAnswer(envelopes);
  if (streamed) return streamed;

  try {
    const state = await fetchThreadState(threadId, signal);
    return extractAnswerFromThreadState(state);
  } catch {
    // No checkpointer, or the thread expired: report the empty answer and let
    // the BFF classify it as unparseable rather than failing the whole run.
    return '';
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function newThreadId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `th_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
