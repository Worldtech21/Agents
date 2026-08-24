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
  AccessRequestDTO,
  AgentInfoDTO,
  AnalyzeRequestDTO,
  AnalyzeResponseDTO,
  CatalogEntryDTO,
  ChatRequestDTO,
  ChatResponseDTO,
  DecisionDTO,
  HealthDTO,
  MCPServerStatusDTO,
  PersonaDTO,
  RaiseRequestDTO,
  RequestFilters,
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

/* ------------------------------------------------------------ workflow --- */
/*
 * The access request surface. These are plain JSON calls answered in
 * milliseconds — the verdict behind them is computed from policy data in
 * Python, not by a supervisor run — so none of them needs the extended
 * timeout `postChat` sets.
 */

/** `GET /personas` — the actors this prototype can be used as. */
export async function fetchPersonas(signal?: AbortSignal): Promise<PersonaDTO[]> {
  const response = await httpClient.get<PersonaDTO[]>('/personas', { signal });
  return response.data;
}

/** `GET /catalog/entitlements` — the catalog with risk and approval verdicts. */
export async function fetchCatalog(signal?: AbortSignal): Promise<CatalogEntryDTO[]> {
  const response = await httpClient.get<CatalogEntryDTO[]>('/catalog/entitlements', { signal });
  return response.data;
}

/**
 * `POST /requests/analyze` — the deterministic verdict. Writes nothing.
 *
 * This is what a confirmation card renders, rather than the assistant's own
 * account of the rules.
 */
export async function postAnalyze(
  payload: AnalyzeRequestDTO,
  signal?: AbortSignal,
): Promise<AnalyzeResponseDTO> {
  const response = await httpClient.post<AnalyzeResponseDTO>('/requests/analyze', payload, {
    signal,
  });
  return response.data;
}

/**
 * `POST /requests` — raise one request per entitlement named.
 *
 * Returns one record per entitlement: those needing no approval come back
 * already granted, the rest addressed to the subject's manager.
 */
export async function postRequests(
  payload: RaiseRequestDTO,
  signal?: AbortSignal,
): Promise<AccessRequestDTO[]> {
  const response = await httpClient.post<AccessRequestDTO[]>('/requests', payload, { signal });
  return response.data;
}

/**
 * `GET /requests` — one listing serving two jobs.
 *
 * Filtered by `approver_id` it is a manager's inbox; filtered by
 * `requester_id` it is that person's own history, which is where an approval
 * or a refusal is read back.
 */
export async function fetchRequests(
  filters: RequestFilters = {},
  signal?: AbortSignal,
): Promise<AccessRequestDTO[]> {
  const response = await httpClient.get<AccessRequestDTO[]>('/requests', {
    signal,
    params: filters,
  });
  return response.data;
}

/** `GET /requests/{id}`. */
export async function fetchRequest(
  requestId: string,
  signal?: AbortSignal,
): Promise<AccessRequestDTO> {
  const response = await httpClient.get<AccessRequestDTO>(
    `/requests/${encodeURIComponent(requestId)}`,
    { signal },
  );
  return response.data;
}

/** `POST /requests/{id}/approve` — approve, then provision. 403 if not the approver. */
export async function approveRequest(
  requestId: string,
  payload: DecisionDTO,
  signal?: AbortSignal,
): Promise<AccessRequestDTO> {
  const response = await httpClient.post<AccessRequestDTO>(
    `/requests/${encodeURIComponent(requestId)}/approve`,
    payload,
    { signal },
  );
  return response.data;
}

/** `POST /requests/{id}/reject` — `note` is the refusal the requester reads. */
export async function rejectRequest(
  requestId: string,
  payload: DecisionDTO,
  signal?: AbortSignal,
): Promise<AccessRequestDTO> {
  const response = await httpClient.post<AccessRequestDTO>(
    `/requests/${encodeURIComponent(requestId)}/reject`,
    payload,
    { signal },
  );
  return response.data;
}
