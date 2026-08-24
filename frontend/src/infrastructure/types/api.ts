/**
 * Raw wire types — a one-to-one transcription of the backend's Pydantic DTOs.
 *
 * These are the *only* shapes the API client returns. Nothing in
 * `presentation/` may import from this file: components consume view models
 * produced by `bff/`, so a backend rename never reaches a component.
 *
 * Source of truth: app/schemas/common.py, app/schemas/chat.py,
 * app/schemas/requests.py, app/domain/models.py.
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

/* ------------------------------------------------------------ workflow --- */
/*
 * The access request surface (app/schemas/requests.py). Unlike the chat
 * endpoints these are ordinary fast JSON calls — the verdict behind them is
 * computed in Python from policy data, with no model in the loop.
 */

/** app/schemas/requests.py: PersonaDTO — the actor list standing in for a login. */
export interface PersonaDTO {
  readonly actor_id: string;
  readonly name: string;
  /** `hr` | `employee`; typed as string because the backend owns the set. */
  readonly mode: string;
  readonly department: string;
  readonly job_role: string;
  /** Empty when nobody is on record — approvals then have nowhere to go. */
  readonly manager_id: string;
  /** Requests waiting on this persona's decision, right now. */
  readonly pending_approvals: number;
}

/** app/schemas/requests.py: SubjectDTO — the person an access request is about. */
export interface SubjectDTO {
  readonly employee_id: string;
  /** `IDENTITY` | `NEW_JOINER`. */
  readonly subject_type: string;
  readonly name: string;
  readonly department: string;
  readonly job_role: string;
  readonly job_level: string;
  readonly location: string;
  readonly manager_id: string;
  readonly entitlements: readonly string[];
}

/** app/schemas/requests.py: SodConflictDTO */
export interface SodConflictDTO {
  readonly sod_id: string;
  readonly conflicting_entitlement: string;
  readonly severity: string;
}

/**
 * app/schemas/requests.py: VerdictDTO — the deterministic answer.
 *
 * This, not the assistant's own summary, is what a confirmation card renders.
 */
export interface VerdictDTO {
  readonly subject_id: string;
  readonly entitlement_id: string;
  readonly entitlement_name: string;
  readonly application: string;
  readonly risk_score: number | null;
  readonly risk_category: string;
  readonly approval_required: boolean;
  /** The policy clause behind the verdict, quotable to an approver. */
  readonly policy_basis: string;
  readonly sod_conflicts: readonly SodConflictDTO[];
  readonly already_held: boolean;
  /** Empty when no approval is needed, or when needed but nobody is on record. */
  readonly approver_id: string;
  /** Separates those two cases. */
  readonly approver_missing: boolean;
}

export interface AnalyzeResponseDTO {
  readonly subject: SubjectDTO;
  readonly verdict: VerdictDTO;
}

/** app/schemas/requests.py: AccessRequestDTO — one row of the request tracker. */
export interface AccessRequestDTO {
  readonly request_id: string;
  readonly requester_id: string;
  /** `EMPLOYEE` | `HR`. */
  readonly requester_type: string;
  readonly subject_id: string;
  readonly subject_type: string;
  readonly entitlement_id: string;
  readonly entitlement_name: string;
  readonly application: string;
  /** One of the statuses `GET /requests/statuses` enumerates. */
  readonly status: string;
  readonly approval_required: boolean;
  readonly policy_basis: string;
  readonly approver_id: string;
  readonly risk_score: number | null;
  readonly risk_category: string;
  /** Rendered `SOD002:AUDIT_TOOL` form, already split by the backend. */
  readonly sod_conflicts: readonly string[];
  readonly justification: string;
  /** The approver's reason — this is how a refusal reaches the requester. */
  readonly decision_note: string;
  readonly created_at: string;
  readonly decided_at: string;
  readonly granted_at: string;
}

/** app/schemas/requests.py: CatalogEntryDTO */
export interface CatalogEntryDTO {
  readonly entitlement_id: string;
  readonly entitlement_name: string;
  readonly application: string;
  readonly owner: string;
  readonly risk_score: number | null;
  readonly risk_category: string;
  readonly approval_required: boolean;
  readonly policy_basis: string;
}

/* --------------------------------------------------- workflow requests --- */

/** app/schemas/requests.py: EntitlementRefDTO — id or exact name, not both required. */
export interface EntitlementRefDTO {
  readonly entitlement_id?: string;
  readonly entitlement_name?: string;
  readonly justification?: string;
}

export interface AnalyzeRequestDTO {
  readonly subject_id: string;
  readonly entitlement_id?: string;
  readonly entitlement_name?: string;
}

/**
 * app/schemas/requests.py: RaiseRequestDTO.
 *
 * `entitlements` is a list so HR can submit a whole accepted recommendation in
 * one call; each is still judged on its own.
 */
export interface RaiseRequestDTO {
  readonly requester_id: string;
  readonly requester_type: 'EMPLOYEE' | 'HR';
  readonly subject_id: string;
  readonly entitlements: readonly EntitlementRefDTO[];
  readonly justification?: string;
}

/** app/schemas/requests.py: DecisionDTO — a manager approving or rejecting. */
export interface DecisionDTO {
  readonly approver_id: string;
  readonly note: string;
}

/** Query parameters `GET /requests` accepts. */
export interface RequestFilters {
  readonly requester_id?: string;
  readonly approver_id?: string;
  readonly subject_id?: string;
  readonly status?: string;
  readonly limit?: number;
  readonly offset?: number;
}
