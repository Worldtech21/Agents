/**
 * The delegation graph, at full size.
 *
 * The graph itself is `FlowCanvas`; this is the bar above it — the run's status,
 * a replay, and the way back to the report. While a run is in flight the caller
 * leaves `onShowResults` off and the bar disappears, so a live run is the
 * drawing and nothing else.
 */

import { TONE_VARIABLE } from '@bff/tone';
import type { TraceFlowVM } from '@bff/viewmodels';
import { Button } from '@presentation/atoms/Button';
import { StatusDot } from '@presentation/atoms/StatusDot';
import { FlowCanvas } from '@presentation/organisms/FlowCanvas';
import styles from '@presentation/organisms/organisms.module.css';

export interface AgentRunGraphProps {
  readonly flow: TraceFlowVM;
  readonly isRunning: boolean;
  readonly canReplay: boolean;
  readonly onReplay: () => void;
  /** Omitted while a run streams, which is when there is no report to go back to. */
  readonly onShowResults?: () => void;
}

export function AgentRunGraph({
  flow,
  isRunning,
  canReplay,
  onReplay,
  onShowResults,
}: AgentRunGraphProps) {
  return (
    <section className={styles.flowPanel} aria-label="Agent run graph">
      {onShowResults ? (
        <header className={styles.flowHead}>
          <span className={styles.flowTitle}>Agent run</span>
          <span className={styles.flowRunState} style={{ color: TONE_VARIABLE[flow.statusTone] }}>
            <StatusDot tone={flow.statusTone} pulsing={isRunning} />
            {flow.statusLabel}
          </span>
          <span className={styles.flowHeadMeta} title={flow.metaLabel}>
            {flow.metaLabel}
          </span>
          <div className={styles.flowHeadActions}>
            <Button variant="card" size="sm" onClick={onReplay} disabled={!canReplay || isRunning}>
              Replay
            </Button>
            <Button variant="primary" size="sm" onClick={onShowResults}>
              Results
            </Button>
          </div>
        </header>
      ) : null}

      <FlowCanvas flow={flow} isRunning={isRunning} />
    </section>
  );
}
