/**
 * View models — the only shapes `presentation/` is allowed to consume.
 *
 * A view model is already formatted for display: percentages are strings,
 * durations carry their unit, and every semantic colour has been resolved to a
 * `Tone`. Components render fields; they never compute them.
 */

/** The design's four semantic colours plus a neutral, from Access Advisor.dc.html. */
export type Tone = 'blue' | 'green' | 'amber' | 'red' | 'neutral';

/** Which persona is acting. There is no login; this is the whole of identity. */
export type ActorMode = 'hr' | 'employee';

/**
 * Which screen is showing.
 *
 * The union spans both modes; which subset is reachable is decided by the
 * acting persona, in `VIEWS_BY_MODE` below.
 */
export type ViewKey =
  | 'queue'
  | 'report'
  | 'chat'
  | 'hrRequests'
  | 'assistant'
  | 'approvals'
  | 'myRequests';

/** The views each mode may reach, in nav order. The first is that mode's home. */
export const VIEWS_BY_MODE: Record<ActorMode, readonly ViewKey[]> = {
  hr: ['queue', 'report', 'hrRequests', 'chat'],
  employee: ['assistant', 'approvals', 'myRequests'],
};

/* ------------------------------------------------------------ app shell --- */

export interface NavItemVM {
  readonly key: ViewKey;
  readonly label: string;
  readonly badge: string;
  readonly icon: IconKey;
  /** Draws attention to a non-zero inbox without the badge carrying colour. */
  readonly tone?: Tone;
}

/** The icon names the shell uses. A subset of `IconName` in presentation/atoms. */
export type IconKey = 'queue' | 'report' | 'chat' | 'inbox' | 'history' | 'user';

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

/**
 * What a step is, so neither view has to read it back out of a label.
 *
 * `tool` is one whole tool use — the call and what it returned, which the
 * graph draws as a single step because that is one thing the agent did.
 */
export type TraceStepKind = 'delegation' | 'tool' | 'report' | 'error';

export interface TraceRowVM {
  readonly key: string;
  readonly label: string;
  readonly kind: TraceStepKind;
  /** Namespace key of the worker that produced the step. */
  readonly agentKey: string;
  /**
   * The worker's namespace *instance* — `User_Profiling_Agent:bcf72bc4…`.
   *
   * The agent key says who; this says which visit. LangGraph gives a subgraph
   * a fresh instance every time the supervisor delegates into it, so this is
   * what separates a second delegation from a continuation of the first.
   */
  readonly instanceKey: string;
  readonly agentLabel: string;
  /** The one line the row has room for: a tool's arguments, or the prose. */
  readonly detail: string;
  /** What the tool returned, elided. Empty on every other kind of step. */
  readonly resultPreview: string;
  /** The arguments in full, pretty-printed. Empty when there were none. */
  readonly inputPayload: string;
  /** What came back in full, pretty-printed when it is JSON. */
  readonly outputPayload: string;
  readonly durationLabel: string;
  readonly state: TraceStepState;
  readonly tone: Tone;
}

export interface TracePanelVM {
  readonly rows: readonly TraceRowVM[];
  // readonly statusLabel: string;
  // readonly statusTone: Tone;
  // readonly metaLabel: string;
  /** Key of the agent currently working, for the sidebar mesh highlight. */
  readonly activeAgentKey: string | null;
}

/* ------------------------------------------------------------ trace flow --- */

/**
 * The same trace, shaped as the system's execution flow rather than a list.
 *
 * The list reads a run as history; the graph reads it as architecture — the
 * request at the top, the supervisor presiding in the middle, its workers to
 * either side with their own tools chained beneath them, and the answer
 * returning to the person who asked. A branch is a single visit to a single
 * worker: delegate to the same agent twice and the graph draws two branches,
 * because that is two separate pieces of work and folding them into one column
 * would interleave two conversations that never met. Both views are built from
 * the same envelopes, so neither can say something the run did not do.
 */

/**
 * The hue a node is drawn in — a role, not a state.
 *
 * Run state is already carried by `TraceStepState`, and it changes while a run
 * is in flight; the lane never does. Holding them apart is what lets a card
 * keep its identity from queued to done while still showing which it is: the
 * lane tints the card and its lines, the state drives the dot, the ring and
 * the wording.
 */
export type FlowLane =
  | 'io'
  | 'supervisor'
  | 'information'
  | 'intelligence'
  | 'verification'
  | 'evaluation'
  | 'analysis'
  | 'builder';

/** One tool use, drawn hanging off the agent that made it. */
export interface FlowStepVM {
  readonly key: string;
  readonly label: string;
  readonly kind: TraceStepKind;
  /** Its place in the drawing's numbering — `"5.2"`. */
  readonly orderLabel: string;
  /** The arguments a tool was called with, on one line. */
  readonly detail: string;
  /** What it returned, on one line. */
  readonly resultPreview: string;
  /** Both payloads in full, which the card reveals when opened. */
  readonly inputPayload: string;
  readonly outputPayload: string;
  readonly durationLabel: string;
  readonly state: TraceStepState;
  readonly tone: Tone;
}

/** One visit to one worker: everything it did between being handed the brief and handing back. */
export interface FlowAgentVM {
  /** The namespace instance, so a second visit is a second node. */
  readonly key: string;
  readonly agentLabel: string;
  /** What the roster says this worker is for, under its name on the card. */
  readonly role: string;
  /** Its place in the drawing's numbering — `"5"`. */
  readonly orderLabel: string;
  readonly lane: FlowLane;
  /** "2nd call" when the run reached this agent more than once, else empty. */
  readonly visitLabel: string;
  /** "Working" | "Done" | "Failed". */
  readonly statusLabel: string;
  readonly state: TraceStepState;
  readonly tone: Tone;
  /** "4 steps". */
  readonly stepCountLabel: string;
  /** Time across the visit, or empty while it is still open. */
  readonly durationLabel: string;
  /** Every step it took, in the order it took them. */
  readonly steps: readonly FlowStepVM[];
}

/**
 * One delegation out, drawn as the connection that carried it.
 *
 * Exactly one per branch: a second delegation to the same agent is a second
 * connection to a second node, so no two lines ever end in the same place.
 */
export interface FlowHandoffVM {
  readonly key: string;
  /** 1-based position in the run — the number the connection carries. */
  readonly order: number;
  /** The branch this connection ends at. The supervisor is always the source. */
  readonly targetKey: string;
  /** The graph's own name for the edge — `transfer_to_policy_evaluation_agent`. */
  readonly transferLabel: string;
  /** What the worker opened with, in the words of its own first step. */
  readonly note: string;
  readonly lane: FlowLane;
  readonly state: TraceStepState;
  readonly tone: Tone;
}

/**
 * The other half of a delegation: the worker handing control back.
 *
 * Drawn as its own line rather than an arrowhead on the outbound one, because
 * that is what the graph does — `transfer_back_to_supervisor` is a call the
 * worker makes, and a run can stall with the outbound line drawn and this one
 * not yet earned.
 */
export interface FlowReturnVM {
  readonly key: string;
  /** The branch the control is coming back from. */
  readonly sourceKey: string;
  readonly label: string;
  readonly lane: FlowLane;
  /** Idle until the visit closes: an open branch has not handed back yet. */
  readonly state: TraceStepState;
  readonly tone: Tone;
}

/** The supervisor, which presides over the run rather than appearing in it. */
export interface FlowRootVM {
  readonly label: string;
  readonly caption: string;
  readonly statusLabel: string;
  readonly state: TraceStepState;
  readonly lane: FlowLane;
  readonly tone: Tone;
  /** "3 workers · 12 steps". */
  readonly detail: string;
  /** What it is doing for the run, as the bullets under its name. */
  readonly duties: readonly string[];
}

/**
 * A node on the centre spine that is not an agent — the request, the answer
 * being assembled, and the answer going back out.
 */
export interface FlowTerminalVM {
  readonly label: string;
  readonly detail: string;
  readonly orderLabel: string;
  readonly lane: FlowLane;
  readonly state: TraceStepState;
  readonly tone: Tone;
}

export interface TraceFlowVM {
  /** The drawing's own heading, over the graph. */
  // readonly title: string;
  /** The question that started the run. */
  readonly request: FlowTerminalVM;
  readonly root: FlowRootVM;
  /** One per delegation, in the order the supervisor made them. */
  readonly branches: readonly FlowAgentVM[];
  /** In run order, which is the order the numbers read. */
  readonly handoffs: readonly FlowHandoffVM[];
  /** One per branch that has handed control back. */
  readonly returns: readonly FlowReturnVM[];
  /** Where the answer is put together, under the last of the work. */
  readonly builder: FlowTerminalVM;
  /** The answer, and the line closing the loop back to the request. */
  readonly response: FlowTerminalVM;
  readonly statusLabel: string;
  readonly statusTone: Tone;
  readonly metaLabel: string;
  /** The agent holding the turn, for the animated connection. */
  readonly activeAgentKey: string | null;
  /** True before anything has streamed — the canvas shows the spine alone. */
  readonly isEmpty: boolean;
}
/* ------------------------------------------------------------------ chat --- */

/**
 * One stretch of the model's reasoning, attributed to whoever was thinking.
 *
 * Segments are split by agent rather than by chunk: the supervisor's thinking
 * and a worker's are different trains of thought, but a worker's own deltas are
 * one paragraph and read as one. A new segment therefore *is* a handoff, which
 * is what lets the panel render a run as delegation rather than as one voice.
 */
export interface ThoughtSegmentVM {
  readonly key: string;
  /** Namespace key, for matching against the mesh. */
  readonly agentKey: string;
  readonly agentLabel: string;
  /** Everything this agent did on its turn, in the order it happened. */
  readonly events: readonly ThoughtEventVM[];
  /** `active` while this agent still holds the turn, `done` once it hands over. */
  readonly state: TraceStepState;
  readonly tone: Tone;
  /** "1.84s" once the agent has finished; empty while it is still thinking. */
  readonly durationLabel: string;
  /**
   * Epoch ms this segment opened. Present because `durationLabel` cannot be
   * computed until the segment closes, and closing happens in a later chunk.
   */
  readonly startedAt: number;
}

/**
 * One thing an agent did: reasoned, called a tool, got a result back, handed
 * the turn on, or stated a conclusion.
 *
 * These are the run's actual events, not a narration of them — every one is
 * built from a chunk LangGraph emitted, so an empty list means nothing
 * happened rather than that nothing was captured.
 */
export type ThoughtEventKind = 'thinking' | 'tool.call' | 'tool.result' | 'handoff' | 'message';

export interface ThoughtEventVM {
  readonly key: string;
  readonly kind: ThoughtEventKind;
  /** "Called peer_holdings", "Delegated to Policy" — empty for reasoning. */
  readonly label: string;
  /** Arguments, result, or the reasoning prose itself. */
  readonly detail: string;
  readonly tone: Tone;
}

export interface ChatMessageVM {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly who: string;
  readonly text: string;
  readonly citations: readonly string[];
  readonly isStreaming: boolean;
  /** The reasoning behind this turn. Empty when thinking is off or not kept. */
  readonly thoughts: readonly ThoughtSegmentVM[];
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

/* -------------------------------------------------------------- personas --- */

export interface PersonaVM {
  readonly actorId: string;
  readonly name: string;
  /** "SN" — the switcher's avatar, since there are no photographs. */
  readonly initials: string;
  readonly mode: ActorMode;
  /** "Employee · Finance" or "HR operations". */
  readonly roleLabel: string;
  /** Empty when nobody is on record. */
  readonly managerId: string;
  readonly pendingApprovals: number;
  readonly pendingLabel: string;
}

/* -------------------------------------------------------------- requests --- */

/** One access request, formatted for a list row. */
export interface AccessRequestVM {
  readonly requestId: string;
  readonly entitlementName: string;
  readonly application: string;
  readonly statusLabel: string;
  readonly statusTone: Tone;
  /** True while the request is still waiting on somebody. */
  readonly isPending: boolean;
  /** True once nothing further can happen to it. */
  readonly isSettled: boolean;
  readonly riskLabel: string;
  readonly riskTone: Tone;
  readonly policyBasis: string;
  readonly sodConflicts: readonly string[];
  /** "for Anjali Rao (NJ1004)" — empty when the subject is the viewer. */
  readonly subjectLabel: string;
  readonly requesterLabel: string;
  readonly approverLabel: string;
  readonly justification: string;
  /** The approver's reason. This is how a refusal reaches the requester. */
  readonly decisionNote: string;
  readonly timestampLabel: string;
}

/** The deterministic verdict, as the confirmation card renders it. */
export interface VerdictVM {
  readonly subjectId: string;
  readonly entitlementId: string;
  readonly entitlementName: string;
  readonly application: string;
  readonly riskLabel: string;
  readonly riskTone: Tone;
  readonly approvalRequired: boolean;
  readonly policyBasis: string;
  readonly sodConflicts: readonly string[];
  readonly alreadyHeld: boolean;
  readonly approverId: string;
  /** Approval is needed but nobody is on record — the request cannot be routed. */
  readonly approverMissing: boolean;
  /** "Request access" | "Send to Ramesh" | "You already hold this". */
  readonly actionLabel: string;
  /** True when there is nothing to submit. */
  readonly actionDisabled: boolean;
  /** One line explaining the verdict in the employee's terms. */
  readonly summary: string;
  readonly summaryTone: Tone;
}

/** What the assistant proposed, before the backend has been asked. */
export interface RequestIntentVM {
  readonly entitlementId: string | null;
  readonly entitlementName: string | null;
  readonly justification: string;
  readonly readyToSubmit: boolean;
}

/* ---------------------------------------------------------------- catalog --- */

export interface CatalogEntryVM {
  readonly entitlementId: string;
  readonly entitlementName: string;
  readonly application: string;
  readonly riskLabel: string;
  readonly riskTone: Tone;
  readonly approvalRequired: boolean;
  readonly approvalLabel: string;
}
