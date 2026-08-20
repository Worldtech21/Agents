/**
 * Raw wire types — a one-to-one transcription of the backend's Pydantic DTOs.
 *
 * These are the *only* shapes the API client returns. Nothing in
 * `presentation/` may import from this file: components consume view models
 * produced by `bff/`, so a backend rename never reaches a component.
 *
 * Source of truth: app/schemas/common.py, app/schemas/chat.py,
 * app/domain/models.py.
 */

import type { StreamModeName } from '@infrastructure/config/env';

/* -------------------------------------------------------------- errors --- */

/** app/api/errors.py wraps every handled failure in `{ "error": {...} }`. */
export interface ErrorDTO {
  readonly code: string;
  readonly message: string;
  readonly details: Record<string, unknown>;
}

export interface ErrorEnvelopeDTO {
  readonly error: ErrorDTO;
}

/* -------------------------------------------------------------- health --- */

/** app/schemas/common.py: MCPServerStatusDTO */
export interface MCPServerStatusDTO {
  readonly name: string;
  readonly configured: boolean;
  readonly connected: boolean;
  readonly transport: string;
  readonly tool_count: number;
  readonly error: string | null;
}

/** app/schemas/common.py: LLMProviderDTO */
export interface LLMProviderDTO {
  readonly provider: string;
  readonly package: string;
  readonly installed: boolean;
  readonly model: string;
  readonly supervisor_provider: string;
  readonly supervisor_model: string;
  readonly available_providers: readonly string[];
}

/** app/schemas/common.py: LLMProviderInfoDTO */
export interface LLMProviderInfoDTO {
  readonly name: string;
  readonly package: string;
  readonly installed: boolean;
  readonly default_model: string;
  readonly requires_api_key: boolean;
  readonly env_key: string | null;
  readonly active: boolean;
}

/** app/schemas/common.py: HealthDTO */
export interface HealthDTO {
  readonly status: string;
  readonly app: string;
  readonly environment: string;
  readonly graph_ready: boolean;
  readonly model: string;
  readonly supervisor_model: string;
  readonly llm: LLMProviderDTO | null;
  readonly agents: readonly string[];
  readonly mcp_servers: readonly MCPServerStatusDTO[];
  readonly stream_modes: readonly string[];
  readonly error: string | null;
}

/* -------------------------------------------------------------- agents --- */

/** app/schemas/common.py: AgentInfoDTO */
export interface AgentInfoDTO {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly model: string;
  readonly provider: string;
  readonly mcp_servers: readonly string[];
  readonly tools: readonly string[];
}

/* ---------------------------------------------------------------- chat --- */

export type ChatRole = 'user' | 'assistant' | 'system';

/** app/schemas/chat.py: ChatMessageDTO */
export interface ChatMessageDTO {
  readonly role: ChatRole;
  readonly content: string;
}

/** app/schemas/chat.py: ChatRequestDTO */
export interface ChatRequestDTO {
  readonly message?: string;
  readonly messages?: readonly ChatMessageDTO[];
  readonly thread_id?: string;
  readonly recursion_limit?: number;
  readonly stream_modes?: readonly StreamModeName[];
  readonly metadata?: Record<string, unknown>;
}

/** app/schemas/chat.py: ChatResponseDTO */
export interface ChatResponseDTO {
  readonly thread_id: string;
  readonly answer: string;
  /** LangChain messages, serialised by app/infrastructure/streaming/serialization.py. */
  readonly messages: readonly Record<string, unknown>[];
}

/** app/schemas/chat.py: ThreadStateDTO */
export interface ThreadStateDTO {
  readonly thread_id: string;
  readonly values: Record<string, unknown> | null;
  readonly next: readonly string[];
  readonly created_at: string | null;
  readonly metadata: Record<string, unknown> | null;
}

/** app/schemas/common.py: StreamCapabilitiesDTO */
export interface StreamCapabilitiesDTO {
  readonly graph_stream_modes: readonly string[];
  readonly subgraphs: boolean;
  readonly event_stream_version: string;
  readonly event_types: readonly string[];
  readonly channels: readonly string[];
}

/* ------------------------------------------------------------ streaming --- */

/** app/domain/models.py: StreamChannel */
export type StreamChannel = 'graph' | 'events' | 'control';

/**
 * app/domain/models.py: StreamEnvelope.to_dict().
 *
 * Every chunk on both streaming surfaces arrives in this shape, which is why
 * the client needs one parser rather than two.
 */
export interface StreamEnvelopeDTO {
  readonly seq: number;
  readonly channel: StreamChannel;
  /** Stream mode for `graph`, event type for `events`, lifecycle for `control`. */
  readonly event: string;
  readonly namespace: readonly string[];
  readonly thread_id: string;
  /** Unix seconds, float. */
  readonly ts: number;
  readonly payload: unknown;
}

/** Payload of a `graph.updates` envelope: node name -> partial state. */
export type GraphUpdatePayload = Record<string, GraphNodeUpdate | null>;

export interface GraphNodeUpdate {
  readonly messages?: readonly SerializedMessage[];
  readonly [key: string]: unknown;
}

/**
 * A LangChain message after `to_jsonable`. Field presence varies by message
 * type, so every field is optional and narrowing happens in the BFF.
 */
export interface SerializedMessage {
  readonly type?: string;
  readonly role?: string;
  readonly name?: string | null;
  readonly content?: unknown;
  readonly tool_calls?: readonly SerializedToolCall[];
  readonly tool_call_id?: string;
  readonly id?: string;
  readonly response_metadata?: Record<string, unknown>;
  readonly usage_metadata?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface SerializedToolCall {
  readonly name?: string;
  readonly args?: Record<string, unknown>;
  readonly id?: string;
}

/** Payload of a `graph.messages` envelope. */
export interface GraphMessagesPayload {
  readonly chunk: SerializedMessage;
  readonly metadata: Record<string, unknown>;
}

/** Payload of `control.stream.error`, emitted in-band by GraphRunner. */
export interface ControlErrorPayload {
  readonly code: string;
  readonly message: string;
}
