/**
 * The recommendation report, beside the live agent trace.
 *
 * Every branch a real run can take has a rendering: nothing selected, a run in
 * flight, a documented refusal, a reply that broke the JSON contract, and the
 * report itself.
 */

import { useMemo, useState } from 'react';

import { toTraceFlow } from '@bff/mappers/flow.mapper';
import { toProvisioningPayload } from '@bff/mappers/recommendation.mapper';
import type { RecommendationOutcome } from '@bff/outcome';
import type { TracePanelVM } from '@bff/viewmodels';
import type { AgentInfoDTO } from '@infrastructure/types/api';
import { Button } from '@presentation/atoms/Button';
import { Icon } from '@presentation/atoms/Icon';
import { EntitlementCard, OptionalEntitlementRow } from '@presentation/molecules/EntitlementCard';
import {
  ErrorState,
  MalformedReplyState,
  RefusalState,
  StateView,
} from '@presentation/molecules/StateViews';
import { AgentTracePanel } from '@presentation/organisms/AgentTracePanel';
import { FlowCanvas } from '@presentation/organisms/FlowCanvas';
import { EmployeeProfileCard } from '@presentation/organisms/EmployeeProfileCard';
import { ProvisioningHandoff } from '@presentation/organisms/ProvisioningHandoff';
import { SodPanel } from '@presentation/organisms/SodPanel';
import styles from '@presentation/screens/screens.module.css';

export interface RecommendationScreenProps {
  readonly employeeId: string | null;
  readonly outcome: RecommendationOutcome | undefined;
  readonly isRunning: boolean;
  /** Whether the graph has the pane instead of the report. Owned by the shell,
      which draws the switch back in the app header. */
  readonly isGraphView: boolean;
  readonly onShowGraph: () => void;
  readonly runError: Error | null;
  readonly trace: TracePanelVM;
  /** The roster, so the flow graph can say what each worker is for. */
  readonly agents: readonly AgentInfoDTO[];
  readonly onRun: (employeeId: string) => void;
  readonly onGoToQueue: () => void;
  /** Raises one request per ticked entitlement. */
  readonly onSubmitRequests: (entitlementIds: readonly string[]) => void;
  readonly isSubmitting: boolean;
  /** What came back last time, or null before anything was submitted. */
  readonly submitSummary: string | null;
}

export function RecommendationScreen({
  employeeId,
  outcome,
  isRunning,
  isGraphView,
  onShowGraph,
  runError,
  trace,
  agents,
  onRun,
  onGoToQueue,
  onSubmitRequests,
  isSubmitting,
  submitSummary,
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

  // Kept out of the modal so the graph is already built when it opens, and so
  // it keeps growing behind the panel while the modal is shut.
  const flow = useMemo(
    () =>
      toTraceFlow({
        trace,
        running: isRunning,
        employeeId,
        agents,
        // Every ending is an answer, including a refusal: the graph's last node
        // is "the supervisor replied", not "the supervisor replied well".
        answered: outcome !== undefined,
      }),
    [trace, isRunning, employeeId, agents, outcome],
  );

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

  // A run in flight is the graph and nothing else: the report has no content to
  // show yet, and the trace panel would only list in words what the graph is
  // already drawing. When it lands the graph holds the pane at the same size —
  // the shell's Results control is what moves on, not the run finishing.
  const showGraph = isRunning || isGraphView;

  return (
    <div className={[styles.reportGrid, showGraph ? styles.reportGridSolo : ''].join(' ')}>
      {showGraph ? (
        <div className={styles.traceFlow}>
          <FlowCanvas flow={flow} isRunning={isRunning} />
        </div>
      ) : (
        <>
          <div className={styles.reportScroll}>
            <ReportBody
              employeeId={employeeId}
              outcome={outcome}
              runError={runError}
              excluded={excluded}
              selectedCount={selectedIds.size}
              payloadJson={payloadJson}
              isPayloadOpen={isPayloadOpen}
              onTogglePayload={() => setPayloadOpen((open) => !open)}
              onToggleEntitlement={toggle}
              onRun={onRun}
              onGoToQueue={onGoToQueue}
              onSubmitRequests={() => onSubmitRequests([...selectedIds])}
              isSubmitting={isSubmitting}
              submitSummary={submitSummary}
            />
          </div>

          <AgentTracePanel
            trace={trace}
            isRunning={isRunning}
            canReplay={employeeId !== null}
            onReplay={replay}
            onOpenGraph={onShowGraph}
          />
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- body --- */

interface ReportBodyProps {
  readonly employeeId: string | null;
  readonly outcome: RecommendationOutcome | undefined;
  readonly runError: Error | null;
  readonly excluded: ReadonlySet<string>;
  readonly selectedCount: number;
  readonly payloadJson: string;
  readonly isPayloadOpen: boolean;
  readonly onTogglePayload: () => void;
  readonly onToggleEntitlement: (entitlementId: string) => void;
  readonly onSubmitRequests: () => void;
  readonly isSubmitting: boolean;
  readonly submitSummary: string | null;
  readonly onRun: (employeeId: string) => void;
  readonly onGoToQueue: () => void;
}

function ReportBody({
  employeeId,
  outcome,
  runError,
  excluded,
  selectedCount,
  payloadJson,
  isPayloadOpen,
  onTogglePayload,
  onToggleEntitlement,
  onRun,
  onGoToQueue,
  onSubmitRequests,
  isSubmitting,
  submitSummary,
}: ReportBodyProps) {
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
        onOpenAccessRequest={onSubmitRequests}
        canSubmit={selectedCount > 0}
        isSubmitting={isSubmitting}
        submitSummary={submitSummary}
      />
    </>
  );
}

