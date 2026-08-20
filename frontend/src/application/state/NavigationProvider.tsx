/**
 * Which screen is showing, and which joiner the report screen is about.
 *
 * Deliberately not a router: the design is a three-view console with no
 * addressable sub-pages, and the employee id is already carried in the query
 * cache. State plus a hash so a reload lands where the operator left off.
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

import type { ViewKey } from '@bff/viewmodels';

interface NavigationContextValue {
  readonly view: ViewKey;
  readonly selectedEmployeeId: string | null;
  readonly goTo: (view: ViewKey) => void;
  readonly openReport: (employeeId: string) => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

const VIEWS: readonly ViewKey[] = ['queue', 'report', 'chat'];

function readHash(): { view: ViewKey; employeeId: string | null } {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [view, employeeId] = raw.split('/');
  return {
    view: VIEWS.includes(view as ViewKey) ? (view as ViewKey) : 'queue',
    employeeId: employeeId ? decodeURIComponent(employeeId) : null,
  };
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(readHash, []);
  const [view, setView] = useState<ViewKey>(initial.view);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(initial.employeeId);

  useEffect(() => {
    const next =
      view === 'report' && selectedEmployeeId
        ? `#/report/${encodeURIComponent(selectedEmployeeId)}`
        : `#/${view}`;
    if (window.location.hash !== next) {
      window.history.replaceState(null, '', next);
    }
  }, [view, selectedEmployeeId]);

  useEffect(() => {
    const onHashChange = () => {
      const parsed = readHash();
      setView(parsed.view);
      if (parsed.employeeId) setSelectedEmployeeId(parsed.employeeId);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const goTo = useCallback((next: ViewKey) => setView(next), []);

  const openReport = useCallback((employeeId: string) => {
    setSelectedEmployeeId(employeeId);
    setView('report');
  }, []);

  const value = useMemo<NavigationContextValue>(
    () => ({ view, selectedEmployeeId, goTo, openReport }),
    [view, selectedEmployeeId, goTo, openReport],
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): NavigationContextValue {
  const context = useContext(NavigationContext);
  if (!context) throw new Error('useNavigation must be used inside a NavigationProvider.');
  return context;
}
