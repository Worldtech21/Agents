/**
 * Recovering the supervisor's final answer from a state stream.
 *
 * `POST /chat` returns `answer` directly, but a streamed run has to reconstruct
 * it, and the state stream makes that less obvious than it sounds:
 *
 * * Root-level updates on the `supervisor` node carry the *cumulative* message
 *   list, worker replies included. The entitlements agent's prose sits in there
 *   as an assistant message with no pending tool call — indistinguishable, by
 *   shape alone, from the supervisor's own answer.
 * * The supervisor's subgraph updates (`namespace: ["supervisor:<uuid>"]`,
 *   node `agent`) carry exactly one message: what the supervisor just said.
 *
 * So the delta is the source of truth, and messages are matched on
 * `name === "supervisor"` rather than on assistant-ness.
 */

import { flattenContent } from '@bff/mappers/trace.mapper';
import type {
  SerializedMessage,
  StreamEnvelopeDTO,
  ThreadStateDTO,
} from '@infrastructure/types/api';

const SUPERVISOR = 'supervisor';

/** The final supervisor text seen on the stream, or `''` if none arrived. */
export function extractFinalAnswer(envelopes: readonly StreamEnvelopeDTO[]): string {
  let fromSubgraph = '';
  let fromRoot = '';

  for (const envelope of envelopes) {
    if (envelope.channel !== 'graph' || envelope.event !== 'updates') continue;

    const payload = envelope.payload;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) continue;

    const isSupervisorSubgraph = (envelope.namespace[0] ?? '').split(':')[0] === SUPERVISOR;
    const isRoot = envelope.namespace.length === 0;
    if (!isSupervisorSubgraph && !isRoot) continue;

    for (const [nodeName, update] of Object.entries(payload as Record<string, unknown>)) {
      // Only the supervisor's own node speaks for the run. A root update keyed
      // by a worker name is that worker reporting back.
      if (isRoot && nodeName !== SUPERVISOR) continue;

      for (const message of messagesFrom(update)) {
        if (!isSupervisorAnswer(message)) continue;
        const text = flattenContent(message.content);
        if (!text) continue;
        if (isSupervisorSubgraph) fromSubgraph = text;
        else fromRoot = text;
      }
    }
  }

  return fromSubgraph || fromRoot;
}

/** Fallback path: read the answer out of `GET /chat/threads/{id}`. */
export function extractAnswerFromThreadState(state: ThreadStateDTO): string {
  const messages = messagesFrom(state.values);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || !isSupervisorAnswer(message)) continue;
    const text = flattenContent(message.content);
    if (text) return text;
  }
  return '';
}

/**
 * A finished statement by the supervisor itself.
 *
 * `name` is what separates it from a worker's report: langgraph-supervisor
 * stamps every message with the agent that produced it.
 */
function isSupervisorAnswer(message: SerializedMessage): boolean {
  const type = message.type ?? message.role;
  if (type !== 'ai' && type !== 'assistant' && type !== 'AIMessageChunk') return false;

  // A message still requesting a tool — including a handoff — is mid-run.
  if ((message.tool_calls ?? []).length > 0) return false;

  const name = message.name;
  return name === undefined || name === null || name === SUPERVISOR;
}

function messagesFrom(value: unknown): readonly SerializedMessage[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const messages = (value as { messages?: unknown }).messages;
  return Array.isArray(messages) ? (messages as SerializedMessage[]) : [];
}
