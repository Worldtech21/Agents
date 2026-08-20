/**
 * The recommendation report, beside the live agent trace.
 *
 * Every branch a real run can take has a rendering: nothing selected, a run in
 * flight, a documented refusal, a reply that broke the JSON contract, and the
 * report itself.
 */

import { useMemo, useState } from 'react';

import { toProvisioningPayload } from '@bff/mappers/recommendation.mapper';
import type { RecommendationOutcome } from '@bff/outcome';
import type { TracePanelVM } from '@bff/viewmodels';
import { Button } from '@presentation/atoms/Button';
import { Icon } from '@presentation/atoms/Icon';
import { SkeletonRegion } from '@presentation/atoms/Skeleton';
import {
  EntitlementCard,
  EntitlementCardSkeleton,
  OptionalEntitlementRow,
} from '@presentation/molecules/EntitlementCard';
import {
  ErrorState,
  MalformedReplyState,
  RefusalState,
  StateView,
} from '@presentation/molecules/StateViews';
import { AgentTracePanel } from '@presentation/organisms/AgentTracePanel';
import {
  EmployeeProfileCard,
  EmployeeProfileCardSkeleton,
} from '@presentation/organisms/EmployeeProfileCard';
import { ProvisioningHandoff } from '@presentation/organisms/ProvisioningHandoff';
import { SodPanel } from '@presentation/organisms/SodPanel';
import styles from '@presentation/screens/screens.module.css';

export interface RecommendationScreenProps {
  readonly employeeId: string | null;
  readonly outcome: RecommendationOutcome | undefined;
  readonly isRunning: boolean;
  readonly runError: Error | null;
  readonly trace: TracePanelVM;
  readonly onRun: (employeeId: string) => void;
  readonly onGoToQueue: () => void;
}

export function RecommendationScreen({
  employeeId,
  outcome,
  isRunning,
  runError,
  trace,
  onRun,
  onGoToQueue,
}: RecommendationScreenProps) {
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [isPayloadOpen, setPayloadOpen] = useState(false);

  const recommendation = outcome?.kind === 'recommendation' ? outcome.view : null;

  const selectedIds = useMemo(() => {
    if (!recommendation) return new Set<string>();
    return new Set(
      recommendation.recommended
        .map((item) => item.entitlementId)
        .filter((id) => !excluded.has(id)),
    );
  }, [recommendation, excluded]);

  const payloadJson = useMemo(() => {
    if (outcome?.kind !== 'recommendation') return '';
    return toProvisioningPayload(outcome.payload, selectedIds);
  }, [outcome, selectedIds]);

  const toggle = (entitlementId: string) => {
    setExcluded((previous) => {
      const next = new Set(previous);
      if (next.has(entitlementId)) next.delete(entitlementId);
      else next.add(entitlementId);
      return next;
    });
  };

  const replay = () => {
    if (employeeId) onRun(employeeId);
  };

  return (
    <div className={styles.reportGrid}>
      <div className={styles.reportScroll}>
        <ReportBody
          employeeId={employeeId}
          outcome={outcome}
          isRunning={isRunning}
          runError={runError}
          excluded={excluded}
          selectedCount={selectedIds.size}
          payloadJson={payloadJson}
          isPayloadOpen={isPayloadOpen}
          onTogglePayload={() => setPayloadOpen((open) => !open)}
          onToggleEntitlement={toggle}
          onRun={onRun}
          onGoToQueue={onGoToQueue}
        />
      </div>

      <AgentTracePanel
        trace={trace}
        isRunning={isRunning}
        canReplay={employeeId !== null}
        onReplay={replay}
      />
    </div>
  );
}

/* ----------------------------------------------------------------- body --- */

interface ReportBodyProps {
  readonly employeeId: string | null;
  readonly outcome: RecommendationOutcome | undefined;
  readonly isRunning: boolean;
  readonly runError: Error | null;
  readonly excluded: ReadonlySet<string>;
  readonly selectedCount: number;
  readonly payloadJson: string;
  readonly isPayloadOpen: boolean;
  readonly onTogglePayload: () => void;
  readonly onToggleEntitlement: (entitlementId: string) => void;
  readonly onRun: (employeeId: string) => void;
  readonly onGoToQueue: () => void;
}

function ReportBody({
  employeeId,
  outcome,
  isRunning,
  runError,
  excluded,
  selectedCount,
  payloadJson,
  isPayloadOpen,
  onTogglePayload,
  onToggleEntitlement,
  onRun,
  onGoToQueue,
}: ReportBodyProps) {
  if (isRunning && outcome === undefined) return <RecommendationSkeleton />;

  if (runError) {
    return (
      <ErrorState
        title="The run could not be completed"
        error={runError}
        onRetry={employeeId ? () => onRun(employeeId) : undefined}
      />
    );
  }

  if (!employeeId) {
    return (
      <StateView
        icon="report"
        title="No joiner selected"
        body="Enter an employee ID above and run a recommendation, or pick one from the queue."
        actions={
          <Button variant="outline" size="sm" onClick={onGoToQueue}>
            Go to the queue
          </Button>
        }
      />
    );
  }

  if (outcome === undefined) {
    return (
      <StateView
        icon="play"
        title={`No recommendation yet for ${employeeId}`}
        body="The supervisor has not been asked about this joiner in this session. Running one delegates across the mesh and takes a moment."
        actions={
          <Button variant="primary" size="sm" onClick={() => onRun(employeeId)}>
            <Icon name="play" size={13} fill="currentColor" strokeWidth={1.8} />
            Run recommendation
          </Button>
        }
      />
    );
  }

  if (outcome.kind === 'refusal') {
    return (
      <RefusalState
        refusal={outcome.view}
        actions={
          <Button variant="outline" size="sm" onClick={() => onRun(employeeId)}>
            Run again
          </Button>
        }
      />
    );
  }

  if (outcome.kind === 'unparseable') {
    return (
      <MalformedReplyState
        reason={outcome.reason}
        raw={outcome.raw}
        actions={
          <Button variant="outline" size="sm" onClick={() => onRun(employeeId)}>
            Run again
          </Button>
        }
      />
    );
  }

  const view = outcome.view;

  return (
    <>
      <EmployeeProfileCard employee={view.employee} />

      {view.incompleteNote ? (
        <div className={styles.incomplete} role="status">
          <Icon name="alert" size={16} stroke="var(--amber)" />
          <span>
            The supervisor flagged this run as incomplete: {view.incompleteNote}
          </span>
        </div>
      ) : null}

      <div className={styles.sectionHead}>
        <h4 className={styles.sectionTitle}>Recommended entitlements</h4>
        <span className={styles.sectionNote}>
          Birthright and peer affinity, at the threshold the policy agent reported
        </span>
        <span className={styles.sectionMeta}>
          {selectedCount} of {view.recommended.length} selected
        </span>
      </div>

      {view.recommended.length === 0 ? (
        <StateView
          inline
          icon="report"
          title="Nothing met the threshold"
          body="The supervisor returned no recommended entitlements for this joiner. Any candidates it found are listed under Optional below."
        />
      ) : (
        <div className={styles.cardStack}>
          {view.recommended.map((entitlement) => (
            <EntitlementCard
              key={entitlement.entitlementId}
              entitlement={entitlement}
              selected={!excluded.has(entitlement.entitlementId)}
              onToggle={onToggleEntitlement}
            />
          ))}
        </div>
      )}

      <div className={[styles.sectionHead, styles.optionalHead].join(' ')}>
        <h4 className={styles.sectionTitle}>Optional</h4>
        <span className={styles.sectionNote}>Below threshold — needs a justified request</span>
      </div>

      {view.optional.length === 0 ? (
        <StateView
          inline
          icon="check"
          title="No optional entitlements"
          body="Every candidate the peer affinity agent surfaced either met the policy threshold or was not returned."
        />
      ) : (
        <div className={styles.cardStack}>
          {view.optional.map((entitlement) => (
            <OptionalEntitlementRow key={entitlement.entitlementId} entitlement={entitlement} />
          ))}
        </div>
      )}

      <SodPanel sod={view.sod} />

      <ProvisioningHandoff
        instructions={view.provisioningInstructions}
        payloadJson={payloadJson}
        isPayloadOpen={isPayloadOpen}
        onTogglePayload={onTogglePayload}
        selectionLabel={`Payload reflects ${selectedCount} of ${view.recommended.length} recommended entitlements · thread ${view.threadId}`}
      />
    </>
  );
}

function RecommendationSkeleton() {
  return (
    <SkeletonRegion label="Running the recommendation">
      <EmployeeProfileCardSkeleton />
      <div className={styles.sectionHead}>
        <h4 className={styles.sectionTitle}>Recommended entitlements</h4>
        <span className={styles.sectionNote}>Waiting on the supervisor</span>
      </div>
      <div className={styles.cardStack}>
        {Array.from({ length: 4 }, (_, index) => (
          <EntitlementCardSkeleton key={index} />
        ))}
      </div>
    </SkeletonRegion>
  );
}
