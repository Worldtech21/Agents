/**
 * The delegation graph, full-screen.
 *
 * The side panel reads a run as a list; this reads it as the mesh actually
 * behaves — the supervisor at the top, a lane for every worker it woke, and
 * that worker's steps chained beneath it. While a run streams the graph grows
 * a node at a time and the view follows the newest one, which is the whole
 * point of opening it: watching the run happen rather than reading it after.
 *
 * The canvas is read-only. Nothing here can be dragged, connected or deleted —
 * the shape is the run's, not the operator's.
 */

import {
  Background,
  BackgroundVariant,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

import { TONE_VARIABLE } from '@bff/tone';
import type { Tone, TraceFlowVM } from '@bff/viewmodels';
import { Button } from '@presentation/atoms/Button';
import { Icon } from '@presentation/atoms/Icon';
import { StatusDot } from '@presentation/atoms/StatusDot';
import {
  TraceLaneNode,
  TraceRootNode,
  TraceStepNode,
} from '@presentation/molecules/TraceFlowNodes';
import styles from '@presentation/organisms/organisms.module.css';

import '@xyflow/react/dist/style.css';

/* The card width in `.flowCard`, and the spacing the layout leaves around it. */
const CARD_WIDTH = 264;
const LANE_GAP = 312;
const LANE_Y = 168;
const STEP_Y = LANE_Y + 112;
const STEP_GAP = 116;

const NODE_TYPES = {
  root: TraceRootNode,
  lane: TraceLaneNode,
  step: TraceStepNode,
} as unknown as NodeTypes;

export interface AgentTraceFlowModalProps {
  readonly open: boolean;
  readonly flow: TraceFlowVM;
  readonly isRunning: boolean;
  readonly canReplay: boolean;
  readonly onReplay: () => void;
  readonly onClose: () => void;
}

export function AgentTraceFlowModal({
  open,
  flow,
  isRunning,
  canReplay,
  onReplay,
  onClose,
}: AgentTraceFlowModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape closes, and the page behind must not scroll under the overlay.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className={styles.flowOverlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.flowDialog}
        role="dialog"
        aria-modal="true"
        aria-label="Agent run graph"
        tabIndex={-1}
        ref={dialogRef}
      >
        <header className={styles.flowHead}>
          <span className={styles.flowTitle}>Agent run</span>
          <span className={styles.flowRunState} style={{ color: TONE_VARIABLE[flow.statusTone] }}>
            <StatusDot tone={flow.statusTone} pulsing={isRunning} />
            {flow.statusLabel}
          </span>
          <Button
            variant="quiet"
            size="sm"
            className={styles.flowClose}
            onClick={onClose}
            aria-label="Close the run graph"
          >
            <Icon name="close" size={14} />
          </Button>
        </header>

        <div className={styles.flowCanvas}>
          <ReactFlowProvider>
            <FlowCanvas flow={flow} isRunning={isRunning} />
          </ReactFlowProvider>
        </div>

        <footer className={styles.flowFoot}>
          <span className={styles.flowFootMeta} title={flow.metaLabel}>
            {flow.metaLabel}
          </span>
          <Button variant="card" size="sm" onClick={onReplay} disabled={!canReplay || isRunning}>
            Replay
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/* --------------------------------------------------------------- canvas --- */

function FlowCanvas({ flow, isRunning }: { flow: TraceFlowVM; isRunning: boolean }) {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const { nodes, edges } = useMemo(() => toGraph(flow), [flow]);

  // Follow the run as it grows, but stop the moment the operator takes the
  // canvas over — a view that snaps back while somebody is reading is worse
  // than one that falls behind.
  const isFollowing = useRef(true);
  const nodeCount = nodes.length;

  useEffect(() => {
    if (!isFollowing.current) return;
    void fitView({ padding: 0.22, duration: 320, maxZoom: 1 });
  }, [fitView, nodeCount, isRunning]);

  const refit = useCallback(() => {
    isFollowing.current = true;
    void fitView({ padding: 0.22, duration: 320, maxZoom: 1 });
  }, [fitView]);

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.6}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: false }}
        // `event` is null when the move came from `fitView` rather than a hand.
        onMoveStart={(event) => {
          if (event) isFollowing.current = false;
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} />
      </ReactFlow>

      <div className={styles.flowControls}>
        <Button variant="card" size="xs" onClick={() => void zoomIn({ duration: 160 })} aria-label="Zoom in">
          +
        </Button>
        <Button variant="card" size="xs" onClick={() => void zoomOut({ duration: 160 })} aria-label="Zoom out">
          −
        </Button>
        <Button variant="card" size="xs" onClick={refit}>
          Fit
        </Button>
      </div>

      {flow.isEmpty ? (
        <p className={styles.flowEmpty}>
          {isRunning
            ? 'Waiting on the supervisor to delegate…'
            : 'Run a recommendation to watch the supervisor delegate across the mesh.'}
        </p>
      ) : null}
    </>
  );
}

/* --------------------------------------------------------------- layout --- */

/**
 * Place the graph.
 *
 * Lanes run left to right in the order they were delegated, so the horizontal
 * axis reads as time; each lane's steps run down its column, so the vertical
 * axis reads as that worker's turn.
 */
function toGraph(flow: TraceFlowVM): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const rootX = ((flow.lanes.length - 1) * LANE_GAP) / 2;

  nodes.push({
    id: 'root',
    type: 'root',
    position: { x: Math.max(rootX, 0), y: 0 },
    data: { root: flow.root },
    sourcePosition: Position.Bottom,
    draggable: false,
    width: CARD_WIDTH,
  });

  flow.lanes.forEach((lane, laneIndex) => {
    const x = laneIndex * LANE_GAP;

    nodes.push({
      id: lane.key,
      type: 'lane',
      position: { x, y: LANE_Y },
      data: { lane },
      draggable: false,
      width: CARD_WIDTH,
    });

    edges.push(
      toEdge({
        id: `edge-root-${lane.key}`,
        source: 'root',
        target: lane.key,
        tone: lane.tone,
        animated: lane.state === 'active',
      }),
    );

    lane.steps.forEach((step, stepIndex) => {
      const id = `step-${step.key}`;

      nodes.push({
        id,
        type: 'step',
        position: { x, y: STEP_Y + stepIndex * STEP_GAP },
        data: { step },
        draggable: false,
        width: CARD_WIDTH,
      });

      const previous = stepIndex === 0 ? lane.key : `step-${lane.steps[stepIndex - 1]?.key}`;
      edges.push(
        toEdge({
          id: `edge-${previous}-${id}`,
          source: previous,
          target: id,
          tone: step.tone,
          animated: step.state === 'active',
        }),
      );
    });
  });

  return { nodes, edges };
}

function toEdge(args: {
  id: string;
  source: string;
  target: string;
  tone: Tone;
  animated: boolean;
}): Edge {
  const stroke = TONE_VARIABLE[args.tone];

  return {
    id: args.id,
    source: args.source,
    target: args.target,
    type: 'smoothstep',
    animated: args.animated,
    style: { stroke, strokeWidth: args.animated ? 2 : 1.4, opacity: args.animated ? 1 : 0.55 },
    markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 14, height: 14 },
  };
}
