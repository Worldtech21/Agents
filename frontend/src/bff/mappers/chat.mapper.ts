/**
 * Console transformations.
 *
 * The supervisor answers every request with JSON — including a question typed
 * into the console (app/agents/prompts.py: "This holds for every reply"). A
 * chat bubble showing a raw JSON blob would be a worse answer than the
 * supervisor gave, so the payload is rendered back into a sentence here, and
 * the citation chips are built from the tools the run actually called.
 */

import {
  flattenContent,
  humanise,
  stripAgentSuffix,
  summariseArgs,
  truncate,
} from '@bff/mappers/trace.mapper';
import type { RecommendationOutcome } from '@bff/outcome';
import type { ChatMessageVM, ThoughtEventVM, ThoughtSegmentVM } from '@bff/viewmodels';
import type { AgentInfoDTO, SerializedMessage, StreamEnvelopeDTO } from '@infrastructure/types/api';

/** A turn as the console stores it, before display formatting. */
export interface ConversationTurn {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly citations: readonly string[];
  readonly isStreaming?: boolean;
  /** The reasoning that produced this turn, kept once the run has settled. */
  readonly thoughts?: readonly ThoughtSegmentVM[];
}

export function toChatMessages(turns: readonly ConversationTurn[]): ChatMessageVM[] {
  return turns.map((turn) => ({
    id: turn.id,
    role: turn.role,
    who: turn.role === 'user' ? 'You' : 'Supervisor',
    text: turn.text,
    citations: turn.citations,
    isStreaming: turn.isStreaming === true,
    thoughts: turn.thoughts ?? [],
  }));
}

/**
 * Render a run's outcome as the prose a console answer should show.
 *
 * A refusal is quoted as-is — it is already a sentence. A recommendation is
 * summarised from its own counts, with no number invented that the supervisor
 * did not report.
 */
export function toAssistantText(outcome: RecommendationOutcome): string {
  switch (outcome.kind) {
    case 'refusal':
      return outcome.view.message;

    case 'unparseable':
      // The supervisor spoke prose instead of JSON; prose is what to show.
      return outcome.raw || outcome.reason;

    case 'recommendation': {
      const view = outcome.view;
      const recommended = view.recommended.length;
      const optional = view.optional.length;

      const lead =
        recommended === 0
          ? `No entitlement met the policy threshold for ${view.employee.name} (${view.employeeId}).`
          : `${recommended} ${recommended === 1 ? 'entitlement' : 'entitlements'} recommended for ${
              view.employee.name
            } (${view.employeeId}): ${view.recommended.map((item) => item.name).join(', ')}.`;

      const optionalLine =
        optional === 0
          ? ''
          : ` ${optional} further ${
              optional === 1 ? 'entitlement sits' : 'entitlements sit'
            } below the threshold and would need a justified request.`;

      const sodLine = ` Separation of duties: ${view.sod.resultLabel.toLowerCase()} — ${view.sod.summary}`;

      const incompleteLine = view.incompleteNote
        ? ` The supervisor flagged this run as incomplete: ${view.incompleteNote}`
        : '';

      return `${lead}${optionalLine}${sodLine}${incompleteLine}`;
    }
  }
}

/**
 * Build the citation chips from the tool calls observed on the stream.
 *
 * Each chip reads `Peer Affinity · peer_holdings` — the worker, and the tool it
 * called. Only tools that actually ran are listed, so a chip is evidence rather
 * than decoration.
 */
export function toCitations(
  envelopes: readonly StreamEnvelopeDTO[],
  agents: readonly AgentInfoDTO[],
): string[] {
  const labels = new Map<string, string>();
  for (const agent of agents) {
    labels.set(agent.name, agent.title.replace(/\s*agent$/i, '').trim() || agent.name);
  }

  const citations = new Set<string>();

  for (const envelope of envelopes) {
    if (envelope.channel !== 'graph' || envelope.event !== 'updates') continue;
    const payload = envelope.payload;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) continue;

    const namespaceKey = envelope.namespace[0]?.split(':')[0] ?? null;

    for (const rawUpdate of Object.values(payload as Record<string, unknown>)) {
      const messages = extractMessages(rawUpdate);
      for (const message of messages) {
        for (const call of message.tool_calls ?? []) {
          const toolName = call.name;
          // Handoffs in either direction are routing, not evidence.
          if (
            !toolName ||
            toolName.startsWith('transfer_to_') ||
            toolName.startsWith('transfer_back_to_')
          ) {
            continue;
          }
          const agentLabel = namespaceKey ? (labels.get(namespaceKey) ?? namespaceKey) : 'Supervisor';
          citations.add(`${agentLabel} · ${toolName}`);
        }
      }
    }
  }

  return [...citations];
}

/**
 * Suggested questions, built from what this operator has actually looked at.
 *
 * The design's chips were three fixed strings. Here they name a joiner already
 * on the queue and an entitlement the supervisor really recommended, so a chip
 * always leads to a question the mesh can answer. With no runs yet, they fall
 * back to the roster's own descriptions.
 */
export function buildSuggestions(context: {
  readonly latest: RecommendationOutcome | null;
  readonly agents: readonly AgentInfoDTO[];
}): string[] {
  const suggestions: string[] = [];

  if (context.latest?.kind === 'recommendation') {
    const view = context.latest.view;
    suggestions.push(`Is ${view.employeeId} blocked by any separation-of-duties rule?`);

    const optional = view.optional[0];
    if (optional) {
      suggestions.push(`What is ${optional.entitlementId} and who owns it?`);
    }

    const recommended = view.recommended[0];
    if (recommended) {
      suggestions.push(
        `Which of ${view.employeeId}'s peers hold ${recommended.entitlementId}, and does policy allow it?`,
      );
    }
  }

  if (suggestions.length < 3) {
    const hasPolicy = context.agents.some((agent) => agent.name.includes('policy'));
    if (hasPolicy) {
      suggestions.push('What is the certification cadence for high-risk SAP roles?');
    }
    suggestions.push('Which MCP-backed agents can answer questions right now?');
  }

  return suggestions.slice(0, 3);
}

function extractMessages(value: unknown): readonly SerializedMessage[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const messages = (value as { messages?: unknown }).messages;
  return Array.isArray(messages) ? (messages as SerializedMessage[]) : [];
}

/* -------------------------------------------------------------- streaming --- */

/** What a token delta is: the answer being written, or the reasoning behind it. */
export type StreamDeltaKind = 'answer' | 'thinking';

export interface StreamDelta {
  readonly kind: StreamDeltaKind;
  readonly text: string;
  /** Namespace key of the agent that produced it — `supervisor`, `policy_agent`. */
  readonly agentKey: string;
}

/**
 * Split one `graph.messages` envelope into its token deltas.
 *
 * A chunk's content is a list of blocks, and a single chunk can carry both the
 * model's thinking and its answer, so this returns a list rather than one
 * string. `thinking` blocks are what the provider returns when thought
 * summaries are enabled (LLM_THINKING=adaptive with a `summarized` display);
 * with them off, only `answer` deltas ever appear and every caller degrades to
 * its previous behaviour.
 *
 * Tool and human messages produce nothing: they are trace material, not speech.
 */
export function toStreamedDeltas(envelope: StreamEnvelopeDTO): readonly StreamDelta[] {
  if (envelope.channel !== 'graph' || envelope.event !== 'messages') return [];

  const payload = envelope.payload;
  if (typeof payload !== 'object' || payload === null) return [];

  const chunk = (payload as { chunk?: unknown }).chunk;
  if (typeof chunk !== 'object' || chunk === null) return [];

  const message = chunk as SerializedMessage;
  if (message.type === 'tool' || message.type === 'human') return [];

  const agentKey = agentKeyFor(envelope, payload as { metadata?: unknown });
  const content = message.content;

  if (typeof content === 'string') {
    return content ? [{ kind: 'answer', text: content, agentKey }] : [];
  }
  if (!Array.isArray(content)) return [];

  const deltas: StreamDelta[] = [];
  for (const block of content) {
    if (typeof block === 'string') {
      if (block) deltas.push({ kind: 'answer', text: block, agentKey });
      continue;
    }
    if (typeof block !== 'object' || block === null) continue;

    const record = block as Record<string, unknown>;

    if (record.type === 'text') {
      if (typeof record.text === 'string' && record.text) {
        deltas.push({ kind: 'answer', text: record.text, agentKey });
      }
      continue;
    }

    // Three spellings for the same thing: Gemini's `thinking`, the langchain v1
    // `reasoning` block, and Anthropic's raw streaming delta. Matching all
    // three means swapping provider does not silently stop showing reasoning.
    if (THINKING_BLOCK_TYPES.has(record.type as string)) {
      const text = firstString(record.thinking, record.reasoning, record.text);
      if (text) deltas.push({ kind: 'thinking', text, agentKey });
    }
  }

  return deltas;
}

/** Every spelling a provider uses for a block of reasoning. */
const THINKING_BLOCK_TYPES = new Set(['thinking', 'reasoning', 'thinking_delta']);

function firstString(...candidates: readonly unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  return '';
}

/**
 * Who produced a chunk.
 *
 * The subgraph namespace is the reliable answer — `["policy_agent:9f2c41"]` —
 * and `langgraph_node` covers the root graph, where the namespace is empty.
 */
function agentKeyFor(envelope: StreamEnvelopeDTO, payload: { metadata?: unknown }): string {
  const fromNamespace = envelope.namespace[0]?.split(':')[0];
  if (fromNamespace) return fromNamespace;

  const metadata = payload.metadata;
  if (typeof metadata === 'object' && metadata !== null) {
    const node = (metadata as Record<string, unknown>).langgraph_node;
    if (typeof node === 'string' && node) return node;
  }
  return 'supervisor';
}

/**
 * Fold a thinking delta into the running list of segments.
 *
 * Consecutive deltas from the same agent are one paragraph of thought, so they
 * concatenate; a change of agent closes the open segment and opens a new one,
 * because in a supervisor graph that change *is* the handoff. Returns the same
 * array when nothing changed, so React can skip the re-render.
 */
export function appendThought(
  segments: readonly ThoughtSegmentVM[],
  delta: StreamDelta,
  now: number = Date.now(),
): readonly ThoughtSegmentVM[] {
  if (delta.kind !== 'thinking' || !delta.text) return segments;

  const opened = openThoughtTurn(segments, delta.agentKey, now);
  const segment = opened[opened.length - 1] as ThoughtSegmentVM;
  const lastEvent = segment.events[segment.events.length - 1];

  // Consecutive reasoning deltas are one train of thought, so they grow the
  // open thinking event rather than stacking one event per chunk. Anything
  // else having happened since — a tool call — starts a fresh one.
  const events =
    lastEvent && lastEvent.kind === 'thinking'
      ? [
          ...segment.events.slice(0, -1),
          { ...lastEvent, detail: lastEvent.detail + delta.text },
        ]
      : [
          ...segment.events,
          {
            key: `${segment.key}-e${segment.events.length}`,
            kind: 'thinking' as const,
            label: '',
            detail: delta.text,
            tone: 'neutral' as const,
          },
        ];

  return [...opened.slice(0, -1), { ...segment, events }];
}

/**
 * Fold one `graph.updates` envelope into the timeline as the events it records.
 *
 * This is what turns a reasoning panel into an account of the run: the tools an
 * agent called and with what, what came back, where it delegated, and what it
 * concluded. Only namespaced updates are read — a root-level update carries the
 * supervisor graph's whole cumulative message list, so folding those in would
 * repeat every earlier step on every turn.
 */
export function appendActivity(
  segments: readonly ThoughtSegmentVM[],
  envelope: StreamEnvelopeDTO,
  now: number = Date.now(),
): readonly ThoughtSegmentVM[] {
  if (envelope.channel !== 'graph' || envelope.event !== 'updates') return segments;

  const payload = envelope.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return segments;

  const agentKey = envelope.namespace[0]?.split(':')[0];
  if (!agentKey) return segments;

  let next = segments;

  for (const [nodeName, rawUpdate] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof rawUpdate !== 'object' || rawUpdate === null || Array.isArray(rawUpdate)) continue;
    const messages = (rawUpdate as { messages?: unknown }).messages;
    if (!Array.isArray(messages)) continue;

    (messages as SerializedMessage[]).forEach((message, index) => {
      const described = describeActivity(message, agentKey);
      if (!described) return;

      next = openThoughtTurn(next, agentKey, now);
      const segment = next[next.length - 1] as ThoughtSegmentVM;

      next = [
        ...next.slice(0, -1),
        {
          ...segment,
          events: [
            ...segment.events,
            {
              // Keyed by the chunk it came from, so a re-render cannot
              // duplicate it and React keeps the row identity stable.
              key: `${envelope.seq}-${nodeName}-${index}`,
              kind: described.kind,
              label: described.label,
              detail: described.detail,
              tone: described.tone,
            },
          ],
        },
      ];
    });
  }

  return next;
}

/**
 * What one message in a node update represents, or `null` for bookkeeping.
 *
 * Deliberately the same reading as the agent trace panel's `describeMessage`,
 * so the two surfaces never disagree about what a run did — it differs only in
 * keeping the event *kind*, which is what lets each row be styled for what it
 * is rather than rendered as undifferentiated text.
 */
function describeActivity(
  message: SerializedMessage,
  agentKey: string,
): Pick<ThoughtEventVM, 'kind' | 'label' | 'detail' | 'tone'> | null {
  const toolCalls = message.tool_calls ?? [];

  if (toolCalls.length > 0) {
    const names = toolCalls.map((call) => call.name ?? 'tool');

    const handoff = names.find((name) => name.startsWith('transfer_to_'));
    if (handoff) {
      const target = stripAgentSuffix(handoff.replace(/^transfer_to_/, ''));
      return {
        kind: 'handoff',
        label: `Delegated to ${toAgentLabel(target)}`,
        detail: '',
        tone: 'blue',
      };
    }

    // The return leg is bookkeeping: the handoff back is already implied by the
    // next agent's node opening.
    if (names.every((name) => name.startsWith('transfer_back_to_'))) return null;

    return {
      kind: 'tool.call',
      label: names.length === 1 ? `Called ${names[0]}` : `Called ${names.length} tools`,
      detail: summariseArgs(toolCalls),
      tone: 'amber',
    };
  }

  if (message.type === 'tool') {
    const toolName = typeof message.name === 'string' ? message.name : 'tool';
    if (toolName.startsWith('transfer_to_') || toolName.startsWith('transfer_back_to_')) {
      return null;
    }
    const failed = message.status === 'error';
    return {
      kind: 'tool.result',
      label: failed ? `${toolName} failed` : `${toolName} returned`,
      detail: truncate(flattenContent(message.content)),
      tone: failed ? 'red' : 'green',
    };
  }

  const text = flattenContent(message.content);
  if (!text) return null;

  return {
    kind: 'message',
    label: `${toAgentLabel(agentKey)} reported`,
    detail: truncate(text),
    tone: 'neutral',
  };
}

/**
 * The agent named by a `graph.custom` turn-start event, if that is what it is.
 *
 * `app/agents/hooks.py` emits one before every model call, which is the only
 * signal that names an agent *as it takes the turn* — before it has produced
 * any text. It is what lets the panel show the delegation itself rather than
 * only the turns whose reasoning the provider happened to summarise.
 */
export function toAgentTurn(envelope: StreamEnvelopeDTO): string | null {
  if (envelope.channel !== 'graph' || envelope.event !== 'custom') return null;

  const payload = envelope.payload;
  if (typeof payload !== 'object' || payload === null) return null;

  const record = payload as Record<string, unknown>;
  if (record.type !== 'agent.turn_start') return null;
  return typeof record.agent === 'string' && record.agent ? record.agent : null;
}

/**
 * Open a segment for an agent that has just taken the turn.
 *
 * A repeat of the agent already holding the turn is its ReAct loop coming back
 * around after a tool call, not a handoff, so it does not open a node — one
 * node per agent turn is what reads as delegation. The segment starts with no
 * text: reasoning is attached by `appendThought` if and when the provider
 * summarises it, and a turn that never produces any still shows as work done.
 */
export function openThoughtTurn(
  segments: readonly ThoughtSegmentVM[],
  agentKey: string,
  now: number = Date.now(),
): readonly ThoughtSegmentVM[] {
  const last = segments[segments.length - 1];
  if (last && last.agentKey === agentKey && last.state === 'active') return segments;

  return [
    ...(last ? [...segments.slice(0, -1), seal(last, now)] : segments),
    {
      key: `${agentKey}-${segments.length}`,
      agentKey,
      agentLabel: toAgentLabel(agentKey),
      events: [],
      state: 'active',
      tone: 'blue',
      durationLabel: '',
      startedAt: now,
    },
  ];
}

/** True when this turn produced reasoning, as opposed to only doing work. */
export function hasReasoning(segment: ThoughtSegmentVM): boolean {
  return segment.events.some((event) => event.kind === 'thinking');
}

/**
 * Close the open segment, once nothing further will be added to it.
 *
 * Called when a run settles or is cancelled, so the last agent stops reading as
 * though it were still thinking.
 */
export function sealThoughts(
  segments: readonly ThoughtSegmentVM[],
  now: number = Date.now(),
): readonly ThoughtSegmentVM[] {
  const last = segments[segments.length - 1];
  if (!last || last.state !== 'active') return segments;
  return [...segments.slice(0, -1), seal(last, now)];
}

function seal(segment: ThoughtSegmentVM, now: number): ThoughtSegmentVM {
  if (segment.state !== 'active') return segment;
  return {
    ...segment,
    state: 'done',
    tone: 'green',
    // Same spelling the agent trace panel uses, so two panels on one screen
    // do not report time in two different formats.
    durationLabel: `${(Math.max(now - segment.startedAt, 0) / 1000).toFixed(2)}s`,
  };
}

/**
 * A worker's namespace key as a reader should see it: `sod_test_agent` -> `SoD
 * test`.
 *
 * The roster carries proper titles, but it is not in scope where reasoning is
 * folded, and threading it through three hooks to fix capitalisation is not
 * worth it. This drops the redundant `agent` suffix — the same thing the trace
 * panel does to a roster title — and respects the one acronym in the domain.
 */
function toAgentLabel(agentKey: string): string {
  if (agentKey === 'supervisor') return 'Supervisor';
  const withoutSuffix = agentKey.replace(/_?agents?$/i, '');
  return humanise(withoutSuffix || agentKey).replace(/\bSod\b/g, 'SoD');
}
