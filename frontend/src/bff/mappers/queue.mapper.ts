/**
 * Watchlist entries + their run outcomes -> the provisioning queue.
 *
 * The backend exposes no "list the joiners" route — the only way to reach that
 * data is to ask the supervisor about a specific employee id, and it refuses a
 * request that names none (`MISSING_EMPLOYEE_ID`). So the queue is the set of
 * ids this operator has asked about, and every column beside the id is read
 * back out of a real recommendation. Nothing in this file invents a row.
 */

import type { RecommendationOutcome } from '@bff/outcome';
import { formatShortDate } from '@bff/mappers/recommendation.mapper';
import type { QueueRowVM, QueueStatVM, Tone } from '@bff/viewmodels';

/** A joiner the operator has put on the queue. */
export interface QueueEntry {
  readonly employeeId: string;
  readonly addedAt: number;
  readonly lastRunAt: number | null;
}

export interface QueueInput {
  readonly entries: readonly QueueEntry[];
  /** Outcome per employee id, from the React Query cache. Absent = never run. */
  readonly outcomes: ReadonlyMap<string, RecommendationOutcome>;
  /** Employee id currently streaming, if any. */
  readonly runningId: string | null;
}

const UNKNOWN = '—';

export function toQueueRows(input: QueueInput): QueueRowVM[] {
  const peerSizes = input.entries.map((entry) =>
    peerGroupSize(input.outcomes.get(entry.employeeId)),
  );
  const largestGroup = Math.max(1, ...peerSizes.filter((size): size is number => size !== null));

  return input.entries
    .map((entry, index) => {
      const outcome = input.outcomes.get(entry.employeeId);
      const peers = peerSizes[index] ?? null;
      const status = describeStatus(entry, outcome, input.runningId === entry.employeeId, peers);

      return {
        employeeId: entry.employeeId,
        name: nameFor(outcome, entry.employeeId),
        role: roleFor(outcome),
        startLabel: startFor(outcome),
        peersLabel: peers === null ? UNKNOWN : String(peers),
        peerBarWidth: peers === null ? '0%' : `${Math.round((peers / largestGroup) * 100)}%`,
        statusLabel: status.label,
        statusTone: status.tone,
        actionLabel: outcome?.kind === 'recommendation' ? 'Open' : 'Run',
        hasResult: outcome !== undefined,
      } satisfies QueueRowVM;
    })
    .sort(byStartDateThenId);
}

/* ---------------------------------------------------------------- stats --- */

export function toQueueStats(input: QueueInput): QueueStatVM[] {
  const entries = input.entries;
  const outcomes = entries.map((entry) => input.outcomes.get(entry.employeeId));

  const awaiting = outcomes.filter((outcome) => outcome === undefined).length;
  const recommended = outcomes.filter(
    (outcome) => outcome?.kind === 'recommendation' && !outcome.view.sod.conflictsFound,
  ).length;

  const flagged = entries.filter((entry) => {
    const outcome = input.outcomes.get(entry.employeeId);
    return outcome?.kind === 'recommendation' && outcome.view.sod.conflictsFound;
  });

  const affinity = medianAffinity(outcomes);

  return [
    {
      key: 'awaiting',
      label: 'Awaiting run',
      value: String(awaiting),
      unit: awaiting === 1 ? 'joiner' : 'joiners',
      note: awaiting === 0 ? 'Every queued joiner has a result' : 'Not yet sent to the supervisor',
      tone: 'neutral',
    },
    {
      key: 'recommended',
      label: 'Recommended',
      value: String(recommended),
      unit: recommended === 1 ? 'set' : 'sets',
      note: recommended === 0 ? 'No completed run yet' : 'Ready for an access request',
      tone: 'neutral',
    },
    {
      key: 'sod',
      label: 'SoD flags',
      value: String(flagged.length),
      unit: 'open',
      note:
        flagged.length === 0
          ? 'No conflict reported'
          : flagged.map((entry) => entry.employeeId).join(', '),
      tone: flagged.length > 0 ? 'red' : 'neutral',
    },
    {
      key: 'affinity',
      label: 'Median affinity',
      value: affinity === null ? UNKNOWN : String(affinity),
      unit: affinity === null ? '' : '%',
      note:
        affinity === null
          ? 'Populated once a run reports peer affinity'
          : 'Across every recommended entitlement on this queue',
      tone: 'neutral',
    },
  ];
}

/* ------------------------------------------------------------- internals --- */

function describeStatus(
  entry: QueueEntry,
  outcome: RecommendationOutcome | undefined,
  isRunning: boolean,
  peers: number | null,
): { label: string; tone: Tone } {
  if (isRunning) return { label: 'Running', tone: 'blue' };

  if (outcome === undefined) {
    return {
      label: entry.lastRunAt === null ? 'Ready to run' : 'Result expired',
      tone: 'blue',
    };
  }

  if (outcome.kind === 'refusal') {
    const tone: Tone = outcome.view.code === 'EMPLOYEE_NOT_FOUND' ? 'red' : 'amber';
    return { label: titleCaseCode(outcome.view.code), tone };
  }

  if (outcome.kind === 'unparseable') {
    return { label: 'Malformed reply', tone: 'amber' };
  }

  if (outcome.view.sod.conflictsFound) return { label: 'SoD review', tone: 'red' };
  if (outcome.view.incompleteNote !== null) return { label: 'Incomplete data', tone: 'amber' };
  if (peers !== null && peers > 0 && peers < 3) return { label: 'Thin peer group', tone: 'amber' };
  if (outcome.view.recommended.length === 0) return { label: 'Nothing recommended', tone: 'amber' };

  return { label: 'Recommended', tone: 'green' };
}

function nameFor(outcome: RecommendationOutcome | undefined, employeeId: string): string {
  return outcome?.kind === 'recommendation' ? outcome.view.employee.name : employeeId;
}

function roleFor(outcome: RecommendationOutcome | undefined): string {
  if (outcome?.kind !== 'recommendation') return 'Not yet resolved';
  return outcome.view.employee.headline;
}

function startFor(outcome: RecommendationOutcome | undefined): string {
  if (outcome?.kind !== 'recommendation') return UNKNOWN;
  const startField = outcome.view.employee.fields.find((field) => field.label === 'Start date');
  const value = startField?.value ?? UNKNOWN;
  if (value === UNKNOWN) return UNKNOWN;
  // The profile field is already `1 Sep 2026`; the table wants `1 Sep`.
  return value.split(' ').slice(0, 2).join(' ');
}

/**
 * The peer group size, read out of a `peerCount` such as `"4/5"`.
 *
 * The denominator is the group; the largest denominator across the recommended
 * set is the group the peer affinity agent actually resolved.
 */
function peerGroupSize(outcome: RecommendationOutcome | undefined): number | null {
  if (outcome?.kind !== 'recommendation') return null;

  const labels = [
    ...outcome.view.recommended.map((item) => item.peerCountLabel),
    ...outcome.view.optional.map((item) => item.affinityLabel),
  ];

  const denominators = labels
    .map((label) => /(\d+)\s*\/\s*(\d+)/.exec(label)?.[2])
    .filter((value): value is string => value !== undefined)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0);

  return denominators.length > 0 ? Math.max(...denominators) : null;
}

function medianAffinity(outcomes: readonly (RecommendationOutcome | undefined)[]): number | null {
  const percentages = outcomes
    .flatMap((outcome) => (outcome?.kind === 'recommendation' ? outcome.view.recommended : []))
    .map((entitlement) => entitlement.affinityPercent)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  if (percentages.length === 0) return null;

  const middle = Math.floor(percentages.length / 2);
  if (percentages.length % 2 === 1) return percentages[middle] ?? null;

  const lower = percentages[middle - 1];
  const upper = percentages[middle];
  if (lower === undefined || upper === undefined) return null;
  return Math.round((lower + upper) / 2);
}

function titleCaseCode(code: string): string {
  const spaced = code.replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Sort by start date when both rows have one; unresolved rows sink to the end. */
function byStartDateThenId(a: QueueRowVM, b: QueueRowVM): number {
  const aHas = a.startLabel !== UNKNOWN;
  const bHas = b.startLabel !== UNKNOWN;
  if (aHas !== bHas) return aHas ? -1 : 1;
  if (aHas && bHas) {
    const compared = parseShortDate(a.startLabel) - parseShortDate(b.startLabel);
    if (compared !== 0) return compared;
  }
  return a.employeeId.localeCompare(b.employeeId);
}

/** Order `1 Sep` against `8 Sep` without needing the year back. */
function parseShortDate(label: string): number {
  const parsed = Date.parse(`${label} 2000`);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

export { formatShortDate };
