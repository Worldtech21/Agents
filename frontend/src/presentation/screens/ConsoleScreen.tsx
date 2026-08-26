/**
 * The read-only console.
 *
 * Answers come back through the same supervisor as a recommendation, so the
 * bubbles carry the same guarantee the sidebar states: this asks questions, it
 * never changes access.
 */

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import type { ChatMessageVM, ThoughtSegmentVM } from '@bff/viewmodels';
import { Button } from '@presentation/atoms/Button';
import { StatusDot } from '@presentation/atoms/StatusDot';
import { ChatBubble } from '@presentation/molecules/ChatBubble';
import { ErrorState } from '@presentation/molecules/StateViews';
import { ThinkingTrace } from '@presentation/molecules/ThinkingTrace';
import styles from '@presentation/screens/screens.module.css';

export interface ConsoleScreenProps {
  readonly messages: readonly ChatMessageVM[];
  readonly suggestions: readonly string[];
  readonly isBusy: boolean;
  readonly error: Error | null;
  /** The reasoning of the run in flight, streaming as it arrives. */
  readonly liveThoughts: readonly ThoughtSegmentVM[];
  readonly onAsk: (question: string) => void;
  readonly onCancel: () => void;
}

export function ConsoleScreen({
  messages,
  suggestions,
  isBusy,
  error,
  liveThoughts,
  onAsk,
  onCancel,
}: ConsoleScreenProps) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // The reasoning appearing is new content too, so the view follows it rather
  // than stranding the reader above a panel that has started writing.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, isBusy, liveThoughts.length]);

  const send = (text: string) => {
    const question = text.trim();
    if (!question || isBusy) return;
    onAsk(question);
    setDraft('');
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send(draft);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send(draft);
    }
  };

  return (
    <div className={styles.console}>
      <div className={styles.consoleScroll} ref={scrollRef}>
        {messages.length === 0 && !isBusy ? (
          <div className={styles.consoleEmpty}>
            <h4 className={styles.consoleEmptyTitle}>Ask the mesh a question</h4>
            <p className={styles.consoleEmptyBody}>
              The supervisor routes to the identities, peer affinity, entitlements, policy and
              separation-of-duties agents, and answers only from what they return. Requests to
              change access are refused and pointed at the formal access-request process.
            </p>
          </div>
        ) : null}

        {messages.map((message) =>
          message.isStreaming ? null : <ChatBubble key={message.id} message={message} />,
        )}

        {/* Once the model starts thinking, its own words say more than a fixed
            status line, so the indicator gives way to the reasoning. */}
        {isBusy && liveThoughts.length > 0 ? (
          <ThinkingTrace thoughts={liveThoughts} isLive />
        ) : null}

        {isBusy && liveThoughts.length === 0 ? (
          <div className={styles.typing} role="status">
            <StatusDot tone="blue" pulsing />
            <span className={styles.typingText}>Supervisor is routing to specialists</span>
          </div>
        ) : null}

        {error ? <ErrorState inline title="The question failed" error={error} /> : null}
      </div>

      <div className={styles.composer}>
        {suggestions.length > 0 ? (
          <div className={styles.suggestions}>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className={styles.suggestion}
                onClick={() => send(suggestion)}
                disabled={isBusy}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}

        <form className={styles.composerField} onSubmit={submit}>
          <input
            className={styles.composerInput}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about identities, peers, entitlements, SoD or policy"
            aria-label="Ask the supervisor a question"
            disabled={isBusy}
          />
          {isBusy ? (
            <Button type="button" variant="outline" size="md" onClick={onCancel}>
              Stop
            </Button>
          ) : (
            <Button type="submit" variant="primary" size="md" disabled={draft.trim().length === 0}>
              Ask
            </Button>
          )}
        </form>

        <span className={styles.composerNote}>
          Read-only. Requests to change access are refused and pointed at the formal access-request
          process.
        </span>
      </div>
    </div>
  );
}
