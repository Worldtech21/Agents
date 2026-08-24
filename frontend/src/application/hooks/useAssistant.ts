/**
 * The employee self-service assistant.
 *
 * Structurally this is `useConsole` — an ordered, append-only list of turns
 * held here rather than in React Query, with the thread id carried across turns
 * so the backend's checkpointer gives the supervisor its history. Two things
 * differ:
 *
 * 1. It sends `mode: 'employee'` and the acting persona, which is what makes
 *    the backend open the thread with who is speaking.
 * 2. When the assistant proposes a request, the turn carries an *intent*. The
 *    intent is not rendered as fact: the screen asks `/requests/analyze` and
 *    shows that verdict instead. The assistant converses; it does not decide.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { useSupervisorStream } from '@application/hooks/useSupervisorStream';
import { usePersona } from '@application/state/PersonaProvider';
import { toChatMessages, type ConversationTurn } from '@bff/mappers/chat.mapper';
import { toAssistantOutcome } from '@bff/outcome';
import type { ChatMessageVM, RequestIntentVM } from '@bff/viewmodels';
import { ApiError } from '@infrastructure/api/client';

/** A turn plus whatever the assistant proposed on it. */
export interface AssistantTurn {
  readonly message: ChatMessageVM;
  /** Present only on the turn that produced it, and only once resolved. */
  readonly intent: RequestIntentVM | null;
}

export interface AssistantState {
  readonly turns: readonly AssistantTurn[];
  readonly isBusy: boolean;
  readonly error: ApiError | null;
  readonly threadId: string | null;
  /** The most recent proposal still awaiting the employee's confirmation. */
  readonly pendingIntent: RequestIntentVM | null;
  readonly ask: (question: string) => Promise<void>;
  readonly note: (text: string) => void;
  readonly cancel: () => void;
  readonly clear: () => void;
  /** Drops the pending proposal once it has been acted on or dismissed. */
  readonly clearIntent: () => void;
}

export function useAssistant(): AssistantState {
  const stream = useSupervisorStream();
  const { actor } = usePersona();
  const [turns, setTurns] = useState<readonly ConversationTurn[]>([]);
  const [intents, setIntents] = useState<ReadonlyMap<string, RequestIntentVM>>(new Map());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<ApiError | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const counterRef = useRef(0);

  const nextId = useCallback((prefix: string) => {
    counterRef.current += 1;
    return `${prefix}-${counterRef.current}`;
  }, []);

  /**
   * Append an assistant turn the app wrote itself — the outcome of a request,
   * for instance. It is the assistant's voice, so it reads as one of its turns.
   */
  const note = useCallback(
    (text: string) => {
      setTurns((previous) => [
        ...previous,
        { id: nextId('note'), role: 'assistant', text, citations: [] },
      ]);
    },
    [nextId],
  );

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || stream.isStreaming || !actor) return;

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
          // What puts the run into employee mode. `actor_id` is validated
          // server-side against the persona list.
          metadata: {
            surface: 'employee_console',
            mode: 'employee',
            actor_id: actor.actorId,
          },
        });

        if (!result) {
          // Cancelled or superseded: drop the placeholder rather than leave it spinning.
          setTurns((previous) => previous.filter((turn) => turn.id !== pendingId));
          return;
        }

        threadIdRef.current = result.threadId;
        const outcome = toAssistantOutcome(result.answer, result.threadId);
        const rendered = renderOutcome(outcome);

        if (outcome.kind === 'reply' && outcome.intent) {
          const intent = outcome.intent;
          setIntents((previous) => new Map(previous).set(pendingId, intent));
        }

        setTurns((previous) =>
          previous.map((turn) =>
            turn.id === pendingId
              ? { ...turn, text: rendered, citations: [], isStreaming: false }
              : turn,
          ),
        );
      } catch (caught) {
        const apiError =
          caught instanceof ApiError
            ? caught
            : new ApiError('The assistant request failed.', { code: 'assistant_failed' });
        setError(apiError);
        setTurns((previous) => previous.filter((turn) => turn.id !== pendingId));
      }
    },
    [actor, nextId, stream],
  );

  const cancel = useCallback(() => {
    stream.cancel();
    setTurns((previous) => previous.filter((turn) => turn.isStreaming !== true));
  }, [stream]);

  const clear = useCallback(() => {
    stream.reset();
    threadIdRef.current = null;
    setTurns([]);
    setIntents(new Map());
    setDismissed(new Set());
    setError(null);
  }, [stream]);

  /**
   * Partial JSON is never rendered: while a run is in flight the placeholder
   * stays blank and the typing indicator covers it, exactly as the console
   * does. The final text is substituted above, once the contract has parsed.
   */
  const messages = useMemo(
    () =>
      toChatMessages(
        turns.map((turn) =>
          turn.isStreaming === true && stream.streamedText ? { ...turn, text: '' } : turn,
        ),
      ),
    [turns, stream.streamedText],
  );

  const assistantTurns = useMemo<AssistantTurn[]>(
    () =>
      messages.map((message) => ({
        message,
        intent: dismissed.has(message.id) ? null : (intents.get(message.id) ?? null),
      })),
    [messages, intents, dismissed],
  );

  /** Only the latest proposal is live; an older one has been superseded. */
  const latestIntentId = useMemo(() => {
    for (let index = assistantTurns.length - 1; index >= 0; index -= 1) {
      const turn = assistantTurns[index];
      if (turn?.intent) return turn.message.id;
    }
    return null;
  }, [assistantTurns]);

  const clearIntent = useCallback(() => {
    if (!latestIntentId) return;
    setDismissed((previous) => new Set(previous).add(latestIntentId));
  }, [latestIntentId]);

  return {
    // Suppress every proposal but the most recent, so the conversation never
    // shows two confirmation cards at once.
    turns: assistantTurns.map((turn) =>
      turn.message.id === latestIntentId ? turn : { ...turn, intent: null },
    ),
    isBusy: stream.isStreaming,
    error,
    threadId: threadIdRef.current,
    pendingIntent: latestIntentId ? (intents.get(latestIntentId) ?? null) : null,
    ask,
    note,
    cancel,
    clear,
    clearIntent,
  };
}

/** What the employee reads, for each way a run can end. */
function renderOutcome(outcome: ReturnType<typeof toAssistantOutcome>): string {
  switch (outcome.kind) {
    case 'reply':
      return outcome.reply || 'The assistant finished without saying anything.';
    case 'refusal':
      return outcome.view.message;
    case 'unparseable':
      return `${outcome.reason} Try rephrasing what you need access to.`;
  }
}
