/**
 * The provisioning queue.
 *
 * See bff/mappers/queue.mapper.ts for why the rows are a local watchlist: the
 * service has no route that lists joiners. Everything beside the id in a row is
 * read back out of a completed run.
 */

import { useState, type FormEvent } from 'react';

import type { QueueRowVM, QueueStatVM } from '@bff/viewmodels';
import { Button } from '@presentation/atoms/Button';
import { Icon } from '@presentation/atoms/Icon';
import { SkeletonRegion } from '@presentation/atoms/Skeleton';
import { QueueRow, QueueRowSkeleton } from '@presentation/molecules/QueueRow';
import { StatCard, StatCardSkeleton } from '@presentation/molecules/StatCard';
import { ErrorState, StateView } from '@presentation/molecules/StateViews';
import styles from '@presentation/screens/screens.module.css';

export interface QueueScreenProps {
  readonly rows: readonly QueueRowVM[];
  readonly stats: readonly QueueStatVM[];
  readonly isBootstrapping: boolean;
  readonly bootError: Error | null;
  readonly onRetryBoot: () => void;
  readonly runningEmployeeId: string | null;
  readonly onAdd: (employeeId: string) => void;
  readonly onRun: (employeeId: string) => void;
  readonly onOpen: (employeeId: string) => void;
  readonly onRemove: (employeeId: string) => void;
}

export function QueueScreen({
  rows,
  stats,
  isBootstrapping,
  bootError,
  onRetryBoot,
  runningEmployeeId,
  onAdd,
  onRun,
  onOpen,
  onRemove,
}: QueueScreenProps) {
  const [draft, setDraft] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    onAdd(value);
    setDraft('');
  };

  if (bootError) {
    return (
      <div className={styles.queueScroll}>
        <ErrorState
          title="The Access Advisor service is not reachable"
          error={bootError}
          onRetry={onRetryBoot}
        />
      </div>
    );
  }

  return (
    <div className={styles.queueScroll}>
      {isBootstrapping ? (
        <SkeletonRegion label="Loading the provisioning queue">
          <div className={styles.statGrid}>
            {Array.from({ length: 4 }, (_, index) => (
              <StatCardSkeleton key={index} />
            ))}
          </div>
          <div className={styles.table}>
            {Array.from({ length: 4 }, (_, index) => (
              <QueueRowSkeleton key={index} />
            ))}
          </div>
        </SkeletonRegion>
      ) : (
        <>
          <div className={styles.statGrid}>
            {stats.map((stat) => (
              <StatCard key={stat.key} stat={stat} />
            ))}
          </div>

          <div className={styles.sectionHead}>
            <h4 className={styles.sectionTitle}>Onboarding intake</h4>
            <span className={styles.sectionNote}>
              Joiners this console has been asked about, sorted by start date
            </span>
            <span className={styles.sectionMeta}>
              {rows.length} {rows.length === 1 ? 'joiner' : 'joiners'}
            </span>
          </div>

          <form className={styles.addRow} onSubmit={submit}>
            <div className={styles.addField}>
              <Icon name="plus" size={15} stroke="var(--ink-48)" />
              <input
                className={styles.addInput}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Add employee ID"
                aria-label="Add an employee ID to the queue"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <Button type="submit" variant="outline" size="sm" disabled={draft.trim().length === 0}>
              Add to queue
            </Button>
          </form>

          {rows.length === 0 ? (
            <StateView
              icon="queue"
              title="No joiners on the queue"
              body={
                <>
                  The service answers about one employee at a time and has no route that lists new
                  hires, so the queue starts empty. Add an employee ID — <code>NJ1004</code>, for
                  example — and run a recommendation to populate it.
                </>
              }
            />
          ) : (
            <div className={styles.table}>
              <div className={styles.tableHead}>
                <span>ID</span>
                <span>Name</span>
                <span>Department · role</span>
                <span>Start</span>
                <span>Peer group</span>
                <span>State</span>
                <span />
              </div>
              {rows.map((row) => (
                <QueueRow
                  key={row.employeeId}
                  row={row}
                  busy={runningEmployeeId === row.employeeId}
                  onRun={onRun}
                  onOpen={onOpen}
                  onRemove={onRemove}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
