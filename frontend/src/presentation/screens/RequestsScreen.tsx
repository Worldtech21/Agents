/**
 * A list of access requests.
 *
 * One screen, three jobs, distinguished only by what it is given: a manager's
 * approval inbox (rows carry a decision bar), an employee's own history, and
 * HR's record of what they raised for joiners. The wording differs; the rows do
 * not.
 *
 * The empty state matters more here than usual. An approval inbox is empty most
 * of the time, and it has to read as "nothing to do" rather than as a failure.
 */

import type { AccessRequestVM } from '@bff/viewmodels';
import { Button } from '@presentation/atoms/Button';
import { RequestRow } from '@presentation/molecules/RequestRow';
import { ErrorState, StateView } from '@presentation/molecules/StateViews';
import { Skeleton } from '@presentation/atoms/Skeleton';
import styles from '@presentation/screens/screens.module.css';

export interface RequestsScreenProps {
  readonly rows: readonly AccessRequestVM[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly onRetry: () => void;
  /** Given only for the approval inbox; its absence makes rows read-only. */
  readonly onDecide?: (requestId: string, decision: 'approve' | 'reject', note: string) => void;
  readonly decidingId?: string | null;
  readonly decisionError?: Error | null;
}

export function RequestsScreen({
  rows,
  isLoading,
  error,
  emptyTitle,
  emptyBody,
  onRetry,
  onDecide,
  decidingId = null,
  decisionError = null,
}: RequestsScreenProps) {
  if (error) {
    return (
      <div className={styles.requests}>
        <ErrorState
          title="Could not load requests"
          error={error}
          onRetry={onRetry}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={styles.requests}>
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} width="100%" height="104px" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={styles.requests}>
        <StateView
          icon="checkCircle"
          title={emptyTitle}
          body={emptyBody}
          actions={
            <Button variant="outline" size="sm" onClick={onRetry}>
              Refresh
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className={styles.requests}>
      {decisionError ? (
        <ErrorState inline title="That decision did not go through" error={decisionError} />
      ) : null}

      {rows.map((row) => (
        <RequestRow
          key={row.requestId}
          row={row}
          {...(onDecide ? { onDecide } : {})}
          busy={decidingId === row.requestId}
        />
      ))}
    </div>
  );
}
