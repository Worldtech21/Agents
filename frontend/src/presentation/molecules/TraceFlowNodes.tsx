/**
 * The node kinds the execution-flow graph draws.
 *
 * Two things are being said at once on every card and they are deliberately
 * carried by different means. What the node *is* — request, supervisor,
 * verification worker, tool — is its lane, a hue it holds from the first frame
 * to the last. What the run is *doing* — queued, working, done, failed — is the
 * dot, the ring and the wording, all of which change under it. So a card is
 * recognisable before the run reaches it and still recognisable after, and the
 * key in the corner can name a colour without having to name a state.
 *
 * Every card wears the handles React Flow needs to anchor an edge. They are
 * invisible and unconnectable: an operator is reading a run, not wiring one.
 */

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';

import { LANE_VARIABLE } from '@bff/lane';
import { TONE_VARIABLE } from '@bff/tone';
import type {
  FlowAgentVM,
  FlowLane,
  FlowRootVM,
  FlowStepVM,
  FlowTerminalVM,
  Tone,
} from '@bff/viewmodels';
import { Icon, type IconName } from '@presentation/atoms/Icon';
import { StatusDot } from '@presentation/atoms/StatusDot';
import styles from '@presentation/molecules/molecules.module.css';

/**
 * The two colours a card resolves against.
 *
 * `--lane` tints the frame, the icon and the lines leaving it; `--tone` is the
 * run state, and only ever reaches the dot and the status word. Both are set
 * inline so the whole scheme is one CSS rule per element rather than one per
 * combination.
 */
function cardStyle(lane: FlowLane, tone: Tone): CSSProperties {
  return { '--lane': LANE_VARIABLE[lane], '--tone': TONE_VARIABLE[tone] } as CSSProperties;
}

/* -------------------------------------------------------------- handles --- */

/*
 * Where a line may attach.
 *
 * Fixed slots rather than one handle per edge: React Flow resolves a handle by
 * id at render, so the set has to exist before the layout knows how many lines
 * will use it. Four to a side is more than the fan ever needs, and the layout
 * spreads across them so two delegations never leave from the same point.
 */
const SIDE_SLOTS = [0, 1, 2, 3] as const;
/** Outbound sits above inbound on the same edge, so the pair never coincides. */
const SOURCE_OFFSETS = ['26%', '42%', '58%', '74%'] as const;
const TARGET_OFFSETS = ['34%', '50%', '66%', '82%'] as const;

/** The full slot set for one vertical edge of the supervisor card. */
function SideHandles({ side }: { readonly side: 'left' | 'right' }) {
  const position = side === 'left' ? Position.Left : Position.Right;

  return (
    <>
      {SIDE_SLOTS.map((slot) => (
        <Handle
          key={`s-${side}-${slot}`}
          id={`s-${side}-${slot}`}
          type="source"
          position={position}
          style={{ top: SOURCE_OFFSETS[slot] }}
          isConnectable={false}
        />
      ))}
      {SIDE_SLOTS.map((slot) => (
        <Handle
          key={`t-${side}-${slot}`}
          id={`t-${side}-${slot}`}
          type="target"
          position={position}
          style={{ top: TARGET_OFFSETS[slot] }}
          isConnectable={false}
        />
      ))}
    </>
  );
}

/**
 * A worker's own attachment points.
 *
 * One pair per side plus the vertical pair, because the layout decides at
 * placement time which side of the supervisor a worker sits on, and the same
 * component has to serve both without knowing in advance.
 */
function AgentHandles() {
  return (
    <>
      <Handle id="in-left" type="target" position={Position.Left} style={{ top: '38%' }} isConnectable={false} />
      <Handle id="out-left" type="source" position={Position.Left} style={{ top: '64%' }} isConnectable={false} />
      <Handle id="in-right" type="target" position={Position.Right} style={{ top: '38%' }} isConnectable={false} />
      <Handle id="out-right" type="source" position={Position.Right} style={{ top: '64%' }} isConnectable={false} />
      <Handle id="in-top" type="target" position={Position.Top} isConnectable={false} />
      <Handle id="out-bottom" type="source" position={Position.Bottom} isConnectable={false} />
    </>
  );
}

/* ------------------------------------------------------------- terminal --- */

/**
 * The request and the answer — the two ends of the loop.
 *
 * Drawn alike on purpose: the same person is at both, and the closed line
 * between them is the point the diagram is making.
 */
export type TerminalNode = Node<
  { terminal: FlowTerminalVM; icon: IconName; hasIn: boolean; hasOut: boolean } & Record<string, unknown>,
  'terminal'
>;

export function TraceTerminalNode({ data }: NodeProps<TerminalNode>) {
  const { terminal, icon, hasIn, hasOut } = data;

  return (
    <div
      className={[styles.flowCard, styles.flowTerminal].join(' ')}
      style={cardStyle(terminal.lane, terminal.tone)}
      data-state={terminal.state}
    >
      {hasIn ? <Handle id="in-top" type="target" position={Position.Top} isConnectable={false} /> : null}
      {/* The loop leaves from the left, around the outside of everything. */}
      <Handle id="loop" type="source" position={Position.Left} isConnectable={false} />
      <Handle id="loop-in" type="target" position={Position.Left} isConnectable={false} />

      <span className={styles.flowGlyph} aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>

      <div className={styles.flowCardBody}>
        <div className={styles.flowCardHead}>
          {terminal.orderLabel ? (
            <span className={styles.flowOrder}>{terminal.orderLabel}</span>
          ) : null}
          <span className={styles.flowCardName}>{terminal.label}</span>
          <StatusDot tone={terminal.tone} pulsing={terminal.state === 'active'} />
        </div>
        <span className={styles.flowMeta}>{terminal.detail}</span>
      </div>

      {hasOut ? (
        <Handle id="out-bottom" type="source" position={Position.Bottom} isConnectable={false} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ supervisor --- */

export type RootNode = Node<{ root: FlowRootVM } & Record<string, unknown>, 'root'>;

export function TraceRootNode({ data }: NodeProps<RootNode>) {
  const { root } = data;

  return (
    <div
      className={[styles.flowCard, styles.flowRoot].join(' ')}
      style={cardStyle(root.lane, root.tone)}
      data-state={root.state}
    >
      <Handle id="in-top" type="target" position={Position.Top} isConnectable={false} />
      <SideHandles side="left" />
      <SideHandles side="right" />

      <div className={styles.flowRootHead}>
        <span className={styles.flowGlyph} aria-hidden="true">
          <Icon name="robot" size={22} />
        </span>
        <div className={styles.flowCardBody}>
          <div className={styles.flowCardHead}>
            <span className={styles.flowOrder}>2</span>
            <span className={styles.flowRootName}>{root.label}</span>
            <StatusDot tone={root.tone} size="lg" pulsing={root.state === 'active'} />
          </div>
          <span className={styles.flowCaption}>{root.caption}</span>
        </div>
      </div>

      {/* What it is for, which does not change between runs — the line under it
          is what this run has actually done so far. */}
      <ul className={styles.flowDuties}>
        {root.duties.map((duty) => (
          <li key={duty}>{duty}</li>
        ))}
      </ul>

      <div className={styles.flowRootFoot}>
        <span className={styles.flowStatus}>{root.statusLabel}</span>
        <span className={styles.flowMeta}>{root.detail}</span>
      </div>

      {/* Out on the left of the bottom edge, back in on the right, so a worker
          sitting on the spine gets the same out-and-back pair as one at the
          side — read vertically instead of horizontally. */}
      <Handle id="out-bottom" type="source" position={Position.Bottom} style={{ left: '34%' }} isConnectable={false} />
      <Handle id="t-bottom" type="target" position={Position.Bottom} style={{ left: '66%' }} isConnectable={false} />
    </div>
  );
}

/* ----------------------------------------------------------------- agent --- */

export type AgentNode = Node<{ agent: FlowAgentVM } & Record<string, unknown>, 'agent'>;

export function TraceAgentNode({ data }: NodeProps<AgentNode>) {
  const { agent } = data;
  const meta = [agent.stepCountLabel, agent.durationLabel].filter(Boolean).join(' · ');

  return (
    <div
      className={[styles.flowCard, styles.flowAgent].join(' ')}
      style={cardStyle(agent.lane, agent.tone)}
      data-state={agent.state}
    >
      <AgentHandles />

      <div className={styles.flowRootHead}>
        <span className={styles.flowGlyph} aria-hidden="true">
          <Icon name="robot" size={20} />
        </span>
        <div className={styles.flowCardBody}>
          <div className={styles.flowCardHead}>
            <span className={styles.flowOrder}>{agent.orderLabel}</span>
            <span className={styles.flowCardName}>{agent.agentLabel}</span>
            {/* Which visit this is, so two branches of one agent read apart. */}
            {agent.visitLabel ? <span className={styles.flowVisit}>{agent.visitLabel}</span> : null}
            <StatusDot tone={agent.tone} size="lg" pulsing={agent.state === 'active'} />
          </div>
          <span className={styles.flowRole}>{agent.role}</span>
        </div>
      </div>

      <div className={styles.flowAgentFoot}>
        <span className={styles.flowStatus}>{agent.statusLabel}</span>
        {meta ? <span className={styles.flowMeta}>{meta}</span> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ step --- */

/**
 * A tool use, with what it actually said behind it.
 *
 * The card holds one elided line, which is enough to follow a run but not
 * enough to check one — the tool's arguments and the payload it returned are
 * the evidence. Clicking opens that payload in a panel below the card, floated
 * rather than grown into the layout so the graph does not reflow around a
 * reader. `nowheel` lets a long payload scroll without the canvas zooming.
 */
export type StepNode = Node<
  {
    step: FlowStepVM;
    lane: FlowLane;
    /** Set by the canvas, which keeps one card open at a time. */
    isOpen?: boolean;
    /** Takes the node's id, which is what the canvas holds open. */
    onToggle?: (nodeId: string) => void;
  } & Record<string, unknown>,
  'step'
>;

export function TraceStepNode({ id, data }: NodeProps<StepNode>) {
  const { step, lane, isOpen = false, onToggle } = data;
  const canOpen = (step.inputPayload + step.outputPayload).trim().length > 0;

  return (
    <div
      className={[styles.flowCard, styles.flowStep, canOpen ? styles.flowStepOpenable : '']
        .filter(Boolean)
        .join(' ')}
      style={cardStyle(lane, step.tone)}
      data-state={step.state}
      data-open={isOpen ? 'true' : undefined}
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
      aria-expanded={canOpen ? isOpen : undefined}
      title={canOpen ? (isOpen ? 'Hide what this step returned' : 'Show what this step returned') : step.label}
      onKeyDown={(event) => {
        if (!canOpen || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        onToggle?.(id);
      }}
    >
      <Handle id="in-top" type="target" position={Position.Top} isConnectable={false} />

      <div className={styles.flowStepHead}>
        <span className={styles.flowGlyph} aria-hidden="true">
          <Icon name={step.kind === 'tool' ? 'wrench' : 'report'} size={16} />
        </span>
        <span className={styles.flowOrder}>{step.orderLabel}</span>
        <span className={styles.flowStepName}>{step.label}</span>
        {step.durationLabel ? <span className={styles.flowStepMs}>{step.durationLabel}</span> : null}
        {canOpen ? (
          <span className={styles.flowStepCaret} aria-hidden="true">
            {isOpen ? '−' : '+'}
          </span>
        ) : null}
      </div>

      {/* What went in, then what came back: one tool use, read top to bottom. */}
      {step.detail ? <span className={styles.flowDetail}>{step.detail}</span> : null}
      {step.resultPreview ? (
        <span className={[styles.flowDetail, styles.flowResult].join(' ')}>{step.resultPreview}</span>
      ) : null}
      {step.kind === 'tool' && !step.resultPreview && step.state === 'active' ? (
        <span className={styles.flowDetail}>Waiting on the tool…</span>
      ) : null}

      {isOpen ? (
        <div className={[styles.flowOutput, 'nowheel', 'nodrag'].join(' ')}>
          {step.inputPayload ? (
            <>
              <span className={styles.flowOutputLabel}>Sent</span>
              <pre className={styles.flowOutputText}>{step.inputPayload}</pre>
            </>
          ) : null}
          {step.outputPayload ? (
            <>
              <span className={styles.flowOutputLabel}>
                {step.kind === 'tool' ? 'Returned' : 'In full'}
              </span>
              <pre className={styles.flowOutputText}>{step.outputPayload}</pre>
            </>
          ) : null}
        </div>
      ) : null}

      <Handle id="out-bottom" type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

/* --------------------------------------------------------------- builder --- */

export type BuilderNode = Node<{ terminal: FlowTerminalVM } & Record<string, unknown>, 'builder'>;

export function TraceBuilderNode({ data }: NodeProps<BuilderNode>) {
  const { terminal } = data;

  return (
    <div
      className={[styles.flowCard, styles.flowBuilder].join(' ')}
      style={cardStyle(terminal.lane, terminal.tone)}
      data-state={terminal.state}
    >
      <Handle id="in-top" type="target" position={Position.Top} isConnectable={false} />

      <span className={styles.flowGlyph} aria-hidden="true">
        <Icon name="document" size={20} />
      </span>

      <div className={styles.flowCardBody}>
        <div className={styles.flowCardHead}>
          <span className={styles.flowOrder}>{terminal.orderLabel}</span>
          <span className={styles.flowCardName}>{terminal.label}</span>
          <StatusDot tone={terminal.tone} pulsing={terminal.state === 'active'} />
        </div>
        <span className={styles.flowMeta}>{terminal.detail}</span>
      </div>

      <Handle id="out-bottom" type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

/* ----------------------------------------------------------------- title --- */

export type TitleNode = Node<{ title: string; subtitle: string } & Record<string, unknown>, 'title'>;

export function TraceTitleNode({ data }: NodeProps<TitleNode>) {
  return (
    <div className={styles.flowHeading}>
      <span className={styles.flowHeadingTitle}>{data.title}</span>
      <span className={styles.flowHeadingSub}>{data.subtitle}</span>
    </div>
  );
}

/* ------------------------------------------------------------------- key --- */

/*
 * The two keys, drawn as nodes rather than as an overlay.
 *
 * They belong to the drawing, not to the viewport: pan the graph and the key
 * travels with it, which is what makes an exported or screenshotted view
 * self-explanatory. It is also why they carry no state — nothing in a key is
 * ever queued or working.
 */

export type LegendNode = Node<Record<string, unknown>, 'legend'>;

/** Each entry draws its own line, because the line *is* the thing being named. */
const EDGE_KEY: ReadonlyArray<{
  readonly label: string;
  readonly lane: FlowLane;
  readonly dashed: boolean;
  readonly arrow: 'end' | 'start';
}> = [
  { label: 'Handoff (transfer_to_*)', lane: 'supervisor', dashed: false, arrow: 'end' },
  { label: 'Return (transfer_back_to_supervisor)', lane: 'information', dashed: false, arrow: 'end' },
  { label: 'Tool call', lane: 'analysis', dashed: true, arrow: 'end' },
  { label: 'Tool result / data returned', lane: 'analysis', dashed: true, arrow: 'start' },
];

export function TraceLegendNode(_props: NodeProps<LegendNode>) {
  return (
    <div className={styles.flowKey}>
      <span className={styles.flowKeyTitle}>Legend</span>
      <ul className={styles.flowKeyList}>
        {EDGE_KEY.map((entry) => (
          <li key={entry.label} className={styles.flowKeyRow}>
            <svg
              className={styles.flowKeyLine}
              viewBox="0 0 46 10"
              width="46"
              height="10"
              aria-hidden="true"
              style={{ color: LANE_VARIABLE[entry.lane] }}
            >
              <line
                x1={entry.arrow === 'end' ? 1 : 9}
                y1="5"
                x2={entry.arrow === 'end' ? 37 : 45}
                y2="5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeDasharray={entry.dashed ? '4 3' : undefined}
              />
              <path
                d={entry.arrow === 'end' ? 'M37 1.5 45 5l-8 3.5z' : 'M9 1.5 1 5l8 3.5z'}
                fill="currentColor"
              />
            </svg>
            <span className={styles.flowKeyLabel}>{entry.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type LaneKeyNode = Node<Record<string, unknown>, 'laneKey'>;

const LANE_KEY: ReadonlyArray<{ readonly label: string; readonly lane: FlowLane }> = [
  { label: 'Input / output', lane: 'io' },
  { label: 'Supervisor', lane: 'supervisor' },
  { label: 'Information agent', lane: 'information' },
  { label: 'Intelligence agent', lane: 'intelligence' },
  { label: 'Verification agent', lane: 'verification' },
  { label: 'Evaluation agent', lane: 'evaluation' },
  { label: 'Analysis agent', lane: 'analysis' },
  { label: 'Recommendation builder', lane: 'builder' },
];

export function TraceLaneKeyNode(_props: NodeProps<LaneKeyNode>) {
  return (
    <div className={[styles.flowKey, styles.flowKeyWide].join(' ')}>
      <span className={styles.flowKeyTitle}>Node types</span>
      <ul className={[styles.flowKeyList, styles.flowKeyGrid].join(' ')}>
        {LANE_KEY.map((entry) => (
          <li key={entry.label} className={styles.flowKeyRow}>
            <span
              className={styles.flowKeySwatch}
              style={{ '--lane': LANE_VARIABLE[entry.lane] } as CSSProperties}
              aria-hidden="true"
            />
            <span className={styles.flowKeyLabel}>{entry.label}</span>
          </li>
        ))}
        <li className={styles.flowKeyRow}>
          <span
            className={[styles.flowKeySwatch, styles.flowKeySwatchTool].join(' ')}
            style={{ '--lane': LANE_VARIABLE.io } as CSSProperties}
            aria-hidden="true"
          />
          <span className={styles.flowKeyLabel}>Tool / function</span>
        </li>
      </ul>
    </div>
  );
}
