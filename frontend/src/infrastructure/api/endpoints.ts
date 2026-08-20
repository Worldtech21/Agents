/**
 * One function per backend route, returning raw DTOs.
 *
 * This is the complete inventory of what the service exposes
 * (app/api/v1/router.py). Adding a route means adding a function here; no
 * other layer builds a URL.
 */

import { httpClient } from '@infrastructure/api/client';
import { readStreamEnvelopes } from '@infrastructure/api/sse';
import { apiUrl, env } from '@infrastructure/config/env';
import type {
  AgentInfoDTO,
  ChatRequestDTO,
  ChatResponseDTO,
  HealthDTO,
  MCPServerStatusDTO,
  StreamCapabilitiesDTO,
  StreamEnvelopeDTO,
  ThreadStateDTO,
} from '@infrastructure/types/api';

/* -------------------------------------------------------------- health --- */

/**
 * `GET /health`.
 *
 * The endpoint answers 503 with a fully-formed body when the graph failed to
 * build (`status: "degraded"`, reason in `error`). That is information, not a
 * transport failure, so 503 is accepted and surfaced to the UI.
 */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthDTO> {
  const response = await httpClient.get<HealthDTO>('/health', {
    signal,
    validateStatus: (status) => status === 200 || status === 503,
  });
  return response.data;
}

/* -------------------------------------------------------------- agents --- */

/** `GET /agents` — the worker roster with the tools MCP actually yielded. */
export async function fetchAgents(signal?: AbortSignal): Promise<AgentInfoDTO[]> {
  const response = await httpClient.get<AgentInfoDTO[]>('/agents', { signal });
  return response.data;
}

/** `GET /agents/mcp` — per-server connectivity. */
export async function fetchMcpStatus(signal?: AbortSignal): Promise<MCPServerStatusDTO[]> {
  const response = await httpClient.get<MCPServerStatusDTO[]>('/agents/mcp', { signal });
  return response.data;
}

/** `GET /agents/{name}`. */
export async function fetchAgent(name: string, signal?: AbortSignal): Promise<AgentInfoDTO> {
  const response = await httpClient.get<AgentInfoDTO>(`/agents/${encodeURIComponent(name)}`, {
    signal,
  });
  return response.data;
}

/* ---------------------------------------------------------------- chat --- */

/** `POST /chat` — run to completion and return the final answer. */
export async function postChat(
  payload: ChatRequestDTO,
  signal?: AbortSignal,
): Promise<ChatResponseDTO> {
  const response = await httpClient.post<ChatResponseDTO>('/chat', payload, {
    signal,
    // A supervisor run fans out across six workers; it outlives the default.
    timeout: 0,
  });
  return response.data;
}

/** `GET /chat/capabilities` — what the streaming surfaces can emit. */
export async function fetchCapabilities(signal?: AbortSignal): Promise<StreamCapabilitiesDTO> {
  const response = await httpClient.get<StreamCapabilitiesDTO>('/chat/capabilities', { signal });
  return response.data;
}

/** `GET /chat/threads/{thread_id}` — checkpointed state for a thread. */
export async function fetchThreadState(
  threadId: string,
  signal?: AbortSignal,
): Promise<ThreadStateDTO> {
  const response = await httpClient.get<ThreadStateDTO>(
    `/chat/threads/${encodeURIComponent(threadId)}`,
    { signal },
  );
  return response.data;
}

/**
 * `POST /chat/stream` — every LangGraph state-stream mode, as SSE.
 *
 * Stream modes default to the configured set rather than the backend's full
 * list: `debug` and `checkpoints` are an order of magnitude more traffic than
 * the trace panel reads.
 */
export function streamChat(
  payload: ChatRequestDTO,
  signal?: AbortSignal,
): AsyncGenerator<StreamEnvelopeDTO, void, undefined> {
  return readStreamEnvelopes({
    url: apiUrl('/chat/stream'),
    body: { stream_modes: env.streamModes, ...payload },
    signal,
  });
}

/**
 * `POST /chat/events` — the full `astream_events` v2 taxonomy, as SSE.
 *
 * Finer-grained than `streamChat` and considerably chattier: this includes a
 * frame per model token.
 */
export function streamChatEvents(
  payload: ChatRequestDTO,
  signal?: AbortSignal,
): AsyncGenerator<StreamEnvelopeDTO, void, undefined> {
  return readStreamEnvelopes({ url: apiUrl('/chat/events'), body: payload, signal });
}
