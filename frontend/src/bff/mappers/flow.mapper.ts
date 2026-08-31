/**
 * `TracePanelVM` -> the system's execution flow.
 *
 * The trace panel already holds every step a run emitted, in order, attributed
 * to the worker whose subgraph produced it. A graph needs two things the list
 * does not: where one piece of work ends and the next begins, and what the
 * shape *around* the work is — the request that started it, the supervisor
 * presiding, the answer going back out.
 *
 * The first is read off the namespace instance the backend streams with every
 * envelope. LangGraph opens a fresh subgraph instance each time the supervisor
 * delegates, so `User_Profiling_Agent:bcf72bc4…` is not merely *who* worked but
 * *which visit* — and consecutive rows sharing one is exactly one delegation's
 * worth of work.
 *
 * Each such branch becomes a node of its own, with a line out from the
 * supervisor and a line back to it. An agent called twice therefore gets two
 * branches rather than one node holding two conversations that never met. The
 * supervisor's own rows never become a branch: its delegations are the lines,
 * and its final answer is the report on the page.
 *
 * The second is the spine — request, supervisor, builder, response — which is
 * the system's architecture rather than anything a particular run emitted. It
 * is drawn for every run, and each node on it carries the run's state, so an
 * empty canvas still says what the system *is* while it waits.
 */

import { SUPERVISOR_KEY, toDisplayLabel, truncate } from '@bff/mappers/trace.mapper';
import type {
  FlowAgentVM,
  FlowHandoffVM,
  FlowLane,
  FlowReturnVM,
  FlowRootVM,
  FlowStepVM,
  FlowTerminalVM,
  TraceFlowVM,
  TracePanelVM,
  TraceRowVM,
  TraceStepState,
  Tone,
} from '@bff/viewmodels';
import type { AgentInfoDTO } from '@infrastructure/types/api';

/** Longest opening-step note a connection carries before eliding. */
const NOTE_LIMIT = 64;
/** Longest role line a worker card carries under its name. */
const ROLE_LIMIT = 96;

/** The first worker is node 3: the request is 1 and the supervisor is 2. */
const FIRST_AGENT_NUMBER = 3;

export interface FlowInput {
  readonly trace: TracePanelVM;
  readonly running: boolean;
  /** The joiner the run is about, which is what the request node says. */
  readonly employeeId: string | null;
  /** The roster, for the one line saying what each worker is for. */
  readonly agents: readonly AgentInfoDTO[];
  /** Set once the supervisor has produced an answer, however it ended. */
  readonly answered: boolean;
}

export function toTraceFlow(input: FlowInput): TraceFlowVM {
  const { branches, handoffs, returns } = toDelegations(input.trace.rows, describeRoles(input.agents));
  const active = branches.find((branch) => branch.state === 'active') ?? null;
  const failed = input.trace.rows.some((row) => row.kind === 'error' || row.state === 'failed');

  return {
    title: 'Multi-Agent LangGraph System — execution flow',
    request: toRequest(input),
    root: toRoot(branches, input.trace.rows, input),
    branches,
    handoffs,
    returns,
    builder: toBuilder(branches, input, failed),
    response: toResponse(input, failed),
    statusLabel: input.trace.statusLabel,
    statusTone: input.trace.statusTone,
    metaLabel: input.trace.metaLabel,
    activeAgentKey: active?.key ?? null,
    isEmpty: branches.length === 0,
  };
}

/* ----------------------------------------------------------------- lanes --- */

/**
 * Which hue a worker is drawn in.
 *
 * By what the worker is *for*, not by what it is called: the roster can be
 * renamed and the drawing keeps its colours. A worker nothing here recognises
 * still needs a hue of its own, so the unmatched ones take the remaining lanes
 * in the order the run first reaches them — deterministic, and two strangers
 * never collide until every lane is spoken for.
 */
const LANE_KEYWORDS: ReadonlyArray<readonly [RegExp, FlowLane]> = [
  [/profil|joiner|identit|hr\b/i, 'information'],
  [/affinit|peer|intellig/i, 'intelligence'],
  [/entitle|access|verif/i, 'verification'],
  [/policy|policies|evaluat|complian/i, 'evaluation'],
  [/\bsod\b|separation|duties|risk|analy/i, 'analysis'],
];

const SPARE_LANES: readonly FlowLane[] = [
  'information',
  'intelligence',
  'verification',
  'evaluation',
  'analysis',
];

function laneAssigner(): (agentKey: string) => FlowLane {
  const settled = new Map<string, FlowLane>();
  const taken = new Set<FlowLane>();

  return (agentKey) => {
    const already = settled.get(agentKey);
    if (already) return already;

    const matched = LANE_KEYWORDS.find(([pattern]) => pattern.test(agentKey))?.[1];
    const lane =
      matched ?? SPARE_LANES.find((candidate) => !taken.has(candidate)) ?? 'information';

    settled.set(agentKey, lane);
    taken.add(lane);
    return lane;
  };
}

/* ----------------------------------------------------------------- roles --- */

/**
 * Agent name -> the one line the card carries under it.
 *
 * The roster's own description, which is the system's statement of what the
 * worker is for. A run whose roster has not loaded yet still draws; the card
 * falls back to counting the work it did.
 */
function describeRoles(agents: readonly AgentInfoDTO[]): ReadonlyMap<string, string> {
  const roles = new Map<string, string>();
  for (const agent of agents) {
    roles.set(agent.name.toLowerCase(), truncate(agent.description, ROLE_LIMIT));
  }
  return roles;
}

/* ----------------------------------------------------------- delegations --- */

interface Branch {
  readonly instanceKey: string;
  readonly agentKey: string;
  readonly rows: TraceRowVM[];
}

/**
 * Cut the flat row list into one branch per delegation.
 *
 * Consecutive rows from the same subgraph instance are one visit. The run
 * passing back through the supervisor changes the instance, so a second
 * delegation to the same agent opens a second branch even if the graph should
 * ever hand out an instance id twice.
 */
function splitByInstance(rows: readonly TraceRowVM[]): Branch[] {
  const branches: Branch[] = [];

  for (const row of rows) {
    const current = branches[branches.length - 1];
    if (current && current.instanceKey === row.instanceKey) current.rows.push(row);
    else branches.push({ instanceKey: row.instanceKey, agentKey: row.agentKey, rows: [row] });
  }

  return branches;
}

/**
 * The branches, and both halves of every delegation.
 *
 * Built in one pass because all three need the same fact — the raw agent key
 * behind a branch — to name the graph's own edges (`transfer_to_…`) and to
 * pick the lane. Splitting them would mean carrying that key on the view model
 * only so a second pass could read it back.
 */
function toDelegations(
  rows: readonly TraceRowVM[],
  roles: ReadonlyMap<string, string>,
): { branches: FlowAgentVM[]; handoffs: FlowHandoffVM[]; returns: FlowReturnVM[] } {
  const workers = splitByInstance(rows).filter((branch) => branch.agentKey !== SUPERVISOR_KEY);
  const laneFor = laneAssigner();

  // "2nd call" is only worth saying when the run reached the agent more than
  // once; the count has to be taken across the whole run before any of it is
  // labelled, since the first visit only becomes "1st" once a second exists.
  const visitCounts = new Map<string, number>();
  for (const branch of workers) {
    visitCounts.set(branch.agentKey, (visitCounts.get(branch.agentKey) ?? 0) + 1);
  }

  const visitsSoFar = new Map<string, number>();
  const branches: FlowAgentVM[] = [];
  const handoffs: FlowHandoffVM[] = [];
  const returns: FlowReturnVM[] = [];

  workers.forEach((branch, index) => {
    const visit = (visitsSoFar.get(branch.agentKey) ?? 0) + 1;
    visitsSoFar.set(branch.agentKey, visit);

    const state = branchState(branch.rows);
    const lane = laneFor(branch.agentKey);
    const elapsed = branch.rows.reduce((total, row) => total + parseSeconds(row.durationLabel), 0);
    const orderLabel = String(FIRST_AGENT_NUMBER + index);
    const agentLabel = toDisplayLabel(branch.rows[0]?.agentLabel ?? branch.agentKey);

    const vm: FlowAgentVM = {
      key: branch.instanceKey,
      agentLabel,
      role: roles.get(branch.agentKey.toLowerCase()) ?? describeWork(branch.rows),
      orderLabel,
      lane,
      visitLabel: (visitCounts.get(branch.agentKey) ?? 0) > 1 ? `${ordinal(visit)} call` : '',
      statusLabel: STATE_STATUS[state],
      state,
      tone: STATE_TONE[state],
      stepCountLabel: branch.rows.length === 1 ? '1 step' : `${branch.rows.length} steps`,
      // An open step has no elapsed time yet, so a running total would tick
      // backwards against the wall clock. Show it once the visit is closed.
      durationLabel: state === 'active' || elapsed === 0 ? '' : `${elapsed.toFixed(2)}s`,
      steps: branch.rows.map((row, stepIndex) => toStep(row, `${orderLabel}.${stepIndex + 1}`)),
    };

    branches.push(vm);

    handoffs.push({
      key: `handoff-${branch.instanceKey}`,
      order: index + 1,
      targetKey: branch.instanceKey,
      transferLabel: `transfer_to_${branch.agentKey.toLowerCase()}`,
      note: truncate(vm.steps[0]?.label ?? agentLabel, NOTE_LIMIT),
      lane,
      state,
      tone: STATE_TONE[state],
    });

    // A worker that is still working has not handed anything back yet, so its
    // return line is drawn but not yet earned.
    const handedBack = state === 'done' || state === 'failed';
    returns.push({
      key: `return-${branch.instanceKey}`,
      sourceKey: branch.instanceKey,
      label: 'transfer_back_to_supervisor',
      lane,
      state: handedBack ? state : 'idle',
      tone: handedBack ? STATE_TONE[state] : STATE_TONE.idle,
    });
  });

  return { branches, handoffs, returns };
}

function branchState(rows: readonly TraceRowVM[]): TraceStepState {
  if (rows.some((row) => row.state === 'failed')) return 'failed';
  if (rows.some((row) => row.state === 'active')) return 'active';
  if (rows.every((row) => row.state === 'idle')) return 'idle';
  return 'done';
}

/** The same state -> colour rule the trace rows use, so both panels agree. */
const STATE_TONE: Record<TraceStepState, Tone> = {
  active: 'blue',
  done: 'green',
  failed: 'red',
  idle: 'neutral',
};

const STATE_STATUS: Record<TraceStepState, string> = {
  active: 'Working',
  done: 'Done',
  failed: 'Failed',
  idle: 'Queued',
};

/** Stand-in role line for a worker the roster does not describe. */
function describeWork(rows: readonly TraceRowVM[]): string {
  const tools = rows.filter((row) => row.kind === 'tool').length;
  if (tools === 0) return 'Reported to the supervisor';
  return tools === 1 ? 'Called 1 tool for the supervisor' : `Called ${tools} tools for the supervisor`;
}

function toStep(row: TraceRowVM, orderLabel: string): FlowStepVM {
  return {
    key: row.key,
    // The node is already named for the worker, so its own report does not
    // need to say the name again — the list beside the graph still does.
    label: row.kind === 'report' ? 'Reported' : toDisplayLabel(row.label),
    kind: row.kind,
    orderLabel,
    detail: row.detail,
    resultPreview: row.resultPreview,
    inputPayload: row.inputPayload,
    outputPayload: row.outputPayload,
    durationLabel: row.durationLabel,
    state: row.state,
    tone: row.tone,
  };
}

/* ----------------------------------------------------------------- spine --- */

/** What the supervisor does for every run, which is what its card lists. */
const SUPERVISOR_DUTIES: readonly string[] = [
  'Orchestrates all agents',
  'Aggregates results',
  'Evaluates policies',
  'Evaluates SoD',
  'Builds recommendation',
  'Validates JSON output',
];

function toRequest(input: FlowInput): FlowTerminalVM {
  const started = input.running || input.answered || input.trace.rows.length > 0;

  return {
    label: 'User Request',
    detail: input.employeeId
      ? `Recommend entitlements for employee ${input.employeeId}`
      : 'Pick a joiner to recommend entitlements for',
    orderLabel: '1',
    lane: 'io',
    state: started ? 'done' : 'idle',
    tone: started ? STATE_TONE.done : STATE_TONE.idle,
  };
}

/**
 * The supervisor card.
 *
 * A run that died takes its error row with it — the row is the supervisor's,
 * and the supervisor is not a branch — so the failure is read off the rows and
 * stated here, which is the one place on the graph that can still say it.
 */
function toRoot(
  branches: readonly FlowAgentVM[],
  rows: readonly TraceRowVM[],
  input: FlowInput,
): FlowRootVM {
  const stepCount = branches.reduce((total, branch) => total + branch.steps.length, 0);
  const error = rows.find((row) => row.kind === 'error') ?? null;
  const failed = error !== null || branches.some((branch) => branch.state === 'failed');
  const workers = new Set(branches.map((branch) => branch.agentLabel)).size;

  const state: TraceStepState = input.running
    ? 'active'
    : failed
      ? 'failed'
      : branches.length > 0
        ? 'done'
        : 'idle';

  return {
    label: 'Supervisor Agent',
    caption: 'LangGraph root',
    statusLabel: input.running
      ? 'Delegating'
      : failed
        ? 'Run failed'
        : branches.length > 0
          ? 'Run complete'
          : 'Idle',
    state,
    lane: 'supervisor',
    tone: STATE_TONE[state],
    detail: error
      ? truncate(error.detail, NOTE_LIMIT)
      : branches.length === 0
        ? 'No worker has been woken yet'
        : `${plural(branches.length, 'delegation')} · ${plural(workers, 'worker')} · ${plural(stepCount, 'step')}`,
    duties: SUPERVISOR_DUTIES,
  };
}

/**
 * Where the answer is put together.
 *
 * The supervisor does this itself, in the turn after its last worker reports —
 * so it is drawn as working from the moment every branch has handed back, and
 * done once an answer exists.
 */
function toBuilder(
  branches: readonly FlowAgentVM[],
  input: FlowInput,
  failed: boolean,
): FlowTerminalVM {
  const gathering = branches.length > 0 && branches.some((branch) => branch.state === 'active');

  const state: TraceStepState = input.answered
    ? 'done'
    : failed
      ? 'failed'
      : input.running && branches.length > 0 && !gathering
        ? 'active'
        : 'idle';

  return {
    label: 'Recommendation / JSON builder',
    detail: 'Aggregate every worker’s findings, apply policy and SoD, construct the recommendation',
    orderLabel: String(FIRST_AGENT_NUMBER + branches.length),
    lane: 'builder',
    state,
    tone: STATE_TONE[state],
  };
}

function toResponse(input: FlowInput, failed: boolean): FlowTerminalVM {
  const state: TraceStepState = input.answered ? 'done' : failed ? 'failed' : 'idle';

  return {
    label: 'Final response',
    detail: failed
      ? 'The run stopped before an answer was returned'
      : input.answered
        ? 'Recommendation returned to the requester as JSON'
        : 'Recommendation (JSON) returns to the requester',
    orderLabel: '',
    lane: 'io',
    state,
    tone: STATE_TONE[state],
  };
}

/** `"1.84s"` -> `1.84`; an open step carries no label and contributes nothing. */
function parseSeconds(label: string): number {
  const seconds = Number.parseFloat(label);
  return Number.isFinite(seconds) ? seconds : 0;
}

function plural(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}

function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th';
  return `${value}${suffix}`;
}
