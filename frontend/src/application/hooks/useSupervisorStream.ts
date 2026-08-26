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
import {
  appendActivity,
  appendThought,
  openThoughtTurn,
  sealThoughts,
  toAgentTurn,
  toStreamedDeltas,
} from '@bff/mappers/chat.mapper';
import type { ThoughtSegmentVM } from '@bff/viewmodels';
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
  /** The reasoning that ran, so a settled turn can keep showing it. */
  readonly thoughts: readonly ThoughtSegmentVM[];
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
  /**
   * The model's reasoning as it arrives, split by the agent doing the thinking.
   *
   * Unlike `streamedText` this is safe to render the moment it lands: the
   * answer is held back because it is partial JSON, but thinking is prose and
   * is the whole point of showing it live.
   */
  readonly thoughts: readonly ThoughtSegmentVM[];
  readonly isStreaming: boolean;
  readonly error: ApiError | null;
  readonly threadId: string | null;
}

const IDLE_STATE: SupervisorStreamState = {
  envelopes: [],
  streamedText: '',
  thoughts: [],
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
  const bufferRef = useRef<{
    envelopes: StreamEnvelopeDTO[];
    text: string;
    thoughtsChanged: boolean;
  }>({
    envelopes: [],
    text: '',
    thoughtsChanged: false,
  });
  /**
   * Reasoning is folded here as it arrives rather than inside `setState`, so
   * the run result can carry the finished list without waiting for a render.
   */
  const thoughtsRef = useRef<readonly ThoughtSegmentVM[]>([]);
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
    if (buffered.envelopes.length === 0 && buffered.text === '' && !buffered.thoughtsChanged) {
      return;
    }

    bufferRef.current = { envelopes: [], text: '', thoughtsChanged: false };
    if (!mountedRef.current) return;

    setState((previous) => {
      const merged = previous.envelopes.concat(buffered.envelopes);
      return {
        ...previous,
        envelopes:
          merged.length > MAX_TRACE_ENVELOPES ? merged.slice(-MAX_TRACE_ENVELOPES) : merged,
        streamedText: previous.streamedText + buffered.text,
        thoughts: thoughtsRef.current,
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

  /** Nothing further will be thought, so the open segment stops pulsing. */
  const settleThoughts = useCallback(() => {
    thoughtsRef.current = sealThoughts(thoughtsRef.current);
    return thoughtsRef.current;
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const thoughts = settleThoughts();
    if (mountedRef.current) {
      setState((previous) => ({ ...previous, isStreaming: false, thoughts }));
    }
  }, [settleThoughts]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    bufferRef.current = { envelopes: [], text: '', thoughtsChanged: false };
    thoughtsRef.current = [];
    if (mountedRef.current) setState(IDLE_STATE);
  }, []);

  const start = useCallback(
    async (options: StartRunOptions): Promise<SupervisorRunResult | null> => {
      // A second run supersedes the first rather than interleaving with it.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const threadId = options.threadId ?? newThreadId();
      bufferRef.current = { envelopes: [], text: '', thoughtsChanged: false };
      thoughtsRef.current = [];

      setState({
        envelopes: [],
        streamedText: '',
        thoughts: [],
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

          const deltas = toStreamedDeltas(envelope);
          if (deltas.length > 0) {
            for (const delta of deltas) {
              if (delta.kind === 'thinking') {
                thoughtsRef.current = appendThought(thoughtsRef.current, delta);
                bufferRef.current.thoughtsChanged = true;
              } else {
                bufferRef.current.text += delta.text;
              }
            }
            scheduleFlush();
            continue;
          }

          // An agent taking the turn opens its node on the reasoning timeline,
          // so the panel shows the delegation from the first moment of a run —
          // not only once a provider gets around to summarising its thinking.
          const agentKey = toAgentTurn(envelope);
          if (agentKey !== null) {
            const opened = openThoughtTurn(thoughtsRef.current, agentKey);
            if (opened !== thoughtsRef.current) {
              thoughtsRef.current = opened;
              bufferRef.current.thoughtsChanged = true;
            }
          }

          // The tools an agent called, what came back, and where it delegated —
          // the same `updates` envelopes the trace panel reads, folded onto the
          // agent whose turn produced them.
          if (envelope.event === 'updates') {
            const withActivity = appendActivity(thoughtsRef.current, envelope);
            if (withActivity !== thoughtsRef.current) {
              thoughtsRef.current = withActivity;
              bufferRef.current.thoughtsChanged = true;
            }
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

        const thoughts = settleThoughts();
        flush();

        if (controller.signal.aborted) return null;

        const answer = await resolveAnswer(collected, threadId, controller.signal);

        if (mountedRef.current) {
          setState((previous) => ({ ...previous, isStreaming: false, thoughts }));
        }

        return { answer, envelopes: collected, threadId, thoughts };
      } catch (error) {
        settleThoughts();
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
          setState((previous) => ({
            ...previous,
            isStreaming: false,
            error: apiError,
            thoughts: thoughtsRef.current,
          }));
        }
        throw apiError;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [flush, scheduleFlush, settleThoughts],
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
