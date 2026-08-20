import { TONE_VARIABLE } from '@bff/tone';
import type { SodPanelVM } from '@bff/viewmodels';
import { StatusLabel } from '@presentation/atoms/StatusDot';
import styles from '@presentation/organisms/organisms.module.css';

export function SodPanel({ sod }: { sod: SodPanelVM }) {
  return (
    <section className={styles.sodPanel} id="policy" aria-label="Separation of duties">
      <div className={styles.sodResult}>
        <span className={styles.fieldLabel}>Separation of duties</span>
        <span className={styles.sodResultValue} style={{ color: TONE_VARIABLE[sod.resultTone] }}>
          {sod.resultLabel}
        </span>
        <span className={styles.fieldLabel}>{sod.scopeLabel}</span>
      </div>

      <div className={styles.sodBody}>
        <p className={styles.sodSummary}>{sod.summary}</p>

        {sod.rules.length > 0 ? (
          sod.rules.map((rule) => (
            <div key={rule.key} className={styles.sodRule}>
              <span className={styles.sodRuleId}>{rule.ruleId}</span>
              <StatusLabel tone={rule.tone} label={rule.severityLabel} />
              <span className={styles.sodRuleText}>{rule.text}</span>
            </div>
          ))
        ) : (
          <span className={styles.sodEmpty}>
            {sod.conflictsFound
              ? 'The SoD agent reported a conflict without naming the rule.'
              : 'No individual rule was returned — the check reported a clean result for the set.'}
          </span>
        )}
      </div>
    </section>
  );
}
