/**
 * The handoff strip and the JSON payload panel.
 *
 * "Open access request" deliberately does nothing here: the service is
 * read-only end to end, and wiring this button to anything that writes would
 * contradict the guarantee the sidebar makes.
 */

import { Button } from '@presentation/atoms/Button';
import styles from '@presentation/organisms/organisms.module.css';

export interface ProvisioningHandoffProps {
  readonly instructions: string;
  readonly payloadJson: string;
  readonly isPayloadOpen: boolean;
  readonly onTogglePayload: () => void;
  readonly selectionLabel: string;
}

export function ProvisioningHandoff({
  instructions,
  payloadJson,
  isPayloadOpen,
  onTogglePayload,
  selectionLabel,
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
            disabled
            title="This service is read-only; raise the request in the IAM workflow."
          >
            Open access request
          </Button>
        </div>
      </section>

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
