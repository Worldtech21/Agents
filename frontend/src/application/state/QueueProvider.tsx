/**
 * The provisioning queue.
 *
 * The service has no route that lists new joiners: the supervisor answers about
 * one employee id at a time and refuses a request that names none
 * (`MISSING_EMPLOYEE_ID`, app/agents/prompts.py). So the queue is the set of
 * ids this operator has asked about, held locally and persisted across
 * reloads. Every column beside the id comes from a real run — see
 * bff/mappers/queue.mapper.ts.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { QueueEntry } from '@bff/mappers/queue.mapper';

const STORAGE_KEY = 'access-advisor.queue';

interface QueueContextValue {
  readonly entries: readonly QueueEntry[];
  readonly employeeIds: readonly string[];
  readonly add: (employeeId: string) => void;
  readonly remove: (employeeId: string) => void;
  readonly markRun: (employeeId: string) => void;
  readonly clear: () => void;
}

const QueueContext = createContext<QueueContextValue | null>(null);

function readStored(): QueueEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
      .map((entry) => ({
        employeeId: typeof entry.employeeId === 'string' ? entry.employeeId : '',
        addedAt: typeof entry.addedAt === 'number' ? entry.addedAt : Date.now(),
        lastRunAt: typeof entry.lastRunAt === 'number' ? entry.lastRunAt : null,
      }))
      .filter((entry) => entry.employeeId.length > 0);
  } catch {
    return [];
  }
}

export function QueueProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<readonly QueueEntry[]>(readStored);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Not persistable in this context; the queue still works for the session.
    }
  }, [entries]);

  const add = useCallback((rawId: string) => {
    const employeeId = rawId.trim().toUpperCase();
    if (!employeeId) return;
    setEntries((previous) =>
      previous.some((entry) => entry.employeeId === employeeId)
        ? previous
        : [...previous, { employeeId, addedAt: Date.now(), lastRunAt: null }],
    );
  }, []);

  const remove = useCallback((employeeId: string) => {
    setEntries((previous) => previous.filter((entry) => entry.employeeId !== employeeId));
  }, []);

  const markRun = useCallback((employeeId: string) => {
    setEntries((previous) =>
      previous.map((entry) =>
        entry.employeeId === employeeId ? { ...entry, lastRunAt: Date.now() } : entry,
      ),
    );
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  const employeeIds = useMemo(() => entries.map((entry) => entry.employeeId), [entries]);

  const value = useMemo<QueueContextValue>(
    () => ({ entries, employeeIds, add, remove, markRun, clear }),
    [entries, employeeIds, add, remove, markRun, clear],
  );

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}

export function useQueue(): QueueContextValue {
  const context = useContext(QueueContext);
  if (!context) throw new Error('useQueue must be used inside a QueueProvider.');
  return context;
}
