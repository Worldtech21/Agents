/**
 * Who you are acting as.
 *
 * This prototype has no login, so the switcher is not a convenience — it is the
 * identity mechanism. It sits at the top of the sidebar because everything
 * below it (which sections exist, whose inbox is shown, which actor id is sent)
 * follows from the choice made here.
 *
 * A collapsed card that expands to the list, rather than a native `<select>`,
 * because each option carries a role and a pending-approvals count.
 */

import { useEffect, useRef, useState } from 'react';

import type { PersonaVM } from '@bff/viewmodels';
import { Icon } from '@presentation/atoms/Icon';
import { Skeleton } from '@presentation/atoms/Skeleton';
import styles from '@presentation/organisms/organisms.module.css';

export interface PersonaSwitcherProps {
  readonly personas: readonly PersonaVM[];
  readonly actor: PersonaVM | null;
  readonly isLoading: boolean;
  readonly onSelect: (actorId: string) => void;
}

export function PersonaSwitcher({
  personas,
  actor,
  isLoading,
  onSelect,
}: PersonaSwitcherProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Dismiss on an outside click or Escape, as any menu should.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (isLoading) {
    return (
      <div className={styles.persona}>
        <span className={styles.personaCaption}>Acting as</span>
        <Skeleton width="100%" height="46px" />
      </div>
    );
  }

  if (!actor) {
    return (
      <div className={styles.persona}>
        <span className={styles.personaCaption}>Acting as</span>
        <p className={styles.personaEmpty}>
          No personas available — the service could not be reached.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.persona} ref={containerRef}>
      <span className={styles.personaCaption} id="persona-caption">
        Acting as
      </span>

      <button
        type="button"
        className={styles.personaTrigger}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby="persona-caption"
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className={styles.personaAvatar} aria-hidden="true">
          {actor.initials}
        </span>
        <span className={styles.personaIdentity}>
          <span className={styles.personaName}>{actor.name}</span>
          <span className={styles.personaRole}>{actor.roleLabel}</span>
        </span>
        {actor.pendingApprovals > 0 ? (
          <span className={styles.personaBadge} title={actor.pendingLabel}>
            {actor.pendingApprovals}
          </span>
        ) : null}
        <Icon name="user" size={14} />
      </button>

      {open ? (
        <ul className={styles.personaList} role="listbox" aria-label="Choose a persona">
          {personas.map((persona) => (
            <li key={persona.actorId}>
              <button
                type="button"
                role="option"
                aria-selected={persona.actorId === actor.actorId}
                className={[
                  styles.personaOption,
                  persona.actorId === actor.actorId ? styles.personaOptionActive : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  onSelect(persona.actorId);
                  setOpen(false);
                }}
              >
                <span className={styles.personaAvatar} aria-hidden="true">
                  {persona.initials}
                </span>
                <span className={styles.personaIdentity}>
                  <span className={styles.personaName}>{persona.name}</span>
                  <span className={styles.personaRole}>{persona.roleLabel}</span>
                </span>
                {persona.pendingApprovals > 0 ? (
                  <span className={styles.personaBadge} title={persona.pendingLabel}>
                    {persona.pendingApprovals}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
