/**
 * Diagram lane -> the CSS variable it is drawn in.
 *
 * The sibling of `tone.ts`, and deliberately separate from it. A tone answers
 * "how is this going?" and changes while a run is in flight; a lane answers
 * "what is this?" and never changes at all. Keeping the two maps apart is what
 * stops the execution graph from having to choose between showing a worker's
 * identity and showing its state — it shows both, in different channels.
 */

import type { FlowLane } from '@bff/viewmodels';

/** Defined in presentation/styles/tokens.css, and used only by the flow graph. */
export const LANE_VARIABLE: Record<FlowLane, string> = {
  io: 'var(--lane-blue)',
  supervisor: 'var(--lane-violet)',
  information: 'var(--lane-green)',
  intelligence: 'var(--lane-teal)',
  verification: 'var(--lane-rose)',
  evaluation: 'var(--lane-orange)',
  analysis: 'var(--lane-blue)',
  builder: 'var(--lane-orange)',
};
