/**
 * Who is acting.
 *
 * This prototype has no authentication, so the persona is the whole of
 * identity: it decides which navigation exists, whose approval inbox is shown,
 * and which `actor_id` every write endpoint is called with. The backend serves
 * the closed set of actors at `/personas` and validates the one it is given, so
 * this provider chooses among them — it never invents one.
 *
 * The choice is persisted like the theme and the queue, because reloading the
 * page mid-demo should not silently put you back in HR's shoes.
 */

import { useQuery } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { queryKeys } from '@application/queryClient';
import { findPersona, toPersonas } from '@bff/mappers/personas.mapper';
import type { ActorMode, PersonaVM } from '@bff/viewmodels';
import { ApiError } from '@infrastructure/api/client';
import { fetchPersonas } from '@infrastructure/api/endpoints';

const STORAGE_KEY = 'access-advisor.persona';

interface PersonaContextValue {
  readonly personas: readonly PersonaVM[];
  /** Null until `/personas` answers, or when it could not be reached. */
  readonly actor: PersonaVM | null;
  /** HR until an employee is chosen — the mode the product already had. */
  readonly mode: ActorMode;
  readonly isLoading: boolean;
  readonly error: ApiError | null;
  readonly setActor: (actorId: string) => void;
  readonly refetch: () => void;
}

const PersonaContext = createContext<PersonaContextValue | null>(null);

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function PersonaProvider({ children }: { children: ReactNode }) {
  const [actorId, setActorId] = useState<string | null>(readStored);

  const query = useQuery({
    queryKey: queryKeys.personas(),
    queryFn: ({ signal }) => fetchPersonas(signal),
    // Short, because the approvals badge on this list has to move once a
    // decision is made elsewhere in the app.
    staleTime: 10_000,
  });

  const personas = useMemo(() => toPersonas(query.data ?? []), [query.data]);

  /**
   * Resolve the stored id against what the backend actually serves, falling
   * back to the first persona. A `DEMO_EMPLOYEE_IDS` change would otherwise
   * strand the app on a persona that no longer exists.
   */
  const actor = useMemo(
    () => findPersona(personas, actorId) ?? personas[0] ?? null,
    [personas, actorId],
  );

  useEffect(() => {
    if (!actor) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, actor.actorId);
    } catch {
      // Not persistable here; the choice still holds for this session.
    }
  }, [actor]);

  const setActor = useCallback((next: string) => setActorId(next.trim().toUpperCase()), []);

  const value = useMemo<PersonaContextValue>(
    () => ({
      personas,
      actor,
      mode: actor?.mode ?? 'hr',
      isLoading: query.isLoading,
      error: query.error instanceof ApiError ? query.error : null,
      setActor,
      refetch: () => void query.refetch(),
    }),
    [personas, actor, query, setActor],
  );

  return <PersonaContext.Provider value={value}>{children}</PersonaContext.Provider>;
}

export function usePersona(): PersonaContextValue {
  const value = useContext(PersonaContext);
  if (value === null) {
    throw new Error('usePersona must be used inside a PersonaProvider.');
  }
  return value;
}
