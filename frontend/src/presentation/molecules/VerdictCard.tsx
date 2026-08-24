/**
 * The confirmation card under the conversation.
 *
 * Everything shown here comes from `POST /requests/analyze` — the rules engine
 * — and not from the assistant that proposed it. That is the whole point of the
 * card: an employee is never asked to confirm a claim the backend would
 * contradict. See application/hooks/useVerdict.ts.
 *
 * It is also the only place in the employee flow where anything is written, so
 * it says plainly what pressing the button will do.
 */

import { TONE_VARIABLE } from '@bff/tone';
import type { VerdictVM } from '@bff/viewmodels';
import { Button } from '@presentation/atoms/Button';
import { Chip } from '@presentation/atoms/Chip';
import { Icon } from '@presentation/atoms/Icon';
import { Skeleton } from '@presentation/atoms/Skeleton';
import styles from '@presentation/molecules/molecules.module.css';

export interface VerdictCardProps {
  readonly verdict: VerdictVM | null;
  readonly isLoading: boolean;
  readonly isSubmitting: boolean;
  readonly onConfirm: (verdict: VerdictVM) => void;
  readonly onDismiss: () => void;
}

export function VerdictCard({
  verdict,
  isLoading,
  isSubmitting,
  onConfirm,
  onDismiss,
}: VerdictCardProps) {
  if (isLoading) {
    return (
      <section className={styles.verdictCard} aria-busy="true">
        <Skeleton width="40%" height="17px" />
        <Skeleton width="90%" height="14px" />
        <Skeleton width="140px" height="32px" shape="pill" />
      </section>
    );
  }

  if (!verdict) return null;

  return (
    <section
      className={styles.verdictCard}
      style={{ borderColor: TONE_VARIABLE[verdict.summaryTone] }}
      aria-label={`Confirm your request for ${verdict.entitlementName}`}
    >
      <header className={styles.verdictHead}>
        <Icon name={verdict.approvalRequired ? 'shield' : 'checkCircle'} size={18} />
        <div>
          <span className={styles.verdictName}>{verdict.entitlementName}</span>
          <span className={styles.verdictApp}>{verdict.application}</span>
        </div>
        <span className={styles.verdictRisk} style={{ color: TONE_VARIABLE[verdict.riskTone] }}>
          {verdict.riskLabel}
        </span>
      </header>

      <p className={styles.verdictSummary} style={{ color: TONE_VARIABLE[verdict.summaryTone] }}>
        {verdict.summary}
      </p>

      {/* Quoted so the employee can see the rule, not just its conclusion. */}
      {verdict.policyBasis ? (
        <p className={styles.verdictPolicy}>{verdict.policyBasis}</p>
      ) : null}

      {verdict.sodConflicts.length > 0 ? (
        <div className={styles.verdictChips}>
          {verdict.sodConflicts.map((conflict) => (
            <Chip key={conflict}>{conflict}</Chip>
          ))}
        </div>
      ) : null}

      <div className={styles.verdictActions}>
        <Button variant="ghost" size="sm" onClick={onDismiss} disabled={isSubmitting}>
          Not now
        </Button>
        <Button
          variant="primary"
          size="md"
          busy={isSubmitting}
          disabled={verdict.actionDisabled || isSubmitting}
          onClick={() => onConfirm(verdict)}
        >
          {verdict.actionLabel}
        </Button>
      </div>
    </section>
  );
}
