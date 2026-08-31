/**
 * The four kinds of line the execution graph draws.
 *
 * The graph's own vocabulary, kept literal on purpose: a delegation is
 * `transfer_to_<agent>`, a hand-back is `transfer_back_to_supervisor`, a tool
 * use is a call down and a result back up, and the run closes by returning to
 * the person who opened it. Naming the lines the way LangGraph names them is
 * what lets somebody read this drawing beside the code and recognise both.
 *
 * Every label rides *on* its line rather than beside its node, because an agent
 * woken twice keeps one node and gains a second line — the line is the thing
 * that happened, and the node is only where it happened.
 */

import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import type { CSSProperties } from 'react';

import { LANE_VARIABLE } from '@bff/lane';
import type { FlowLane, TraceStepState } from '@bff/viewmodels';
import styles from '@presentation/molecules/molecules.module.css';

/** Corner rounding shared by every orthogonal route here. */
const CORNER = 14;

/* ---------------------------------------------------------- delegation --- */

/**
 * A delegation out, or a hand-back in.
 *
 * One component for both directions: they are the same journey read the other
 * way round, and drawing them with one router is what keeps an outbound line
 * and its answering line parallel instead of subtly disagreeing about where
 * the corner goes.
 */
export type DelegationEdge = Edge<
  {
    label: string;
    lane: FlowLane;
    state: TraceStepState;
    /** Numbered only on the way out; a hand-back is not a step of its own. */
    order?: number;
    /** What the worker opened with, for the line's tooltip. */
    note?: string;
  } & Record<string, unknown>,
  'delegation'
>;

export function TraceDelegationEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  style,
  markerEnd,
  data,
}: EdgeProps<DelegationEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: CORNER,
  });

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />

      {data?.label ? (
        <EdgeLabelRenderer>
          <div
            className={styles.flowEdgeLabel}
            style={
              {
                transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                '--lane': LANE_VARIABLE[data.lane],
              } as CSSProperties
            }
            data-state={data.state}
            title={data.note ? `${data.label} — ${data.note}` : data.label}
          >
            {data.order ? <span className={styles.flowEdgeIndex}>{data.order}</span> : null}
            <span className={styles.flowEdgeNote}>{data.label}</span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------- tool --- */

/**
 * A tool use: the call down, the result back up.
 *
 * Drawn as one edge with two strands rather than two edges, because they are
 * one event — a tool that was called and has not answered yet is a single
 * incomplete thing, and splitting it across two edges would let the graph
 * claim a result it never received. The returning strand is faded until the
 * result actually arrives.
 */
export type ToolEdge = Edge<
  { lane: FlowLane; state: TraceStepState; answered: boolean } & Record<string, unknown>,
  'tool'
>;

/** How far either side of centre the two strands run. */
const STRAND_OFFSET = 30;

export function TraceToolEdge({ sourceX, sourceY, targetX, targetY, data }: EdgeProps<ToolEdge>) {
  const lane = LANE_VARIABLE[data?.lane ?? 'analysis'];
  const answered = data?.answered ?? false;
  const active = data?.state === 'active';

  const midY = (sourceY + targetY) / 2;
  const down = strand(sourceX - STRAND_OFFSET, sourceY, targetX - STRAND_OFFSET, targetY);
  const up = strand(targetX + STRAND_OFFSET, targetY, sourceX + STRAND_OFFSET, sourceY);

  return (
    <>
      <path
        d={down}
        fill="none"
        stroke={lane}
        strokeWidth={1.5}
        strokeDasharray="5 4"
        markerEnd={`url(#flow-arrow-${data?.lane ?? 'analysis'})`}
        opacity={active || answered ? 0.9 : 0.5}
        className={active ? styles.flowStrandRunning : undefined}
      />
      <path
        d={up}
        fill="none"
        stroke={lane}
        strokeWidth={1.5}
        strokeDasharray="5 4"
        markerEnd={`url(#flow-arrow-${data?.lane ?? 'analysis'})`}
        // Nothing has come back up yet, so the strand is drawn but not claimed.
        opacity={answered ? 0.9 : 0.28}
      />

      <EdgeLabelRenderer>
        <div
          className={styles.flowStrandLabels}
          style={
            {
              transform: `translate(-50%, -50%) translate(${sourceX}px, ${midY}px)`,
              '--lane': lane,
            } as CSSProperties
          }
        >
          <span className={styles.flowStrandLabel}>Tool call</span>
          <span className={styles.flowStrandLabel} data-pending={answered ? undefined : 'true'}>
            Tool result
          </span>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

/** A straight drop with a jog at each end, so a strand leaves its card square. */
function strand(x1: number, y1: number, x2: number, y2: number): string {
  return `M ${x1},${y1} L ${x2},${y2}`;
}

/* ---------------------------------------------------------------- loop --- */

/**
 * The line closing the loop: the answer, back to whoever asked for it.
 *
 * Routed the long way round the outside of the drawing rather than straight up
 * through it. That is the whole reason it is hand-routed — a direct line would
 * cross every worker on the left, and the one thing this line has to show is
 * that it does not touch any of them on the way.
 */
export type LoopEdge = Edge<
  { label: string; boundaryX: number; state: TraceStepState } & Record<string, unknown>,
  'loop'
>;

export function TraceLoopEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
  data,
}: EdgeProps<LoopEdge>) {
  const x = data?.boundaryX ?? Math.min(sourceX, targetX) - 120;

  const path = [
    `M ${sourceX},${sourceY}`,
    `L ${x + CORNER},${sourceY}`,
    `Q ${x},${sourceY} ${x},${sourceY - CORNER}`,
    `L ${x},${targetY + CORNER}`,
    `Q ${x},${targetY} ${x + CORNER},${targetY}`,
    `L ${targetX},${targetY}`,
  ].join(' ');

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />

      {data?.label ? (
        <EdgeLabelRenderer>
          <div
            className={[styles.flowEdgeLabel, styles.flowLoopLabel].join(' ')}
            style={
              {
                transform: `translate(-50%, -50%) translate(${x}px, ${(sourceY + targetY) / 2}px) rotate(-90deg)`,
                '--lane': LANE_VARIABLE.io,
              } as CSSProperties
            }
            data-state={data.state}
          >
            <span className={styles.flowEdgeNote}>{data.label}</span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
