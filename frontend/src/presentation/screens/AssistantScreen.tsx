/**
 * Employee self-service.
 *
 * The console's layout, with one addition that changes what the screen is for:
 * when the assistant has understood a request, a confirmation card appears
 * under that turn. The card is drawn from the rules engine rather than from the
 * assistant (see application/hooks/useVerdict.ts), and pressing its button is
 * the only thing on this screen that writes anything.
 */

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import type { AssistantTurn } from '@application/hooks/useAssistant';
import type { EntitlementCandidateVM, ThoughtSegmentVM, VerdictVM } from '@bff/viewmodels';
import { Button } from '@presentation/atoms/Button';
import { StatusDot } from '@presentation/atoms/StatusDot';
import { CandidateList } from '@presentation/molecules/CandidateList';
import { ChatBubble } from '@presentation/molecules/ChatBubble';
import { ErrorState } from '@presentation/molecules/StateViews';
import { ThinkingTrace } from '@presentation/molecules/ThinkingTrace';
import { VerdictCard } from '@presentation/molecules/VerdictCard';
import styles from '@presentation/screens/screens.module.css';

const SUGGESTIONS = [
  'What access could I have?',
  'I need access to the risk portal',
  'What do I already have?',
];

export interface AssistantScreenProps {
  readonly turns: readonly AssistantTurn[];
  readonly employeeName: string;
  readonly isBusy: boolean;
  readonly error: Error | null;
  /** The reasoning of the turn in flight, streaming as it arrives. */
  readonly liveThoughts: readonly ThoughtSegmentVM[];
  readonly verdict: VerdictVM | null;
  readonly verdictLoading: boolean;
  readonly verdictError: Error | null;
  readonly isSubmitting: boolean;
  /** `display`, when given, is shown in the bubble in place of `question`. */
  readonly onAsk: (question: string, display?: string) => void;
  readonly onConfirm: (verdict: VerdictVM) => void;
  readonly onDismissVerdict: () => void;
  readonly onCancel: () => void;
}

export function AssistantScreen({
  turns,
  employeeName,
  isBusy,
  error,
  liveThoughts,
  verdict,
  verdictLoading,
  verdictError,
  isSubmitting,
  onAsk,
  onConfirm,
  onDismissVerdict,
  onCancel,
}: AssistantScreenProps) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Follows the card appearing too, not just a new turn — it is the thing the
  // employee is meant to act on.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns.length, isBusy, verdict, verdictLoading, liveThoughts.length]);

  const send = (text: string) => {
    const question = text.trim();
    if (!question || isBusy) return;
    onAsk(question);
    setDraft('');
  };

  /**
   * Picking a candidate is just the employee's next turn. The assistant is
   * told exactly which entitlement, so nothing is left to re-match; the
   * employee sees the plain description they picked, never the catalog code.
   */
  const choose = (candidate: EntitlementCandidateVM) => {
    if (isBusy) return;
    const id = candidate.entitlementId ? ` (${candidate.entitlementId})` : '';
    onAsk(`I mean ${candidate.entitlementName}${id}.`, candidate.description);
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
        {turns.length === 0 && !isBusy ? (
          <div className={styles.consoleEmpty}>
            <h4 className={styles.consoleEmptyTitle}>Ask for the access you need</h4>
            <p className={styles.consoleEmptyBody}>
              Describe what you are trying to do, {employeeName}. The assistant works out which
              system that is, checks it against policy, and tells you whether it can be granted
              straight away or needs your manager to approve it. Nothing is requested until you
              confirm.
            </p>
          </div>
        ) : null}

        {turns.map((turn) =>
          turn.message.isStreaming ? null : (
            <div key={turn.message.id}>
              <ChatBubble message={turn.message} />
              {turn.candidates.length > 0 ? (
                <CandidateList
                  candidates={turn.candidates}
                  isLive={turn.candidatesLive}
                  disabled={isBusy}
                  onChoose={choose}
                />
              ) : null}
              {/* Only the turn carrying the live proposal renders a card. */}
              {turn.intent ? (
                <VerdictCard
                  verdict={verdict}
                  isLoading={verdictLoading}
                  isSubmitting={isSubmitting}
                  onConfirm={onConfirm}
                  onDismiss={onDismissVerdict}
                />
              ) : null}
            </div>
          ),
        )}

        {/* Once the assistant starts thinking, its own words say more than a
            fixed status line, so the indicator gives way to the reasoning. */}
        {isBusy && liveThoughts.length > 0 ? (
          <ThinkingTrace thoughts={liveThoughts} isLive />
        ) : null}

        {isBusy && liveThoughts.length === 0 ? (
          <div className={styles.typing} role="status">
            <StatusDot tone="blue" pulsing />
            <span className={styles.typingText}>Checking the catalog and the policy</span>
          </div>
        ) : null}

        {error ? <ErrorState inline title="The assistant could not answer" error={error} /> : null}
        {verdictError ? (
          <ErrorState inline title="Could not check that entitlement" error={verdictError} />
        ) : null}
      </div>

      <div className={styles.composer}>
        {turns.length === 0 ? (
          <div className={styles.suggestions}>
            {SUGGESTIONS.map((suggestion) => (
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
            placeholder="What do you need access to?"
            aria-label="Ask the access assistant"
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
          The assistant proposes; policy decides. Every request is re-checked before it is raised.
        </span>
      </div>
    </div>
  );
}
