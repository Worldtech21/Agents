/**
 * The live delegation trace.
 *
 * Every row is a node update LangGraph emitted, attributed to the worker whose
 * subgraph namespace produced it. Nothing here is scripted: an idle panel means
 * no run has streamed yet.
 */

import { useEffect, useRef } from 'react';

import { TONE_VARIABLE } from '@bff/tone';
import type { TracePanelVM } from '@bff/viewmodels';
import { Button } from '@presentation/atoms/Button';
import { TraceRow, TraceRowSkeleton } from '@presentation/molecules/TraceRow';
import styles from '@presentation/organisms/organisms.module.css';

export interface AgentTracePanelProps {
  readonly trace: TracePanelVM;
  readonly isRunning: boolean;
  readonly canReplay: boolean;
  readonly onReplay: () => void;
}

export function AgentTracePanel({
  trace,
  isRunning,
  canReplay,
  onReplay,
}: AgentTracePanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Follow the newest step while a run streams, but never fight a user who has
  // scrolled up to read an earlier one.
  useEffect(() => {
    if (!isRunning) return;
    const node = scrollRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (distanceFromBottom < 160) node.scrollTop = node.scrollHeight;
  }, [isRunning, trace.rows.length]);

  return (
    <aside className={styles.tracePanel} aria-label="Agent trace">
      <div className={styles.traceHead}>
        <span className={styles.traceTitle}>Agent trace</span>
        <span className={styles.traceStatus} style={{ color: TONE_VARIABLE[trace.statusTone] }}>
          {trace.statusLabel}
        </span>
      </div>

      <div className={styles.traceScroll} ref={scrollRef} aria-live="polite" aria-atomic="false">
        {trace.rows.length === 0 && isRunning
          ? Array.from({ length: 4 }, (_, index) => <TraceRowSkeleton key={index} />)
          : null}

        {trace.rows.length === 0 && !isRunning ? (
          <p className={styles.traceMeta} style={{ whiteSpace: 'normal', padding: '4px 0 20px' }}>
            Run a recommendation to see the supervisor delegate across the mesh, step by step.
          </p>
        ) : null}

        {trace.rows.map((row, index) => (
          <TraceRow key={row.key} row={row} isLast={index === trace.rows.length - 1} />
        ))}
      </div>

      <div className={styles.traceFoot}>
        <span className={styles.traceMeta} title={trace.metaLabel}>
          {trace.metaLabel}
        </span>
        <Button
          variant="card"
          size="sm"
          className={styles.traceReplay}
          onClick={onReplay}
          disabled={!canReplay || isRunning}
        >
          Replay
        </Button>
      </div>
    </aside>
  );
}
