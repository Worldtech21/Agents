/**
 * `TracePanelVM` -> the delegation graph.
 *
 * The trace panel already holds every step a run emitted, in order, attributed
 * to the worker whose subgraph produced it. A graph needs one thing the list
 * does not: where a turn starts and where it ends. That is read off the
 * attribution — consecutive steps by the same worker are one turn, and the
 * first step by a different worker is a handoff.
 *
 * Nothing is invented here. A run that woke two workers draws two lanes; an
 * idle panel draws the supervisor alone.
 */

import { toDisplayLabel } from '@bff/mappers/trace.mapper';
import type {
  FlowLaneVM,
  FlowRootVM,
  FlowStepVM,
  TraceFlowVM,
  TracePanelVM,
  TraceRowVM,
  TraceStepState,
  Tone,
} from '@bff/viewmodels';

export interface FlowInput {
  readonly trace: TracePanelVM;
  readonly running: boolean;
}

export function toTraceFlow(input: FlowInput): TraceFlowVM {
  const lanes = groupIntoLanes(input.trace.rows).map(toLane);
  const activeLane = lanes.find((lane) => lane.state === 'active') ?? null;

  return {
    root: toRoot(lanes, input),
    lanes,
    statusLabel: input.trace.statusLabel,
    statusTone: input.trace.statusTone,
    metaLabel: input.trace.metaLabel,
    activeLaneKey: activeLane?.key ?? null,
    isEmpty: lanes.length === 0,
  };
}

/* ---------------------------------------------------------------- lanes --- */

/**
 * Split the flat row list into turns.
 *
 * A worker that is delegated to twice gets two lanes rather than one wide one:
 * the second delegation is a decision the supervisor made, and folding it into
 * the first would render two handoffs as one.
 */
function groupIntoLanes(rows: readonly TraceRowVM[]): TraceRowVM[][] {
  const lanes: TraceRowVM[][] = [];

  for (const row of rows) {
    const current = lanes[lanes.length - 1];
    if (current && current[0]?.agentKey === row.agentKey) current.push(row);
    else lanes.push([row]);
  }

  return lanes;
}

function toLane(rows: readonly TraceRowVM[]): FlowLaneVM {
  const first = rows[0];
  // `groupIntoLanes` only ever opens a lane with a row in it.
  if (!first) throw new Error('A lane cannot be empty.');

  const steps = rows.map(toStep);
  const state = resolveLaneState(steps);
  const elapsed = rows.reduce((total, row) => total + parseSeconds(row.durationLabel), 0);

  return {
    key: `lane-${first.key}`,
    agentKey: first.agentKey,
    agentLabel: toDisplayLabel(first.agentLabel),
    statusLabel: LANE_STATUS[state],
    state,
    tone: LANE_TONE[state],
    stepCountLabel: rows.length === 1 ? '1 step' : `${rows.length} steps`,
    // While a lane is open its last step has no elapsed time yet, so a running
    // total would tick backwards against the wall clock. Show it once closed.
    durationLabel: state === 'active' || elapsed === 0 ? '' : `${elapsed.toFixed(2)}s`,
    steps,
  };
}

/** The same state -> colour rule the trace rows use, so both panels agree. */
const LANE_TONE: Record<TraceStepState, Tone> = {
  active: 'blue',
  done: 'green',
  failed: 'red',
  idle: 'neutral',
};

const LANE_STATUS: Record<TraceStepState, string> = {
  active: 'Working',
  done: 'Done',
  failed: 'Failed',
  idle: 'Queued',
};

function resolveLaneState(steps: readonly FlowStepVM[]): TraceStepState {
  if (steps.some((step) => step.state === 'failed')) return 'failed';
  if (steps.some((step) => step.state === 'active')) return 'active';
  if (steps.every((step) => step.state === 'idle')) return 'idle';
  return 'done';
}

function toStep(row: TraceRowVM): FlowStepVM {
  return {
    key: row.key,
    label: toDisplayLabel(row.label),
    detail: row.detail,
    durationLabel: row.durationLabel,
    state: row.state,
    tone: row.tone,
  };
}

/** `"1.84s"` -> `1.84`; an open step carries no label and contributes nothing. */
function parseSeconds(label: string): number {
  const seconds = Number.parseFloat(label);
  return Number.isFinite(seconds) ? seconds : 0;
}

/* ----------------------------------------------------------------- root --- */

function toRoot(lanes: readonly FlowLaneVM[], input: FlowInput): FlowRootVM {
  const workers = new Set(lanes.map((lane) => lane.agentKey));
  const stepCount = lanes.reduce((total, lane) => total + lane.steps.length, 0);
  const failed = lanes.some((lane) => lane.state === 'failed');

  const state: TraceStepState = input.running
    ? 'active'
    : failed
      ? 'failed'
      : lanes.length > 0
        ? 'done'
        : 'idle';

  return {
    label: 'Supervisor',
    statusLabel: input.running
      ? 'Delegating'
      : failed
        ? 'Run failed'
        : lanes.length > 0
          ? 'Run complete'
          : 'Idle',
    state,
    tone: state === 'active' ? 'blue' : state === 'failed' ? 'red' : state === 'done' ? 'green' : 'neutral',
    detail:
      lanes.length === 0
        ? 'No worker has been woken yet'
        : `${plural(workers.size, 'worker')} · ${plural(stepCount, 'step')}`,
  };
}

function plural(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}
