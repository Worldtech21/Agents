/**
 * The execution flow itself.
 *
 * The side panel reads a run as a list; this reads it as the system — the
 * request at the top, the supervisor presiding in the middle, its workers
 * ranged to either side with their own tools chained beneath them, and the
 * answer coming back round to the person who asked. The spine is the
 * architecture and is drawn for every run; the workers are what this
 * particular run actually did.
 *
 * One worker node is one visit to one worker, so an agent called twice is
 * drawn twice rather than having two conversations folded into one card. While
 * a run streams the drawing grows a node and a line at a time and the view
 * follows, which is the point of watching it: seeing the run happen rather than
 * reading it after.
 *
 * The canvas is read-only. Nothing here can be dragged, connected or deleted —
 * the shape is the run's, not the operator's. It carries its own React Flow
 * provider and its own sizing class, so it can be dropped inline in a report or
 * into the full-screen modal without either caller wiring anything up; it fills
 * whatever flex parent it is given.
 */

import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LANE_VARIABLE } from '@bff/lane';
import type { FlowLane, TraceFlowVM } from '@bff/viewmodels';
import { Button } from '@presentation/atoms/Button';
import {
  TraceDelegationEdge,
  TraceLoopEdge,
  TraceToolEdge,
} from '@presentation/molecules/TraceFlowEdge';
import {
  TraceAgentNode,
  TraceBuilderNode,
  TraceLaneKeyNode,
  TraceLegendNode,
  TraceRootNode,
  TraceStepNode,
  TraceTerminalNode,
  TraceTitleNode,
} from '@presentation/molecules/TraceFlowNodes';
import { toGraph } from '@presentation/organisms/flowLayout';
import styles from '@presentation/organisms/organisms.module.css';

import '@xyflow/react/dist/style.css';

const NODE_TYPES = {
  root: TraceRootNode,
  agent: TraceAgentNode,
  step: TraceStepNode,
  terminal: TraceTerminalNode,
  builder: TraceBuilderNode,
  title: TraceTitleNode,
} as unknown as NodeTypes;

const EDGE_TYPES = {
  delegation: TraceDelegationEdge,
  tool: TraceToolEdge,
  loop: TraceLoopEdge,
} as unknown as EdgeTypes;

/** Arrowheads for the hand-drawn strands, which cannot use React Flow's. */
const ARROW_LANES: readonly FlowLane[] = [
  'io',
  'supervisor',
  'information',
  'intelligence',
  'verification',
  'evaluation',
  'analysis',
  'builder',
];

export interface FlowCanvasProps {
  readonly flow: TraceFlowVM;
  readonly isRunning: boolean;
}

export function FlowCanvas({ flow, isRunning }: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas flow={flow} isRunning={isRunning} />
    </ReactFlowProvider>
  );
}

/* ---------------------------------------------------------------- canvas --- */

function Canvas({ flow, isRunning }: FlowCanvasProps) {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const graph = useMemo(() => toGraph(flow), [flow]);

  // One open card at a time: two payload panels at once would cover the graph
  // they are supposed to explain. Held by node id, which is stable across the
  // stream, so a card stays open while later steps arrive around it.
  const [openNodeId, setOpenNodeId] = useState<string | null>(null);
  const toggleNode = useCallback((nodeId: string) => {
    setOpenNodeId((open) => (open === nodeId ? null : nodeId));
  }, []);

  // The open card is lifted above its neighbours: the panel hangs below the
  // card, over whatever the layout put there.
  const nodes = useMemo(
    () =>
      graph.nodes.map((node) =>
        node.type === 'step'
          ? {
              ...node,
              data: { ...node.data, isOpen: node.id === openNodeId, onToggle: toggleNode },
              zIndex: node.id === openNodeId ? 20 : undefined,
            }
          : node,
      ),
    [graph.nodes, openNodeId, toggleNode],
  );

  const edges = graph.edges;

  // Follow the run as it grows, but stop the moment the operator takes the
  // canvas over — a view that snaps back while somebody is reading is worse
  // than one that falls behind.
  const isFollowing = useRef(true);
  const nodeCount = nodes.length;

  useEffect(() => {
    if (!isFollowing.current) return;
    void fitView({ padding: 0.12, duration: 320, maxZoom: 1 });
  }, [fitView, nodeCount, isRunning]);

  const refit = useCallback(() => {
    isFollowing.current = true;
    void fitView({ padding: 0.12, duration: 320, maxZoom: 1 });
  }, [fitView]);

  return (
    <div className={styles.flowCanvas}>
      {/* Referenced by id from the tool strands, which are drawn by hand and so
          get no marker from React Flow. */}
      <svg className={styles.flowDefs} aria-hidden="true">
        <defs>
          {ARROW_LANES.map((lane) => (
            <marker
              key={lane}
              id={`flow-arrow-${lane}`}
              markerWidth="9"
              markerHeight="9"
              refX="8"
              refY="4.5"
              orient="auto-start-reverse"
              markerUnits="userSpaceOnUse"
            >
              <path d="M0,1 L8,4.5 L0,8 z" fill={LANE_VARIABLE[lane]} />
            </marker>
          ))}
        </defs>
      </svg>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
        minZoom={0.12}
        maxZoom={1.6}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        // The cards carry their own affordance and their own keyboard handling,
        // so React Flow's node focus ring would only add a second tab stop.
        nodesFocusable={false}
        // Passing this is also what gives a node pointer events at all on a
        // canvas with nothing selectable or draggable.
        onNodeClick={(_, node) => {
          if (node.type === 'step') toggleNode(node.id);
        }}
        onPaneClick={() => setOpenNodeId(null)}
        proOptions={{ hideAttribution: false }}
        // `event` is null when the move came from `fitView` rather than a hand.
        onMoveStart={(event) => {
          if (event) isFollowing.current = false;
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} />
      </ReactFlow>

      {/* Pinned to the viewport rather than the drawing, so they stay legible
          however deep the run grows and however far the view is panned. */}
      <div className={styles.flowLegendTopLeft}>
        <TraceLegendNode />
      </div>
      <div className={styles.flowLegendTopRight}>
        <TraceLaneKeyNode />
      </div>

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
    </div>
  );
}
