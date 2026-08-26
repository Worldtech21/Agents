/**
 * The mesh reasoning, live.
 *
 * A supervisor run is a sequence of agents taking the turn from one another, so
 * this renders it as that rather than as one block of prose: a rail of nodes,
 * one per agent that held the turn, the current one pulsing while it writes and
 * the finished ones carrying what they took. It is deliberately the same rail,
 * dot and duration vocabulary as the agent trace panel — on the report screen
 * both are on screen at once, and they are two views of one run, not two
 * designs.
 *
 * The two states are the same content at different moments: open and following
 * the newest line while a run streams, collapsed to a single summary once it
 * settles. Nothing renders when a provider returns no reasoning, which keeps
 * the surface honest rather than showing an empty promise.
 */

import { useEffect, useRef, useState } from 'react';

import { hasReasoning } from '@bff/mappers/chat.mapper';
import { TONE_VARIABLE } from '@bff/tone';
import type { ThoughtEventVM, ThoughtSegmentVM } from '@bff/viewmodels';
import { StatusDot } from '@presentation/atoms/StatusDot';
import styles from '@presentation/molecules/molecules.module.css';

export interface ThinkingTraceProps {
  readonly thoughts: readonly ThoughtSegmentVM[];
  /** True while the run is still producing it. */
  readonly isLive: boolean;
}

/**
 * What an agent's node says it is doing.
 *
 * "Thinking" is claimed only when there is reasoning to show; a turn with no
 * summary is reported as work, which is all the stream actually attests to.
 */
function describeWork(segment: ThoughtSegmentVM): string {
  const verb = hasReasoning(segment) ? 'thought' : 'worked';
  if (segment.state === 'active') {
    return hasReasoning(segment) ? 'thinking…' : 'working…';
  }
  return `${verb} for ${segment.durationLabel}`;
}

/** The glyph that marks what kind of event a row is. */
const EVENT_GLYPH: Record<ThoughtEventVM['kind'], string> = {
  'thinking': '',
  'tool.call': '→',
  'tool.result': '←',
  'handoff': '⇢',
  'message': '▸',
};

/**
 * One event under an agent's node.
 *
 * Reasoning reads as prose because that is what it is; everything else reads as
 * a log line — glyph, name, then the arguments or the result — so a reader can
 * skim what the mesh *did* without wading through what it thought.
 */
function ThoughtEvent({
  event,
  isWriting,
  isDone,
}: {
  readonly event: ThoughtEventVM;
  readonly isWriting: boolean;
  readonly isDone: boolean;
}) {
  if (event.kind === 'thinking') {
    return (
      <p
        className={[styles.thoughtText, isDone ? styles.thoughtTextDone : '']
          .filter(Boolean)
          .join(' ')}
      >
        {event.detail}
        {isWriting ? <span className={styles.thinkingCaret} aria-hidden="true" /> : null}
      </p>
    );
  }

  return (
    <div className={styles.thoughtEvent}>
      <span className={styles.thoughtGlyph} style={{ color: TONE_VARIABLE[event.tone] }}>
        {EVENT_GLYPH[event.kind]}
      </span>
      <span className={styles.thoughtEventLabel}>{event.label}</span>
      {event.detail ? <span className={styles.thoughtEventDetail}>{event.detail}</span> : null}
    </div>
  );
}

export function ThinkingTrace({ thoughts, isLive }: ThinkingTraceProps) {
  const [isOpen, setOpen] = useState(isLive);
  const bodyRef = useRef<HTMLDivElement>(null);

  // A live trace opens itself; a settled one keeps whatever the reader chose,
  // so reopening a finished thought does not slam shut on the next run.
  useEffect(() => {
    if (isLive) setOpen(true);
  }, [isLive]);

  // Follow the newest thought while it streams, but never fight a reader who
  // has scrolled up — the same rule the agent trace panel follows.
  useEffect(() => {
    if (!isLive || !isOpen) return;
    const node = bodyRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (distanceFromBottom < 120) node.scrollTop = node.scrollHeight;
  }, [isLive, isOpen, thoughts]);

  if (thoughts.length === 0) return null;

  const active = thoughts[thoughts.length - 1];
  const agentCount = new Set(thoughts.map((segment) => segment.agentKey)).size;
  const toolCount = thoughts.reduce(
    (total, segment) =>
      total + segment.events.filter((event) => event.kind === 'tool.call').length,
    0,
  );

  return (
    <section
      className={[styles.thinking, isLive ? styles.thinkingLive : ''].filter(Boolean).join(' ')}
      aria-label="Agent reasoning"
    >
      <button
        type="button"
        className={styles.thinkingHead}
        onClick={() => setOpen((open) => !open)}
        aria-expanded={isOpen}
      >
        <StatusDot tone={isLive ? 'blue' : 'green'} size="sm" pulsing={isLive} />

        {/* Live, the header names who currently holds the turn — that is the
            one fact a reader wants and cannot get from the text itself. */}
        <span className={styles.thinkingSummary}>
          {isLive && active ? (
            <>
              <span className={styles.thinkingSummaryAgent}>{active.agentLabel}</span>
              <span>{hasReasoning(active) ? ' is thinking' : ' is working'}</span>
            </>
          ) : (
            'Reasoning'
          )}
        </span>

        <span className={styles.thinkingCount}>
          {agentCount} {agentCount === 1 ? 'agent' : 'agents'}
          {toolCount > 0 ? ` · ${toolCount} ${toolCount === 1 ? 'tool call' : 'tool calls'}` : ''}
        </span>
        <span className={styles.thinkingToggle} aria-hidden="true">
          {isOpen ? 'Hide' : 'Show'}
        </span>
      </button>

      {isOpen ? (
        <div
          className={styles.thinkingBody}
          ref={bodyRef}
          // Reasoning is progress, not an announcement: polite and non-atomic
          // so a screen reader is not read the whole trace on every token.
          aria-live={isLive ? 'polite' : 'off'}
          aria-atomic="false"
        >
          {thoughts.map((segment, index) => (
            <ThoughtNode
              key={segment.key}
              segment={segment}
              isLast={index === thoughts.length - 1}
              // Every node after the first was handed the turn by the one above.
              isHandoff={index > 0}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ThoughtNode({
  segment,
  isLast,
  isHandoff,
}: {
  readonly segment: ThoughtSegmentVM;
  readonly isLast: boolean;
  readonly isHandoff: boolean;
}) {
  const isActive = segment.state === 'active';

  return (
    <div className={styles.thoughtNode}>
      <div className={styles.thoughtRail}>
        <StatusDot
          tone={segment.tone}
          size="lg"
          pulsing={isActive}
          className={styles.thoughtDot}
        />
        {!isLast ? (
          <span
            className={styles.thoughtLine}
            style={{ background: TONE_VARIABLE[segment.tone] }}
          />
        ) : null}
      </div>

      <div className={styles.thoughtBody}>
        <div className={styles.thoughtHeader}>
          {isHandoff ? (
            <span className={styles.thoughtHandoff} aria-hidden="true">
              ↳
            </span>
          ) : null}
          <span className={styles.thoughtAgent}>{segment.agentLabel}</span>
          <span className={styles.thoughtStatus}>{describeWork(segment)}</span>
        </div>

        {/* A turn that produced nothing still gets its node — the agent did
            work. Inventing prose for it would be worse than showing none. */}
        {segment.events.map((event, index) => (
          <ThoughtEvent
            key={event.key}
            event={event}
            // Only the newest reasoning on the live turn is still being written.
            isWriting={isActive && event.kind === 'thinking' && index === segment.events.length - 1}
            isDone={!isActive}
          />
        ))}

        {segment.events.length === 0 && isActive ? (
          <p className={styles.thoughtText}>
            <span className={styles.thinkingCaret} aria-hidden="true" />
          </p>
        ) : null}
      </div>
    </div>
  );
}
