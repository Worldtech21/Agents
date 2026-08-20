import { TONE_VARIABLE } from '@bff/tone';
import type { TraceRowVM } from '@bff/viewmodels';
import { Skeleton } from '@presentation/atoms/Skeleton';
import { StatusDot } from '@presentation/atoms/StatusDot';
import styles from '@presentation/molecules/molecules.module.css';

export function TraceRow({ row, isLast }: { row: TraceRowVM; isLast: boolean }) {
  const labelClass = [
    styles.traceLabel,
    row.state === 'active' ? styles.traceLabelActive : '',
    row.state === 'idle' ? styles.traceLabelIdle : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.traceRow}>
      <div className={styles.traceRail}>
        <StatusDot
          tone={row.tone}
          size="lg"
          pulsing={row.state === 'active'}
          className={styles.traceDot}
        />
        {!isLast ? (
          <span
            className={styles.traceLine}
            style={{
              background: row.state === 'idle' ? 'var(--hairline)' : TONE_VARIABLE[row.tone],
            }}
          />
        ) : null}
      </div>
      <div className={styles.traceBody}>
        <div className={styles.traceHeader}>
          <span className={labelClass}>{row.label}</span>
          {row.durationLabel ? <span className={styles.traceMs}>{row.durationLabel}</span> : null}
        </div>
        <span className={styles.traceAgent}>{row.agentLabel}</span>
        {row.detail ? <span className={styles.traceDetail}>{row.detail}</span> : null}
      </div>
    </div>
  );
}

export function TraceRowSkeleton() {
  return (
    <div className={styles.traceRow}>
      <div className={styles.traceRail}>
        <Skeleton width="8px" height="8px" shape="pill" className={styles.traceDot} />
        <Skeleton width="1.5px" height="100%" shape="pill" />
      </div>
      <div className={styles.traceBody}>
        <Skeleton width="60%" height="14px" />
        <Skeleton width="34%" height="12px" style={{ marginTop: 4 }} />
        <Skeleton width="88%" height="12px" style={{ marginTop: 4 }} />
      </div>
    </div>
  );
}
