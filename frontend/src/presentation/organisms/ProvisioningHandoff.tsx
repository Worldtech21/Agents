/**
 * The handoff strip and the JSON payload panel.
 *
 * "Open access request" used to be permanently disabled, because the service
 * could not write. It can now: pressing it raises one request per ticked
 * entitlement. Each is judged on its own — low-risk ones are granted in the
 * same call, the rest go to the joiner's manager — so the result is a summary
 * rather than a single yes or no.
 */

import { Button } from '@presentation/atoms/Button';
import styles from '@presentation/organisms/organisms.module.css';

export interface ProvisioningHandoffProps {
  readonly instructions: string;
  readonly payloadJson: string;
  readonly isPayloadOpen: boolean;
  readonly onTogglePayload: () => void;
  readonly selectionLabel: string;
  readonly onOpenAccessRequest: () => void;
  readonly canSubmit: boolean;
  readonly isSubmitting: boolean;
  /** What happened last time, or null before anything has been submitted. */
  readonly submitSummary: string | null;
}

export function ProvisioningHandoff({
  instructions,
  payloadJson,
  isPayloadOpen,
  onTogglePayload,
  selectionLabel,
  onOpenAccessRequest,
  canSubmit,
  isSubmitting,
  submitSummary,
}: ProvisioningHandoffProps) {
  return (
    <>
      <section className={styles.handoff} aria-label="Provisioning handoff">
        <div className={styles.handoffText}>
          <span className={styles.handoffTitle}>Provisioning handoff</span>
          <span className={styles.handoffBody}>{instructions}</span>
        </div>
        <div className={styles.handoffActions}>
          <Button
            variant="outline"
            size="md"
            onClick={onTogglePayload}
            aria-expanded={isPayloadOpen}
            aria-controls="provisioning-payload"
          >
            {isPayloadOpen ? 'Hide payload' : 'View JSON payload'}
          </Button>
          <Button
            variant="primary"
            size="md"
            busy={isSubmitting}
            disabled={!canSubmit || isSubmitting}
            onClick={onOpenAccessRequest}
            title={
              canSubmit
                ? 'Raise one request per ticked entitlement.'
                : 'Tick at least one entitlement first.'
            }
          >
            Open access request
          </Button>
        </div>
      </section>

      {submitSummary ? (
        <p className={styles.handoffResult} role="status">
          {submitSummary}
        </p>
      ) : null}

      {isPayloadOpen ? (
        <>
          <pre id="provisioning-payload" className={styles.payload}>
            {payloadJson}
          </pre>
          <span className={styles.handoffBody} style={{ display: 'block', marginTop: 8 }}>
            {selectionLabel}
          </span>
        </>
      ) : null}
    </>
  );
}
