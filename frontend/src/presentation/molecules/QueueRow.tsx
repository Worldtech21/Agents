import type { QueueRowVM } from '@bff/viewmodels';
import { Button } from '@presentation/atoms/Button';
import { ProgressBar } from '@presentation/atoms/ProgressBar';
import { Skeleton } from '@presentation/atoms/Skeleton';
import { StatusLabel } from '@presentation/atoms/StatusDot';
import styles from '@presentation/molecules/molecules.module.css';

export interface QueueRowProps {
  readonly row: QueueRowVM;
  readonly busy: boolean;
  readonly onRun: (employeeId: string) => void;
  readonly onOpen: (employeeId: string) => void;
  readonly onRemove: (employeeId: string) => void;
}

export function QueueRow({ row, busy, onRun, onOpen, onRemove }: QueueRowProps) {
  return (
    <div className={styles.queueRow}>
      <button type="button" className={styles.queueId} onClick={() => onOpen(row.employeeId)}>
        {row.employeeId}
      </button>
      <span className={styles.queueName}>{row.name}</span>
      <span className={styles.queueRole}>{row.role}</span>
      <span className={styles.queueStart}>{row.startLabel}</span>
      <div className={styles.queuePeers}>
        <ProgressBar
          width={row.peerBarWidth}
          label={`Peer group size for ${row.employeeId}`}
          className={styles.queuePeerBar}
        />
        <span className={styles.queuePeerCount}>{row.peersLabel}</span>
      </div>
      <StatusLabel
        tone={row.statusTone}
        label={row.statusLabel}
        pulsing={row.statusLabel === 'Running'}
      />
      <div className={styles.queueActions}>
        <Button
          size="sm"
          variant="outline"
          busy={busy}
          disabled={busy}
          onClick={() =>
            row.hasResult ? onOpen(row.employeeId) : onRun(row.employeeId)
          }
        >
          {row.actionLabel}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Remove ${row.employeeId} from the queue`}
          onClick={() => onRemove(row.employeeId)}
        >
          ×
        </Button>
      </div>
    </div>
  );
}

export function QueueRowSkeleton() {
  return (
    <div className={styles.queueRow}>
      <Skeleton width="60px" height="14px" />
      <Skeleton width="80%" height="17px" />
      <Skeleton width="90%" height="14px" />
      <Skeleton width="46px" height="14px" />
      <Skeleton width="100%" height="4px" shape="pill" />
      <Skeleton width="86px" height="14px" />
      <Skeleton width="72px" height="30px" shape="pill" style={{ justifySelf: 'end' }} />
    </div>
  );
}
