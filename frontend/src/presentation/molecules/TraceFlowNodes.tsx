/**
 * The three node kinds the delegation graph draws.
 *
 * Each is a plain card in the design's vocabulary — dot, label, meta — wrapped
 * in the handles React Flow needs to anchor an edge to it. The handles are
 * invisible: an operator is reading a run, not wiring one, so nothing here is
 * connectable.
 */

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';

import { TONE_VARIABLE } from '@bff/tone';
import type { FlowLaneVM, FlowRootVM, FlowStepVM, Tone } from '@bff/viewmodels';
import { StatusDot } from '@presentation/atoms/StatusDot';
import styles from '@presentation/molecules/molecules.module.css';

/** The tone, handed to CSS so a card can tint its border and rail with it. */
function toneStyle(tone: Tone): CSSProperties {
  return { '--tone': TONE_VARIABLE[tone] } as CSSProperties;
}

/* ----------------------------------------------------------------- root --- */

export type RootNode = Node<{ root: FlowRootVM } & Record<string, unknown>, 'root'>;

export function TraceRootNode({ data }: NodeProps<RootNode>) {
  const { root } = data;

  return (
    <div
      className={[styles.flowCard, styles.flowRoot].join(' ')}
      style={toneStyle(root.tone)}
      data-state={root.state}
    >
      <div className={styles.flowCardHead}>
        <StatusDot tone={root.tone} size="lg" pulsing={root.state === 'active'} />
        <span className={styles.flowRootName}>{root.label}</span>
        <span className={styles.flowStatus}>{root.statusLabel}</span>
      </div>
      <span className={styles.flowMeta}>{root.detail}</span>

      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

/* ----------------------------------------------------------------- lane --- */

export type LaneNode = Node<{ lane: FlowLaneVM } & Record<string, unknown>, 'lane'>;

export function TraceLaneNode({ data }: NodeProps<LaneNode>) {
  const { lane } = data;

  return (
    <div
      className={[styles.flowCard, styles.flowLane].join(' ')}
      style={toneStyle(lane.tone)}
      data-state={lane.state}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />

      <div className={styles.flowCardHead}>
        <StatusDot tone={lane.tone} size="lg" pulsing={lane.state === 'active'} />
        <span className={styles.flowLaneName}>{lane.agentLabel}</span>
        <span className={styles.flowStatus}>{lane.statusLabel}</span>
      </div>
      <span className={styles.flowMeta}>
        {lane.stepCountLabel}
        {lane.durationLabel ? ` · ${lane.durationLabel}` : ''}
      </span>

      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

/* ----------------------------------------------------------------- step --- */

export type StepNode = Node<{ step: FlowStepVM } & Record<string, unknown>, 'step'>;

export function TraceStepNode({ data }: NodeProps<StepNode>) {
  const { step } = data;

  return (
    <div
      className={[styles.flowCard, styles.flowStep].join(' ')}
      style={toneStyle(step.tone)}
      data-state={step.state}
      title={step.detail || step.label}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />

      <div className={styles.flowCardHead}>
        <span className={styles.flowStepName}>{step.label}</span>
        {step.durationLabel ? (
          <span className={styles.flowStepMs}>{step.durationLabel}</span>
        ) : null}
      </div>
      {step.detail ? <span className={styles.flowDetail}>{step.detail}</span> : null}

      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}
