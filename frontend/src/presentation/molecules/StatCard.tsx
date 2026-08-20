import { TONE_VARIABLE } from '@bff/tone';
import type { QueueStatVM } from '@bff/viewmodels';
import { Skeleton } from '@presentation/atoms/Skeleton';
import styles from '@presentation/molecules/molecules.module.css';

export function StatCard({ stat }: { stat: QueueStatVM }) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statLabel}>{stat.label}</span>
      <div className={styles.statValueRow}>
        <span className={styles.statValue} style={{ color: TONE_VARIABLE[stat.tone] }}>
          {stat.value}
        </span>
        {stat.unit ? <span className={styles.statUnit}>{stat.unit}</span> : null}
      </div>
      <span className={styles.statNote}>{stat.note}</span>
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className={styles.statCard}>
      <Skeleton width="88px" height="14px" />
      <Skeleton width="64px" height="40px" style={{ margin: '4px 0' }} />
      <Skeleton width="70%" height="14px" />
    </div>
  );
}
