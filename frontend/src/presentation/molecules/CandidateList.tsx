/**
 * The entitlements the assistant offers when a request matched more than one.
 *
 * Each card shows only the catalog's own description, because an employee
 * picks by what the access does, not by a name like SAP_FIN_DISPLAY. Choosing one
 * only answers the assistant's question — it sends a turn naming the
 * entitlement; it requests nothing.
 */

import type { EntitlementCandidateVM } from '@bff/viewmodels';
import { Button } from '@presentation/atoms/Button';
import { Chip } from '@presentation/atoms/Chip';
import styles from '@presentation/molecules/molecules.module.css';

export interface CandidateListProps {
  readonly candidates: readonly EntitlementCandidateVM[];
  /** False once the conversation has moved on: the list stays, read-only. */
  readonly isLive: boolean;
  readonly disabled: boolean;
  readonly onChoose: (candidate: EntitlementCandidateVM) => void;
}

export function CandidateList({ candidates, isLive, disabled, onChoose }: CandidateListProps) {
  return (
    <ul className={styles.candidateList} aria-label="Entitlements that match your request">
      {candidates.map((candidate) => (
        <li key={candidate.key} className={styles.candidateCard}>
          <p className={styles.candidateDescription}>{candidate.description}</p>
          {candidate.alreadyHeld ? (
            <Chip title="This is already on your account">You have this</Chip>
          ) : isLive ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onChoose(candidate)}
              // The card has no name on it, so the button's accessible name
              // carries the description instead of a bare "Choose".
              aria-label={`Choose: ${candidate.description}`}
            >
              Choose
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
