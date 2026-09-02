/**
 * `StreamEnvelope[]` -> the agent-trace panel.
 *
 * The design's trace is a hand-written script; this is the same panel driven by
 * what LangGraph actually emitted. Each `graph.updates` envelope carries the
 * partial state one node produced, and — because the backend streams with
 * `subgraphs=True` — the namespace naming the worker that produced it. Those
 * two facts are enough to reconstruct the delegation as it happens.
 */

import type {
  TracePanelVM,
  TraceRowVM,
  TraceStepKind,
  TraceStepState,
  Tone,
} from '@bff/viewmodels';
import type {
  AgentInfoDTO,
  ControlErrorPayload,
  GraphNodeUpdate,
  SerializedMessage,
  StreamEnvelopeDTO,
} from '@infrastructure/types/api';

/** Longest detail line the panel shows before eliding. */
const DETAIL_LIMIT = 160;

export interface TraceInput {
  readonly envelopes: readonly StreamEnvelopeDTO[];
  readonly agents: readonly AgentInfoDTO[];
  readonly running: boolean;
  /** Set once a run has produced a final answer. */
  readonly settled: boolean;
}

/** The supervisor's own namespace key. It presides over a run rather than appearing in it. */
export const SUPERVISOR_KEY = 'supervisor';

/**
 * A step, while it is still being assembled.
 *
 * A tool use arrives as two envelopes — the call, then the result, several
 * seconds apart — and is one step. `callId` and `resultFor` are how the two
 * halves find each other; everything after `foldToolResults` has both.
 */
interface TraceStep {
  key: string;
  kind: TraceStepKind;
  agentKey: string;
  instanceKey: string;
  label: string;
  detail: string;
  resultPreview: string;
  inputPayload: string;
  outputPayload: string;
  /** `call_35710` on a tool call, waiting for the result that quotes it. */
  callId: string;
  /** `call_35710` on a tool result, naming the call it answers. */
  resultFor: string;
  /** On a delegation, the worker being handed to — named as the roster names it. */
  targetKey: string;
  ts: number;
  /** When the result came back, so a tool use can time itself. */
  endTs: number | null;
  failed: boolean;
}

export function toTracePanel(input: TraceInput): TracePanelVM {
  const labels = buildAgentLabels(input.agents);
  const steps: TraceStep[] = [];

  let startTs: number | null = null;
  let endTs: number | null = null;
  let streamError: ControlErrorPayload | null = null;
  let lastActiveAgent: string | null = null;

  for (const envelope of input.envelopes) {
    if (envelope.channel === 'control') {
      if (envelope.event === 'stream.start') startTs = envelope.ts;
      else if (envelope.event === 'stream.end') endTs = envelope.ts;
      else if (envelope.event === 'stream.error') {
        streamError = asControlError(envelope.payload);
        endTs = envelope.ts;
        const message = streamError?.message ?? 'The graph stopped before finishing.';
        steps.push({
          key: `err-${envelope.seq}`,
          kind: 'error',
          agentKey: SUPERVISOR_KEY,
          instanceKey: `${SUPERVISOR_KEY}:error-${envelope.seq}`,
          label: 'Run failed',
          detail: message,
          resultPreview: '',
          inputPayload: '',
          outputPayload: message,
          callId: '',
          resultFor: '',
          targetKey: '',
          ts: envelope.ts,
          endTs: null,
          failed: true,
        });
      }
      continue;
    }

    if (envelope.channel !== 'graph') continue;

    // `agent.turn_start` (app/agents/hooks.py) is the cleanest statement of who
    // is working. It attributes the mesh highlight; it is not a step of its own.
    if (envelope.event === 'custom') {
      const agent = agentFromCustomEvent(envelope.payload);
      if (agent) lastActiveAgent = agent;
      continue;
    }

    if (envelope.event !== 'updates') continue;
    steps.push(...stepsFromUpdate(envelope));
  }

  const folded = foldToolResults(steps);

  // A delegation is named by the roster, not by the tool that carried it:
  // `transfer_to_sod_test_agent` reads as "Sod test" and the column it lands on
  // reads "SOD Test", and one run must not call one worker two things.
  for (const step of folded) {
    if (step.kind === 'delegation' && step.targetKey) {
      step.label = `Delegate to ${labelFor(labels, step.targetKey)}`;
    }
  }

  const rows = folded.map((step, index) =>
    toRow({
      step,
      previousTs: index === 0 ? startTs : (folded[index - 1]?.ts ?? startTs),
      state: resolveState(step, index, folded.length, input),
      agentLabel: labelFor(labels, step.agentKey),
    }),
  );

  const lastStep = folded[folded.length - 1];
  const activeAgentKey = input.running ? (lastActiveAgent ?? lastStep?.agentKey ?? null) : null;

  return {
    rows,
    // statusLabel: input.running ? 'Streaming' : streamError ? 'Failed' : input.settled ? 'Complete' : 'Idle',
    // statusTone: input.running ? 'blue' : streamError ? 'red' : input.settled ? 'green' : 'neutral',
    // metaLabel: buildMetaLabel(input, folded.length, startTs, endTs, streamError),
    activeAgentKey,
  };
}

/**
 * Put each tool result back with the call it answers.
 *
 * The graph draws one step per tool *use*, not one per envelope: `list_policies`
 * called and `list_policies` returning is one thing the agent did, and drawing
 * it as two doubles the length of every column for no information. The pairing
 * is the tool call id both messages carry, so it holds even when an agent has
 * several calls in flight.
 *
 * A result whose call was never seen keeps a step of its own rather than being
 * dropped — a step with no call to attach to is still something that happened.
 */
function foldToolResults(steps: readonly TraceStep[]): TraceStep[] {
  const callsById = new Map<string, TraceStep>();
  const folded: TraceStep[] = [];

  for (const step of steps) {
    const call = step.resultFor ? callsById.get(step.resultFor) : undefined;

    if (call) {
      call.resultPreview = step.resultPreview;
      call.outputPayload = step.outputPayload;
      call.endTs = step.ts;
      call.failed = step.failed;
      continue;
    }

    folded.push(step);
    if (step.callId) callsById.set(step.callId, step);
  }

  return folded;
}

/* ---------------------------------------------------------------- steps --- */

/**
 * Turn one `graph.updates` envelope into the steps it represents.
 *
 * Two shapes arrive and only one of them is a step:
 *
 * * Namespaced (`["new_joiners_agent:<uuid>"]`) — a delta from inside that
 *   worker's subgraph. This is the step.
 * * Root (`[]`) — the supervisor graph's node output, which carries the whole
 *   cumulative message list. Rendering it would repeat every earlier step on
 *   every turn, so it is skipped.
 *
 * `pre_model_hook` updates are always `null` (the hook exists to emit a custom
 * event and returns no state), and would otherwise render as blank rows.
 */
function stepsFromUpdate(envelope: StreamEnvelopeDTO): TraceStep[] {
  const payload = envelope.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return [];

  const namespaceAgent = agentFromNamespace(envelope.namespace);
  if (namespaceAgent === null) return [];

  const steps: TraceStep[] = [];

  const instanceKey = envelope.namespace[0] ?? namespaceAgent;

  for (const [nodeName, rawUpdate] of Object.entries(payload as Record<string, unknown>)) {
    const update = asNodeUpdate(rawUpdate);
    if (update === null) continue;

    const messages = allMessages(update);
    if (messages.length === 0) continue;

    messages.forEach((message, index) => {
      for (const described of describeMessage(message, namespaceAgent)) {
        steps.push({
          ...described,
          key: `${envelope.seq}-${nodeName}-${index}-${described.key}`,
          agentKey: namespaceAgent,
          instanceKey,
          ts: envelope.ts,
          endTs: null,
        });
      }
    });
  }

  return steps;
}

type DescribedStep = Omit<TraceStep, 'agentKey' | 'instanceKey' | 'ts' | 'endTs'>;

/**
 * What one message is worth, as steps — nothing at all for most of them.
 *
 * An agent's message with three tool calls is three steps, one per call, so
 * each can later be paired with its own result. `detail` is the line a row has
 * room for; `inputPayload` and `outputPayload` are the whole of what was sent
 * and what came back, pretty-printed when they are JSON, which is what the
 * graph reveals on demand.
 */
function describeMessage(message: SerializedMessage, agentKey: string): DescribedStep[] {
  const toolCalls = message.tool_calls ?? [];

  if (toolCalls.length > 0) {
    return toolCalls.flatMap((call, index): DescribedStep[] => {
      const name = call.name ?? 'tool';

      // The return leg is bookkeeping: the worker is finished, which the run
      // says anyway by going back to the supervisor.
      if (name.startsWith('transfer_back_to_')) return [];

      const base = {
        key: `call-${index}`,
        detail: summariseArgs([call]),
        resultPreview: '',
        inputPayload: formatCalls([call]),
        outputPayload: '',
        callId: call.id ?? '',
        resultFor: '',
        targetKey: '',
        failed: false,
      };

      if (name.startsWith('transfer_to_')) {
        const target = name.replace(/^transfer_to_/, '');
        return [
          {
            ...base,
            kind: 'delegation' as const,
            // Relabelled against the roster once the labels are known, so the
            // connection and the column it lands on say the same name.
            label: `Delegate to ${humanise(stripAgentSuffix(target))}`,
            targetKey: target,
            // The brief is the whole of a handoff; there is no result to wait for.
            callId: '',
          },
        ];
      }

      return [{ ...base, kind: 'tool' as const, label: humanise(name) }];
    });
  }

  if (message.type === 'tool') {
    const toolName = typeof message.name === 'string' ? message.name : 'tool';
    if (toolName.startsWith('transfer_to_') || toolName.startsWith('transfer_back_to_')) return [];

    const returned = flattenContent(message.content);
    return [
      {
        key: 'result',
        kind: 'tool',
        label: humanise(toolName),
        detail: '',
        resultPreview: truncate(returned),
        inputPayload: '',
        outputPayload: formatPayload(returned),
        callId: '',
        resultFor: typeof message.tool_call_id === 'string' ? message.tool_call_id : '',
        targetKey: '',
        failed: message.status === 'error',
      },
    ];
  }

  const text = flattenContent(message.content);
  if (!text) return [];

  return [
    {
      key: 'report',
      kind: 'report',
      label: `${humanise(stripAgentSuffix(agentKey))} reported`,
      detail: truncate(text),
      resultPreview: '',
      inputPayload: '',
      outputPayload: text,
      callId: '',
      resultFor: '',
      targetKey: '',
      failed: false,
    },
  ];
}

export function stripAgentSuffix(value: string): string {
  return value.replace(/_agent$/i, '');
}

/** Read the agent name out of an `agent.turn_start` custom event. */
function agentFromCustomEvent(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (record.type !== 'agent.turn_start') return null;
  return typeof record.agent === 'string' ? record.agent : null;
}

export function summariseArgs(calls: readonly { args?: Record<string, unknown> }[]): string {
  const pairs: string[] = [];
  for (const call of calls) {
    for (const [key, value] of Object.entries(call.args ?? {})) {
      if (value === null || value === undefined || value === '') continue;
      pairs.push(`${key}: ${truncate(stringifyValue(value), 48)}`);
      if (pairs.length >= 4) break;
    }
    if (pairs.length >= 4) break;
  }
  return pairs.join(' · ');
}

/** Every call in the message, with its arguments as they were sent. */
export function formatCalls(calls: readonly { name?: string; args?: Record<string, unknown> }[]): string {
  return calls
    .map((call) => {
      const name = call.name ?? 'tool';
      const args = call.args ?? {};
      return Object.keys(args).length === 0 ? `${name}()` : `${name}\n${indent(args)}`;
    })
    .join('\n\n');
}

/**
 * A tool's return, laid out.
 *
 * Tools answer in JSON, and a run's worth of it on one line is unreadable —
 * but a tool that answers in prose must not be mangled into quotes, so the
 * text is only reformatted when it actually parses.
 */
export function formatPayload(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return trimmed;
  try {
    return indent(JSON.parse(trimmed));
  } catch {
    return trimmed;
  }
}

function indent(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/* ----------------------------------------------------------------- rows --- */

function toRow(args: {
  step: TraceStep;
  previousTs: number | null;
  state: TraceStepState;
  agentLabel: string;
}): TraceRowVM {
  const { step, previousTs, state, agentLabel } = args;

  // A tool use times itself, from the call to the result. Everything else can
  // only be timed against the step before it.
  const elapsed =
    step.endTs !== null
      ? Math.max(step.endTs - step.ts, 0)
      : previousTs === null
        ? null
        : Math.max(step.ts - previousTs, 0);

  const tone: Tone =
    state === 'failed' ? 'red' : state === 'active' ? 'blue' : state === 'done' ? 'green' : 'neutral';

  return {
    key: step.key,
    label: step.label,
    kind: step.kind,
    agentKey: step.agentKey,
    instanceKey: step.instanceKey,
    agentLabel,
    detail: step.detail,
    resultPreview: step.resultPreview,
    inputPayload: step.inputPayload,
    outputPayload: step.outputPayload,
    durationLabel: elapsed === null ? '' : `${elapsed.toFixed(2)}s`,
    state,
    tone,
  };
}

function resolveState(
  step: TraceStep,
  index: number,
  total: number,
  input: TraceInput,
): TraceStepState {
  if (step.failed) return 'failed';
  // A call still waiting on its result is working, wherever it sits in the run.
  if (step.callId && step.endTs === null) return input.running ? 'active' : 'done';
  if (index < total - 1) return 'done';
  return input.running ? 'active' : 'done';
}

function buildMetaLabel(
  input: TraceInput,
  stepCount: number,
  startTs: number | null,
  endTs: number | null,
  streamError: ControlErrorPayload | null,
): string {
  if (streamError) return `control.stream.error · ${streamError.code}`;
  if (input.running) return `control.stream.open · ${stepCount} steps`;
  if (input.settled && startTs !== null && endTs !== null) {
    return `control.stream.end · ${stepCount} steps · ${(endTs - startTs).toFixed(2)}s`;
  }
  if (input.settled) return `control.stream.end · ${stepCount} steps`;
  return 'Awaiting run';
}

/* ----------------------------------------------------------- vocabulary --- */

function buildAgentLabels(agents: readonly AgentInfoDTO[]): Map<string, string> {
  const labels = new Map<string, string>([[SUPERVISOR_KEY, 'Supervisor']]);
  for (const agent of agents) {
    const label = agent.title.replace(/\s*agent$/i, '').trim() || humanise(agent.name);
    labels.set(agent.name, label);
    // Nodes inside a worker's subgraph are named `agent` / `tools`; the
    // namespace key is what identifies the worker, and it is the full name.
    labels.set(normaliseAgentKey(agent.name), label);
  }
  return labels;
}

/**
 * The name to put on a worker.
 *
 * Namespaces spell an agent `User_Profiling_Agent` and its handoff tool spells
 * it `user_profiling_agent`, so the roster is matched without regard to case.
 * With no roster to consult — the health call has not landed yet, or the run
 * woke an agent the roster does not list — the key itself reads well enough
 * once the `_agent` suffix is off.
 */
function labelFor(labels: ReadonlyMap<string, string>, agentKey: string): string {
  const direct = labels.get(agentKey);
  if (direct) return direct;

  const lowered = agentKey.toLowerCase();
  for (const [key, label] of labels) {
    if (key.toLowerCase() === lowered) return label;
  }

  return humanise(stripAgentSuffix(agentKey));
}

/** `["new_joiners_agent:9f2c41", "tools:2"]` -> `new_joiners_agent`. */
function agentFromNamespace(namespace: readonly string[]): string | null {
  const first = namespace[0];
  if (!first) return null;
  const key = first.split(':')[0];
  return key ? normaliseAgentKey(key) : null;
}

function normaliseAgentKey(value: string): string {
  return value.trim();
}

/**
 * The agents whose registered names read as jargon in the trace.
 *
 * The rename is presentational only — the graph's own vocabulary is what the
 * envelopes carry, and matching on it anywhere else would be matching on a
 * label rather than on a fact.
 *
 * There is no `sod test` -> `Policy Evaluation` rule, though the roster once
 * needed one: the mesh now runs a `Policy_Evaluation_Agent` of its own, and
 * renaming the SOD agent onto it would put two different workers on the graph
 * under one name.
 */
const DISPLAY_RENAMES: readonly (readonly [RegExp, string])[] = [
  [/identities/gi, 'User Profiling'],
];

/** A step or agent label, in the words the operator uses. */
export function toDisplayLabel(value: string): string {
  return DISPLAY_RENAMES.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

/** Names the mesh uses that are initialisms, not words. */
const ACRONYMS = new Set(['sod', 'sap', 'hr', 'mcp', 'api', 'id', 'sla']);

/** `lookup_new_joiner` -> `Lookup new joiner`; `list_sod_rules` -> `List SOD rules`. */
export function humanise(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  if (!spaced) return value;

  const words = spaced
    .split(' ')
    .map((word) => (ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word));

  const [first = '', ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

/* ------------------------------------------------------------- coercion --- */

function asNodeUpdate(value: unknown): GraphNodeUpdate | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as GraphNodeUpdate;
}

function allMessages(update: GraphNodeUpdate): readonly SerializedMessage[] {
  const messages = update.messages;
  return Array.isArray(messages) ? messages : [];
}

function asControlError(payload: unknown): ControlErrorPayload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  return {
    code: typeof record.code === 'string' ? record.code : 'graph_execution_error',
    message: typeof record.message === 'string' ? record.message : 'The graph stopped unexpectedly.',
  };
}

/**
 * Collapse LangChain message content into plain text.
 *
 * With thinking enabled, `content` is a list of blocks; only `text` blocks are
 * part of what a step said.
 */
export function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (typeof block === 'string') return block;
      if (typeof block === 'object' && block !== null) {
        const record = block as Record<string, unknown>;
        if (record.type === 'text' && typeof record.text === 'string') return record.text;
      }
      return '';
    })
    .join('')
    .trim();
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function truncate(value: string, limit = DETAIL_LIMIT): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit - 1)}…`;
}
