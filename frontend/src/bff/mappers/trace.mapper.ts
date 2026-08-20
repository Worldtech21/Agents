/**
 * `StreamEnvelope[]` -> the agent-trace panel.
 *
 * The design's trace is a hand-written script; this is the same panel driven by
 * what LangGraph actually emitted. Each `graph.updates` envelope carries the
 * partial state one node produced, and — because the backend streams with
 * `subgraphs=True` — the namespace naming the worker that produced it. Those
 * two facts are enough to reconstruct the delegation as it happens.
 */

import type { TracePanelVM, TraceRowVM, TraceStepState, Tone } from '@bff/viewmodels';
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

interface TraceStep {
  readonly key: string;
  readonly agentKey: string;
  readonly label: string;
  readonly detail: string;
  readonly ts: number;
  readonly failed: boolean;
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
        steps.push({
          key: `err-${envelope.seq}`,
          agentKey: 'supervisor',
          label: 'Run failed',
          detail: streamError?.message ?? 'The graph stopped before finishing.',
          ts: envelope.ts,
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

  const rows = steps.map((step, index) =>
    toRow({
      step,
      previousTs: index === 0 ? startTs : (steps[index - 1]?.ts ?? startTs),
      state: resolveState(step, index, steps.length, input),
      agentLabel: labels.get(step.agentKey) ?? humanise(step.agentKey),
    }),
  );

  const lastStep = steps[steps.length - 1];
  const activeAgentKey = input.running ? (lastActiveAgent ?? lastStep?.agentKey ?? null) : null;

  return {
    rows,
    statusLabel: input.running ? 'Streaming' : streamError ? 'Failed' : input.settled ? 'Complete' : 'Idle',
    statusTone: input.running ? 'blue' : streamError ? 'red' : input.settled ? 'green' : 'neutral',
    metaLabel: buildMetaLabel(input, steps.length, startTs, endTs, streamError),
    activeAgentKey,
  };
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

  for (const [nodeName, rawUpdate] of Object.entries(payload as Record<string, unknown>)) {
    const update = asNodeUpdate(rawUpdate);
    if (update === null) continue;

    const messages = allMessages(update);
    if (messages.length === 0) continue;

    // A `tools` node returns one message per tool call; each is its own step.
    messages.forEach((message, index) => {
      const described = describeMessage(message, namespaceAgent);
      if (!described) return;
      steps.push({
        key: `${envelope.seq}-${nodeName}-${index}`,
        agentKey: namespaceAgent,
        label: described.label,
        detail: described.detail,
        ts: envelope.ts,
        failed: false,
      });
    });
  }

  return steps;
}

/** `null` for a message that carries nothing worth a row. */
function describeMessage(
  message: SerializedMessage,
  agentKey: string,
): { label: string; detail: string } | null {
  const toolCalls = message.tool_calls ?? [];

  if (toolCalls.length > 0) {
    const names = toolCalls.map((call) => call.name ?? 'tool');

    const handoff = names.find((name) => name.startsWith('transfer_to_'));
    if (handoff) {
      const target = humanise(stripAgentSuffix(handoff.replace(/^transfer_to_/, '')));
      return { label: `Delegate to ${target}`, detail: 'Handoff brief sent to the worker.' };
    }

    // The return leg is bookkeeping, not a step the operator needs to read.
    if (names.every((name) => name.startsWith('transfer_back_to_'))) return null;

    return {
      label:
        names.length === 1 ? `Call ${humanise(names[0] ?? 'tool')}` : `Call ${names.length} tools`,
      detail: summariseArgs(toolCalls),
    };
  }

  if (message.type === 'tool') {
    const toolName = typeof message.name === 'string' ? message.name : 'tool';
    if (toolName.startsWith('transfer_to_') || toolName.startsWith('transfer_back_to_')) {
      return null;
    }
    return {
      label: `${humanise(toolName)} returned`,
      detail: truncate(flattenContent(message.content)),
    };
  }

  const text = flattenContent(message.content);
  if (!text) return null;

  return { label: `${humanise(stripAgentSuffix(agentKey))} reported`, detail: truncate(text) };
}

function stripAgentSuffix(value: string): string {
  return value.replace(/_agent$/i, '');
}

/** Read the agent name out of an `agent.turn_start` custom event. */
function agentFromCustomEvent(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (record.type !== 'agent.turn_start') return null;
  return typeof record.agent === 'string' ? record.agent : null;
}

function summariseArgs(calls: readonly { args?: Record<string, unknown> }[]): string {
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

/* ----------------------------------------------------------------- rows --- */

function toRow(args: {
  step: TraceStep;
  previousTs: number | null;
  state: TraceStepState;
  agentLabel: string;
}): TraceRowVM {
  const { step, previousTs, state, agentLabel } = args;
  const elapsed = previousTs === null ? null : Math.max(step.ts - previousTs, 0);

  const tone: Tone =
    state === 'failed' ? 'red' : state === 'active' ? 'blue' : state === 'done' ? 'green' : 'neutral';

  return {
    key: step.key,
    label: step.label,
    agentLabel,
    detail: step.detail,
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
  const labels = new Map<string, string>([['supervisor', 'Supervisor']]);
  for (const agent of agents) {
    const label = agent.title.replace(/\s*agent$/i, '').trim() || humanise(agent.name);
    labels.set(agent.name, label);
    // Nodes inside a worker's subgraph are named `agent` / `tools`; the
    // namespace key is what identifies the worker, and it is the full name.
    labels.set(normaliseAgentKey(agent.name), label);
  }
  return labels;
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

/** `lookup_new_joiner` -> `Lookup new joiner`. */
export function humanise(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  if (!spaced) return value;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
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

function truncate(value: string, limit = DETAIL_LIMIT): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit - 1)}…`;
}
