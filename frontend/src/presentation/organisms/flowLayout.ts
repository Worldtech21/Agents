/**
 * Where everything on the execution graph goes.
 *
 * Kept apart from the canvas because it is arithmetic, not a component: it
 * takes a view model and returns nodes and edges with coordinates on them,
 * touches no DOM and holds no state. That is also what makes it checkable —
 * the one thing a drawing like this must never do is overlap two cards, and
 * that is a question about numbers.
 */

import { MarkerType, Position, type Edge, type Node } from '@xyflow/react';

import { LANE_VARIABLE } from '@bff/lane';
import type { FlowAgentVM, FlowLane, TraceFlowVM, TraceStepState } from '@bff/viewmodels';

/* ---------------------------------------------------------------- metrics --- */

/* Card widths, and the heights the layout budgets for them.
 *
 * React Flow measures a node once it is rendered, but the layout has to place
 * everything before that — so these are the placement budget, set a little
 * generous. Being slightly loose costs whitespace; being tight would cost a
 * collision, which is the one thing a drawing like this cannot survive. */
const CARD_W = 300;
const ROOT_W = 320;

const TERMINAL_H = 84;
/* The builder carries a longer line than the two terminals do, so it gets a
   budget of its own rather than quietly borrowing theirs. */
const BUILDER_H = 92;
const ROOT_H = 268;
const AGENT_H = 104;
const STEP_H = 104;

/* How far a side column sits from the spine. The gap is set by the longest
   thing that has to fit in it — `transfer_to_affinity_intelligence_agent` —
   not by the cards, which would happily sit much closer. */
const SIDE_DX = 600;

/* Vertical rhythm. The tool gap is the wide one: the call and the result run
   between the two cards, and both are labelled. */
const SPINE_TOP = 0;
const ROOT_Y = 210;
const SIDE_TOP = 120;
const TOOL_GAP = 74;
const STEP_GAP = 62;
const BLOCK_GAP = 76;
const SPINE_GAP = 96;

/** How far outside everything the closing line runs. */
const LOOP_MARGIN = 130;

/** Supervisor handle slots per side, from `SideHandles`. */
const SIDE_SLOTS = 4;

/* ---------------------------------------------------------------- layout --- */

/** A worker's placement: which side of the spine, and where down it. */
interface Placement {
  readonly branch: FlowAgentVM;
  readonly side: 'left' | 'right' | 'centre';
  readonly cx: number;
  readonly y: number;
  /** Which of the supervisor's handle slots its two lines use. */
  readonly slot: number;
  /** Bottom of the whole block — the agent plus its tool chain. */
  readonly bottom: number;
}

/**
 * Place the drawing.
 *
 * Workers alternate left and right of the spine in the order the supervisor
 * woke them, so the run reads outward from the middle in both directions at
 * once. An odd worker out goes on the spine itself, under the supervisor,
 * which is both the only place left and the place that reads best: with five
 * workers the drawing is symmetrical, and the last one sits directly over the
 * answer it is about to contribute to.
 *
 * Every worker ends in a column of its own and every line ends somewhere
 * different, so nothing crosses.
 */
export function toGraph(flow: TraceFlowVM): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  /* ------------------------------------------------------ worker placing --- */

  const total = flow.branches.length;
  // Odd counts put the last worker on the spine; the rest alternate outward.
  const centreIndex = total % 2 === 1 ? total - 1 : -1;

  const placements: Placement[] = [];
  const nextY = { left: SIDE_TOP, right: SIDE_TOP };
  const nextSlot = { left: 0, right: 0 };
  let spineY = ROOT_Y + ROOT_H + SPINE_GAP;

  flow.branches.forEach((branch, index) => {
    const chain = branch.steps.length;
    const blockH = AGENT_H + (chain > 0 ? TOOL_GAP + chain * STEP_H + (chain - 1) * STEP_GAP : 0);

    if (index === centreIndex) {
      placements.push({
        branch,
        side: 'centre',
        cx: 0,
        y: spineY,
        slot: 0,
        bottom: spineY + blockH,
      });
      spineY += blockH + SPINE_GAP;
      return;
    }

    const side = index % 2 === 0 ? 'left' : 'right';
    const y = nextY[side];
    const slot = nextSlot[side] % SIDE_SLOTS;

    placements.push({
      branch,
      side,
      cx: side === 'left' ? -SIDE_DX : SIDE_DX,
      y,
      slot,
      bottom: y + blockH,
    });

    nextY[side] = y + blockH + BLOCK_GAP;
    nextSlot[side] += 1;
  });

  /* -------------------------------------------------------------- spine --- */

  nodes.push(
    titleNode(flow),
    terminalNode('request', flow.request, 'user', { hasIn: false, hasOut: true }, SPINE_TOP),
    {
      id: 'root',
      type: 'root',
      position: { x: -ROOT_W / 2, y: ROOT_Y },
      data: { root: flow.root },
      draggable: false,
      width: ROOT_W,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    },
  );

  const builderY = spineY;
  const responseY = builderY + BUILDER_H + SPINE_GAP;

  nodes.push(
    {
      id: 'builder',
      type: 'builder',
      position: { x: -CARD_W / 2, y: builderY },
      data: { terminal: flow.builder },
      draggable: false,
      width: CARD_W,
    },
    terminalNode('response', flow.response, 'user', { hasIn: true, hasOut: false }, responseY),
  );

  edges.push(
    spineEdge('spine-request', 'request', 'root', 'out-bottom', 'in-top', flow.request.state),
  );

  /* ------------------------------------------------------------ workers --- */

  placements.forEach((placement) => {
    const { branch, side, cx, y, slot } = placement;

    nodes.push({
      id: branch.key,
      type: 'agent',
      position: { x: cx - CARD_W / 2, y },
      data: { agent: branch },
      draggable: false,
      width: CARD_W,
    });

    // The tool chain, hanging straight down from the worker that called it.
    branch.steps.forEach((step, stepIndex) => {
      const id = `step-${step.key}`;
      const stepY = y + AGENT_H + TOOL_GAP + stepIndex * (STEP_H + STEP_GAP);

      nodes.push({
        id,
        type: 'step',
        position: { x: cx - CARD_W / 2, y: stepY },
        data: { step, lane: branch.lane },
        draggable: false,
        width: CARD_W,
      });

      const previous = stepIndex === 0 ? branch.key : `step-${branch.steps[stepIndex - 1]?.key}`;

      edges.push({
        id: `tool-${id}`,
        source: previous,
        sourceHandle: 'out-bottom',
        target: id,
        targetHandle: 'in-top',
        type: 'tool',
        data: {
          lane: branch.lane,
          state: step.state,
          // A tool that has not answered yet gets its returning strand drawn
          // but faded, so an open call reads as open.
          answered: step.state === 'done' || step.state === 'failed',
        },
        zIndex: 0,
      });
    });

    /* The two halves of the delegation. A worker on the spine is reached from
       under the supervisor and hands back alongside, which is the same pair of
       lines read vertically. */
    const outbound =
      side === 'centre'
        ? { source: 'out-bottom', target: 'in-top' }
        : { source: `s-${side}-${slot}`, target: side === 'left' ? 'in-right' : 'in-left' };

    const inbound =
      side === 'centre'
        ? { source: 'out-right', target: 't-bottom' }
        : { source: side === 'left' ? 'out-right' : 'out-left', target: `t-${side}-${slot}` };

    const handoff = flow.handoffs.find((entry) => entry.targetKey === branch.key);
    const back = flow.returns.find((entry) => entry.sourceKey === branch.key);

    if (handoff) {
      edges.push({
        id: handoff.key,
        source: 'root',
        sourceHandle: outbound.source,
        target: branch.key,
        targetHandle: outbound.target,
        type: 'delegation',
        animated: handoff.state === 'active',
        data: {
          label: handoff.transferLabel,
          lane: 'supervisor',
          state: handoff.state,
          order: handoff.order,
          note: handoff.note,
        },
        style: strokeFor('supervisor', handoff.state),
        markerEnd: arrowFor('supervisor'),
        zIndex: 2,
      });
    }

    if (back) {
      edges.push({
        id: back.key,
        source: branch.key,
        sourceHandle: inbound.source,
        target: 'root',
        targetHandle: inbound.target,
        type: 'delegation',
        data: { label: back.label, lane: branch.lane, state: back.state },
        style: strokeFor(branch.lane, back.state),
        markerEnd: arrowFor(branch.lane),
        zIndex: 2,
      });
    }
  });

  /* ------------------------------------------------- spine continuation --- */

  /* What feeds the builder: the bottom of the spine chain if a worker sits
     there, and the supervisor itself when none does. */
  const centre = placements.find((placement) => placement.side === 'centre');
  const lastCentreStep = centre?.branch.steps[centre.branch.steps.length - 1];

  const feed = centre
    ? { id: lastCentreStep ? `step-${lastCentreStep.key}` : centre.branch.key, handle: 'out-bottom' }
    : { id: 'root', handle: 'out-bottom' };

  edges.push(
    spineEdge('spine-builder', feed.id, 'builder', feed.handle, 'in-top', flow.builder.state),
    spineEdge('spine-response', 'builder', 'response', 'out-bottom', 'in-top', flow.response.state),
  );

  /* ---------------------------------------------------------- the loop --- */

  const leftEdgeX = Math.min(-SIDE_DX - CARD_W / 2, -ROOT_W / 2);
  const boundaryX = leftEdgeX - LOOP_MARGIN;

  edges.push({
    id: 'loop',
    source: 'response',
    sourceHandle: 'loop',
    target: 'request',
    targetHandle: 'loop-in',
    type: 'loop',
    data: { label: 'closed loop', boundaryX, state: flow.response.state },
    style: {
      stroke: LANE_VARIABLE.io,
      strokeWidth: 1.5,
      strokeDasharray: '7 5',
      opacity: flow.response.state === 'done' ? 0.85 : 0.4,
    },
    markerEnd: arrowFor('io'),
    zIndex: 1,
  });

  /* ----------------------------------------------------------- the keys --- */

  // Anchored to the drawing rather than the viewport, so they pan and export
  // with it. Placed off the deepest column on either side.
  const deepest = Math.max(
    responseY + TERMINAL_H,
    ...placements.map((placement) => placement.bottom),
  );

  nodes.push(
    {
      id: 'legend',
      type: 'legend',
      position: { x: leftEdgeX, y: deepest + 80 },
      data: {},
      draggable: false,
      selectable: false,
    },
    {
      id: 'laneKey',
      type: 'laneKey',
      position: { x: SIDE_DX - CARD_W / 2, y: deepest + 80 },
      data: {},
      draggable: false,
      selectable: false,
    },
  );

  return { nodes, edges };
}

/* --------------------------------------------------------------- helpers --- */

function titleNode(flow: TraceFlowVM): Node {
  return {
    id: 'title',
    type: 'title',
    position: { x: -320, y: SPINE_TOP - 130 },
    data: { title: flow.title, subtitle: flow.metaLabel },
    draggable: false,
    selectable: false,
    width: 640,
  };
}

function terminalNode(
  id: string,
  terminal: TraceFlowVM['request'],
  icon: 'user',
  ends: { hasIn: boolean; hasOut: boolean },
  y: number,
): Node {
  return {
    id,
    type: 'terminal',
    position: { x: -CARD_W / 2, y },
    data: { terminal, icon, ...ends },
    draggable: false,
    width: CARD_W,
  };
}

/** The spine's own lines: down the middle, in the supervisor's colour. */
function spineEdge(
  id: string,
  source: string,
  target: string,
  sourceHandle: string,
  targetHandle: string,
  state: TraceStepState,
): Edge {
  return {
    id,
    source,
    sourceHandle,
    target,
    targetHandle,
    type: 'delegation',
    animated: state === 'active',
    data: { label: '', lane: 'supervisor', state },
    style: strokeFor('supervisor', state),
    markerEnd: arrowFor('supervisor'),
    zIndex: 1,
  };
}

/**
 * A line's weight.
 *
 * The lane picks the colour and the state picks how loudly it is stated: a
 * delegation that has not happened yet is drawn faintly, so the drawing shows
 * the whole architecture without ever claiming work the run has not done.
 */
function strokeFor(lane: FlowLane, state: TraceStepState) {
  const emphasised = state === 'active' || state === 'failed';

  return {
    stroke: LANE_VARIABLE[lane],
    strokeWidth: emphasised ? 2 : 1.6,
    opacity: state === 'idle' ? 0.34 : emphasised ? 1 : 0.72,
  };
}

function arrowFor(lane: FlowLane) {
  return {
    type: MarkerType.ArrowClosed,
    color: LANE_VARIABLE[lane],
    width: 16,
    height: 16,
  };
}
