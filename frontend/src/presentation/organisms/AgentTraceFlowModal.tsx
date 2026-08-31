/**
 * The delegation graph, full-screen.
 *
 * The graph itself is `FlowCanvas`, which the report also renders inline while
 * a run is in flight; this is the shell around it — a dismissable overlay with
 * the run's status and a replay, for reading a finished run at full size.
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { TONE_VARIABLE } from '@bff/tone';
import type { TraceFlowVM } from '@bff/viewmodels';
import { Button } from '@presentation/atoms/Button';
import { Icon } from '@presentation/atoms/Icon';
import { StatusDot } from '@presentation/atoms/StatusDot';
import { FlowCanvas } from '@presentation/organisms/FlowCanvas';
import styles from '@presentation/organisms/organisms.module.css';

export interface AgentTraceFlowModalProps {
  readonly open: boolean;
  readonly flow: TraceFlowVM;
  readonly isRunning: boolean;
  readonly canReplay: boolean;
  readonly onReplay: () => void;
  readonly onClose: () => void;
}

export function AgentTraceFlowModal({
  open,
  flow,
  isRunning,
  canReplay,
  onReplay,
  onClose,
}: AgentTraceFlowModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape closes, and the page behind must not scroll under the overlay.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className={styles.flowOverlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.flowDialog}
        role="dialog"
        aria-modal="true"
        aria-label="Agent run graph"
        tabIndex={-1}
        ref={dialogRef}
      >
        <header className={styles.flowHead}>
          <span className={styles.flowTitle}>Agent run</span>
          <span className={styles.flowRunState} style={{ color: TONE_VARIABLE[flow.statusTone] }}>
            <StatusDot tone={flow.statusTone} pulsing={isRunning} />
            {flow.statusLabel}
          </span>
          <Button
            variant="quiet"
            size="sm"
            className={styles.flowClose}
            onClick={onClose}
            aria-label="Close the run graph"
          >
            <Icon name="close" size={14} />
          </Button>
        </header>

        <FlowCanvas flow={flow} isRunning={isRunning} />

        <footer className={styles.flowFoot}>
          <span className={styles.flowFootMeta} title={flow.metaLabel}>
            {flow.metaLabel}
          </span>
          <Button variant="card" size="sm" onClick={onReplay} disabled={!canReplay || isRunning}>
            Replay
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
