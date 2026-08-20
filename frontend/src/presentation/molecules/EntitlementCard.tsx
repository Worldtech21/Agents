import type { EntitlementVM, OptionalEntitlementVM } from '@bff/viewmodels';
import { Icon } from '@presentation/atoms/Icon';
import { ProgressBar } from '@presentation/atoms/ProgressBar';
import { Skeleton } from '@presentation/atoms/Skeleton';
import { StatusLabel } from '@presentation/atoms/StatusDot';
import styles from '@presentation/molecules/molecules.module.css';

export interface EntitlementCardProps {
  readonly entitlement: EntitlementVM;
  readonly selected: boolean;
  readonly onToggle: (entitlementId: string) => void;
}

export function EntitlementCard({ entitlement, selected, onToggle }: EntitlementCardProps) {
  return (
    <div
      className={[styles.entitlementCard, selected ? '' : styles.entitlementExcluded]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`Include ${entitlement.name} in the provisioning payload`}
        className={[styles.checkbox, selected ? styles.checkboxChecked : '']
          .filter(Boolean)
          .join(' ')}
        onClick={() => onToggle(entitlement.entitlementId)}
      >
        <Icon
          name="check"
          size={12}
          strokeWidth={3}
          stroke="var(--on-blue)"
          style={{ opacity: selected ? 1 : 0 }}
        />
      </button>

      <div className={styles.entitlementIdentity}>
        <span className={styles.entitlementName}>{entitlement.name}</span>
        <span className={styles.entitlementMeta}>{entitlement.subtitle}</span>
      </div>

      <div className={styles.affinityBlock}>
        <div className={styles.affinityHeader}>
          <span className={styles.affinityValue}>{entitlement.affinityLabel}</span>
          <span className={styles.affinityPeers}>{entitlement.peerCountLabel} peers hold</span>
        </div>
        <ProgressBar
          width={entitlement.affinityBarWidth}
          value={entitlement.affinityPercent}
          label={`Peer affinity for ${entitlement.name}`}
        />
      </div>

      <div className={styles.riskBlock}>
        <StatusLabel tone={entitlement.riskTone} label={entitlement.riskLabel} />
        <span className={styles.riskScore}>{entitlement.riskScoreLabel}</span>
      </div>

      <div className={styles.policyBlock}>
        <span className={styles.policyStatus}>{entitlement.statusLabel}</span>
        <span className={styles.policyNote}>
          <a href="#policy" className={styles.policyRule}>
            {entitlement.policyRule}
          </a>
          {entitlement.note ? ` — ${entitlement.note}` : null}
        </span>
      </div>
    </div>
  );
}

export function EntitlementCardSkeleton() {
  return (
    <div className={styles.entitlementCard}>
      <Skeleton width="22px" height="22px" shape="pill" />
      <div className={styles.entitlementIdentity}>
        <Skeleton width="72%" height="17px" />
        <Skeleton width="52%" height="14px" style={{ marginTop: 4 }} />
      </div>
      <div className={styles.affinityBlock}>
        <Skeleton width="60%" height="21px" />
        <Skeleton width="100%" height="4px" shape="pill" />
      </div>
      <div className={styles.riskBlock}>
        <Skeleton width="64px" height="14px" />
        <Skeleton width="48px" height="12px" style={{ marginTop: 4 }} />
      </div>
      <div className={styles.policyBlock}>
        <Skeleton width="70%" height="14px" />
        <Skeleton width="90%" height="12px" style={{ marginTop: 4 }} />
      </div>
    </div>
  );
}

export function OptionalEntitlementRow({ entitlement }: { entitlement: OptionalEntitlementVM }) {
  return (
    <div className={styles.optionalRow}>
      <div className={styles.entitlementIdentity}>
        <span className={styles.entitlementName}>{entitlement.name}</span>
        <span className={styles.entitlementMeta}>{entitlement.subtitle}</span>
      </div>
      <span className={styles.optionalAffinity}>{entitlement.affinityLabel}</span>
      <StatusLabel tone={entitlement.riskTone} label={entitlement.riskLabel} />
      <span className={styles.optionalReason}>{entitlement.reason}</span>
    </div>
  );
}
