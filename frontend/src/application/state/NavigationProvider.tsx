/**
 * Which screen is showing, and which joiner the report screen is about.
 *
 * Deliberately not a router: the design is a small console with no addressable
 * sub-pages, and the employee id is already carried in the query cache. State
 * plus a hash so a reload lands where the operator left off.
 *
 * The set of reachable views depends on who is acting — HR and an employee see
 * different sections — so this provider takes the acting mode and confines
 * navigation to it. A view that does not belong to the current mode is not an
 * error state to render; it is corrected to that mode's home.
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

import { usePersona } from '@application/state/PersonaProvider';
import { VIEWS_BY_MODE, type ActorMode, type ViewKey } from '@bff/viewmodels';

interface NavigationContextValue {
  readonly view: ViewKey;
  readonly selectedEmployeeId: string | null;
  readonly goTo: (view: ViewKey) => void;
  readonly openReport: (employeeId: string) => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

const ALL_VIEWS: readonly ViewKey[] = [...VIEWS_BY_MODE.hr, ...VIEWS_BY_MODE.employee];

/** Each mode's home — where an out-of-mode view is corrected to. */
function homeFor(mode: ActorMode): ViewKey {
  return VIEWS_BY_MODE[mode][0] ?? 'queue';
}

function isInMode(view: ViewKey, mode: ActorMode): boolean {
  return VIEWS_BY_MODE[mode].includes(view);
}

function readHash(): { view: ViewKey | null; employeeId: string | null } {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [view, employeeId] = raw.split('/');
  return {
    view: ALL_VIEWS.includes(view as ViewKey) ? (view as ViewKey) : null,
    employeeId: employeeId ? decodeURIComponent(employeeId) : null,
  };
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const { mode, actor } = usePersona();
  const initial = useMemo(readHash, []);
  const [view, setView] = useState<ViewKey>(initial.view ?? homeFor(mode));
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(initial.employeeId);

  /**
   * Keep the view inside the acting mode.
   *
   * Gated on the persona having resolved. `mode` defaults to `hr` while
   * `/personas` is in flight, and correcting against that default would throw
   * away a restored `#/approvals` a moment before the real mode arrives.
   */
  useEffect(() => {
    if (!actor) return;
    if (!isInMode(view, mode)) setView(homeFor(mode));
  }, [actor, mode, view]);

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
      // An unrecognised hash leaves the view alone; the effect above is what
      // corrects a view that is real but belongs to the other mode.
      if (parsed.view) setView(parsed.view);
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
