/**
 * The read-only console.
 *
 * Turns are held here rather than in React Query: a conversation is ordered,
 * append-only client state, not a cache of a server resource. The thread id is
 * kept across turns so the backend's checkpointer can give the supervisor the
 * history — without it every question would start a new graph run with no
 * memory of the last.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { useSupervisorStream } from '@application/hooks/useSupervisorStream';
import { toAssistantText, toCitations, type ConversationTurn } from '@bff/mappers/chat.mapper';
import { toRecommendationOutcome } from '@bff/outcome';
import { toChatMessages } from '@bff/mappers/chat.mapper';
import type { ChatMessageVM, ThoughtSegmentVM } from '@bff/viewmodels';
import { ApiError } from '@infrastructure/api/client';
import type { AgentInfoDTO } from '@infrastructure/types/api';

export interface ConsoleState {
  readonly messages: readonly ChatMessageVM[];
  readonly isBusy: boolean;
  readonly error: ApiError | null;
  readonly threadId: string | null;
  /** The reasoning of the run in flight, streaming as it arrives. */
  readonly liveThoughts: readonly ThoughtSegmentVM[];
  readonly ask: (question: string) => Promise<void>;
  readonly cancel: () => void;
  readonly clear: () => void;
}

export function useConsole(agents: readonly AgentInfoDTO[]): ConsoleState {
  const stream = useSupervisorStream();
  const [turns, setTurns] = useState<readonly ConversationTurn[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const counterRef = useRef(0);

  const nextId = useCallback((prefix: string) => {
    counterRef.current += 1;
    return `${prefix}-${counterRef.current}`;
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || stream.isStreaming) return;

      setError(null);
      const pendingId = nextId('assistant');

      setTurns((previous) => [
        ...previous,
        { id: nextId('user'), role: 'user', text, citations: [] },
        { id: pendingId, role: 'assistant', text: '', citations: [], isStreaming: true },
      ]);

      try {
        const result = await stream.start({
          message: text,
          ...(threadIdRef.current ? { threadId: threadIdRef.current } : {}),
          metadata: { surface: 'console' },
        });

        if (!result) {
          // Cancelled or superseded: drop the placeholder rather than leave it spinning.
          setTurns((previous) => previous.filter((turn) => turn.id !== pendingId));
          return;
        }

        threadIdRef.current = result.threadId;

        const outcome = toRecommendationOutcome(result.answer, {
          employeeId: '',
          threadId: result.threadId,
          receivedAt: Date.now(),
        });

        const answerText = toAssistantText(outcome);
        const citations = toCitations(result.envelopes, agents);

        setTurns((previous) =>
          previous.map((turn) =>
            turn.id === pendingId
              ? {
                  ...turn,
                  text:
                    answerText ||
                    'The supervisor finished without producing an answer for this thread.',
                  citations,
                  isStreaming: false,
                  // Kept on the turn so the reasoning stays readable after the
                  // run, collapsed, rather than vanishing with the live panel.
                  thoughts: result.thoughts,
                }
              : turn,
          ),
        );
      } catch (caught) {
        const apiError =
          caught instanceof ApiError
            ? caught
            : new ApiError('The console request failed.', { code: 'console_failed' });
        setError(apiError);
        setTurns((previous) => previous.filter((turn) => turn.id !== pendingId));
      }
    },
    [agents, nextId, stream],
  );

  const cancel = useCallback(() => {
    stream.cancel();
    setTurns((previous) => previous.filter((turn) => turn.isStreaming !== true));
  }, [stream]);

  const clear = useCallback(() => {
    stream.reset();
    threadIdRef.current = null;
    setTurns([]);
    setError(null);
  }, [stream]);

  /**
   * While a run is in flight the placeholder shows whatever text has streamed
   * so far. The final replacement happens above, once the JSON contract has
   * been parsed — partial JSON is not something to render.
   */
  const messages = useMemo(() => {
    const rendered = turns.map((turn) =>
      turn.isStreaming === true && stream.streamedText
        ? { ...turn, text: '' } // partial JSON stays hidden; the typing indicator covers it
        : turn,
    );
    return toChatMessages(rendered);
  }, [turns, stream.streamedText]);

  return {
    messages,
    isBusy: stream.isStreaming,
    error,
    threadId: threadIdRef.current,
    liveThoughts: stream.thoughts,
    ask,
    cancel,
    clear,
  };
}
