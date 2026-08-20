/**
 * Console transformations.
 *
 * The supervisor answers every request with JSON — including a question typed
 * into the console (app/agents/prompts.py: "This holds for every reply"). A
 * chat bubble showing a raw JSON blob would be a worse answer than the
 * supervisor gave, so the payload is rendered back into a sentence here, and
 * the citation chips are built from the tools the run actually called.
 */

import type { RecommendationOutcome } from '@bff/outcome';
import type { ChatMessageVM } from '@bff/viewmodels';
import type { AgentInfoDTO, SerializedMessage, StreamEnvelopeDTO } from '@infrastructure/types/api';

/** A turn as the console stores it, before display formatting. */
export interface ConversationTurn {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly citations: readonly string[];
  readonly isStreaming?: boolean;
}

export function toChatMessages(turns: readonly ConversationTurn[]): ChatMessageVM[] {
  return turns.map((turn) => ({
    id: turn.id,
    role: turn.role,
    who: turn.role === 'user' ? 'You' : 'Supervisor',
    text: turn.text,
    citations: turn.citations,
    isStreaming: turn.isStreaming === true,
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

/**
 * Extract the assistant's streaming text from a `graph.messages` envelope.
 *
 * Returns `null` for anything that is not an assistant token delta, including
 * tool messages and the worker chatter that belongs in the trace panel instead.
 */
export function toStreamedToken(envelope: StreamEnvelopeDTO): string | null {
  if (envelope.channel !== 'graph' || envelope.event !== 'messages') return null;

  const payload = envelope.payload;
  if (typeof payload !== 'object' || payload === null) return null;

  const chunk = (payload as { chunk?: unknown }).chunk;
  if (typeof chunk !== 'object' || chunk === null) return null;

  const message = chunk as SerializedMessage;
  if (message.type === 'tool' || message.type === 'human') return null;

  const content = message.content;
  if (typeof content === 'string') return content || null;
  if (!Array.isArray(content)) return null;

  const text = content
    .map((block) => {
      if (typeof block === 'string') return block;
      if (typeof block === 'object' && block !== null) {
        const record = block as Record<string, unknown>;
        if (record.type === 'text' && typeof record.text === 'string') return record.text;
      }
      return '';
    })
    .join('');

  return text || null;
}
