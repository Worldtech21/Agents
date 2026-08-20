/**
 * View models — the only shapes `presentation/` is allowed to consume.
 *
 * A view model is already formatted for display: percentages are strings,
 * durations carry their unit, and every semantic colour has been resolved to a
 * `Tone`. Components render fields; they never compute them.
 */

/** The design's four semantic colours plus a neutral, from Access Advisor.dc.html. */
export type Tone = 'blue' | 'green' | 'amber' | 'red' | 'neutral';

/** Which screen is showing. Mirrors the `view` state in the design. */
export type ViewKey = 'queue' | 'report' | 'chat';

/* ------------------------------------------------------------ app shell --- */

export interface NavItemVM {
  readonly key: ViewKey;
  readonly label: string;
  readonly badge: string;
  readonly icon: 'queue' | 'report' | 'chat';
}

export interface AgentMeshItemVM {
  readonly key: string;
  readonly name: string;
  /** Tool count as text, or the design's em-dash when the roster reports none. */
  readonly toolsLabel: string;
  readonly description: string;
  /** True when every MCP server this agent binds to is connected. */
  readonly connected: boolean;
  readonly tone: Tone;
  readonly statusLabel: string;
}

export interface MeshSummaryVM {
  readonly label: string;
  readonly tone: Tone;
  readonly agents: readonly AgentMeshItemVM[];
}

export interface ServiceHealthVM {
  readonly ready: boolean;
  readonly statusLabel: string;
  readonly tone: Tone;
  readonly appName: string;
  readonly environment: string;
  readonly model: string;
  readonly supervisorModel: string;
  readonly providerLabel: string;
  readonly agentNames: readonly string[];
  readonly mcpServers: readonly McpServerVM[];
  readonly connectedServerCount: number;
  readonly configuredServerCount: number;
  readonly error: string | null;
}

export interface McpServerVM {
  readonly name: string;
  readonly label: string;
  readonly transport: string;
  readonly toolsLabel: string;
  readonly connected: boolean;
  readonly tone: Tone;
  readonly statusLabel: string;
  readonly error: string | null;
}

/* -------------------------------------------------------- recommendation --- */

export interface ProfileFieldVM {
  readonly label: string;
  readonly value: string;
}

export interface EmployeeProfileVM {
  readonly employeeId: string;
  readonly name: string;
  readonly initials: string;
  readonly statusLabel: string;
  /** "Financial Analyst · L3 — Finance Operations" */
  readonly headline: string;
  readonly fields: readonly ProfileFieldVM[];
}

export interface EntitlementVM {
  readonly entitlementId: string;
  readonly name: string;
  /** "ENT-1042 · SAP S/4HANA" */
  readonly subtitle: string;
  readonly application: string;
  /** Null when the peer affinity agent reported no proportion. */
  readonly affinityPercent: number | null;
  readonly affinityLabel: string;
  readonly affinityBarWidth: string;
  readonly peerCountLabel: string;
  readonly riskLabel: string;
  readonly riskTone: Tone;
  readonly riskScoreLabel: string;
  readonly policyRule: string;
  readonly statusLabel: string;
  /** The part of `policyRule` that reads as prose, when it has one. */
  readonly note: string;
}

export interface SodRuleVM {
  readonly key: string;
  readonly ruleId: string;
  readonly severityLabel: string;
  readonly tone: Tone;
  readonly text: string;
}

export interface SodPanelVM {
  readonly resultLabel: string;
  readonly resultTone: Tone;
  readonly scopeLabel: string;
  readonly summary: string;
  readonly rules: readonly SodRuleVM[];
  readonly conflictsFound: boolean;
}

export interface RecommendationVM {
  readonly employeeId: string;
  readonly threadId: string;
  readonly employee: EmployeeProfileVM;
  readonly recommended: readonly EntitlementVM[];
  readonly optional: readonly OptionalEntitlementVM[];
  readonly sod: SodPanelVM;
  readonly provisioningInstructions: string;
  readonly readOnly: boolean;
  /** Present when the supervisor reported `metadata.incomplete`. */
  readonly incompleteNote: string | null;
  readonly receivedAt: number;
}

export interface OptionalEntitlementVM {
  readonly entitlementId: string;
  readonly name: string;
  readonly subtitle: string;
  readonly affinityLabel: string;
  readonly riskLabel: string;
  readonly riskTone: Tone;
  readonly reason: string;
}

/**
 * The supervisor's refusal shape, rendered rather than thrown: a
 * `MISSING_EMPLOYEE_ID` is a well-formed answer, not a failure.
 */
export interface SupervisorRefusalVM {
  readonly code: string;
  readonly title: string;
  readonly message: string;
  readonly threadId: string;
}

/* ----------------------------------------------------------------- trace --- */

export type TraceStepState = 'done' | 'active' | 'idle' | 'failed';

export interface TraceRowVM {
  readonly key: string;
  readonly label: string;
  readonly agentLabel: string;
  readonly detail: string;
  readonly durationLabel: string;
  readonly state: TraceStepState;
  readonly tone: Tone;
}

export interface TracePanelVM {
  readonly rows: readonly TraceRowVM[];
  readonly statusLabel: string;
  readonly statusTone: Tone;
  readonly metaLabel: string;
  /** Key of the agent currently working, for the sidebar mesh highlight. */
  readonly activeAgentKey: string | null;
}

/* ------------------------------------------------------------------ chat --- */

export interface ChatMessageVM {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly who: string;
  readonly text: string;
  readonly citations: readonly string[];
  readonly isStreaming: boolean;
}

/* ----------------------------------------------------------------- queue --- */

export interface QueueRowVM {
  readonly employeeId: string;
  readonly name: string;
  /** "Finance Operations · Financial Analyst" */
  readonly role: string;
  readonly startLabel: string;
  readonly peersLabel: string;
  readonly peerBarWidth: string;
  readonly statusLabel: string;
  readonly statusTone: Tone;
  readonly actionLabel: string;
  readonly hasResult: boolean;
}

export interface QueueStatVM {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly unit: string;
  readonly note: string;
  readonly tone: Tone;
}
