/**
 * One access request in a list.
 *
 * The same row serves a manager's inbox and a requester's own history — what
 * differs is the words, and those were decided in the BFF. When `onDecide` is
 * given the row grows a decision bar; otherwise it is read-only.
 */

import { useState } from 'react';

import { TONE_VARIABLE } from '@bff/tone';
import type { AccessRequestVM } from '@bff/viewmodels';
import { Button } from '@presentation/atoms/Button';
import { Chip } from '@presentation/atoms/Chip';
import { StatusLabel } from '@presentation/atoms/StatusDot';
import styles from '@presentation/molecules/molecules.module.css';

export interface RequestRowProps {
  readonly row: AccessRequestVM;
  /** Omit for a read-only row. */
  readonly onDecide?: (requestId: string, decision: 'approve' | 'reject', note: string) => void;
  readonly busy?: boolean;
}

export function RequestRow({ row, onDecide, busy = false }: RequestRowProps) {
  const [note, setNote] = useState('');

  return (
    <article className={styles.requestRow}>
      <header className={styles.requestHead}>
        <div className={styles.requestTitle}>
          <span className={styles.requestName}>{row.entitlementName}</span>
          <span className={styles.requestApp}>{row.application}</span>
          {row.subjectLabel ? (
            <span className={styles.requestSubject}>{row.subjectLabel}</span>
          ) : null}
        </div>
        <StatusLabel tone={row.statusTone} label={row.statusLabel} />
      </header>

      <div className={styles.requestMeta}>
        <span style={{ color: TONE_VARIABLE[row.riskTone] }}>{row.riskLabel}</span>
        {row.timestampLabel ? <span>{row.timestampLabel}</span> : null}
        {row.approverLabel && !row.isSettled ? (
          <span>Approver: {row.approverLabel}</span>
        ) : null}
      </div>

      {row.policyBasis ? <p className={styles.requestPolicy}>{row.policyBasis}</p> : null}

      {row.sodConflicts.length > 0 ? (
        <div className={styles.requestChips}>
          {row.sodConflicts.map((conflict) => (
            <Chip key={conflict} title="Separation of duties conflict">
              {conflict}
            </Chip>
          ))}
        </div>
      ) : null}

      {row.justification ? (
        <p className={styles.requestQuote}>“{row.justification}”</p>
      ) : null}

      {/* The refusal, in the approver's own words. Without this a rejected
          request would simply vanish from the requester's point of view. */}
      {row.decisionNote ? (
        <p className={styles.requestDecision}>
          <span className={styles.requestDecisionLabel}>Note</span>
          {row.decisionNote}
        </p>
      ) : null}

      {onDecide ? (
        <div className={styles.requestActions}>
          <input
            className={styles.requestNote}
            value={note}
            placeholder="Reason (shown to the requester)"
            onChange={(event) => setNote(event.target.value)}
            aria-label={`Reason for your decision on ${row.entitlementName}`}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onDecide(row.requestId, 'reject', note)}
          >
            Reject
          </Button>
          <Button
            size="sm"
            variant="primary"
            busy={busy}
            disabled={busy}
            onClick={() => onDecide(row.requestId, 'approve', note)}
          >
            Approve
          </Button>
        </div>
      ) : null}
    </article>
  );
}
