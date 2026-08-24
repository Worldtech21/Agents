/**
 * `/personas` -> the switcher at the top of the sidebar.
 *
 * There is no login in this prototype, so the persona is the whole of identity:
 * it decides which navigation exists, whose inbox is shown, and which actor id
 * every write endpoint is called with. That makes this mapper small but load
 * bearing — nothing here invents a persona the backend did not serve.
 */

import type { ActorMode, PersonaVM } from '@bff/viewmodels';
import type { PersonaDTO } from '@infrastructure/types/api';

export function toPersonas(dtos: readonly PersonaDTO[]): PersonaVM[] {
  return dtos.map(toPersona);
}

export function toPersona(dto: PersonaDTO): PersonaVM {
  const mode = toMode(dto.mode);
  return {
    actorId: dto.actor_id,
    name: dto.name || dto.actor_id,
    initials: toInitials(dto.name || dto.actor_id),
    mode,
    roleLabel: toRoleLabel(dto, mode),
    managerId: dto.manager_id,
    pendingApprovals: dto.pending_approvals,
    pendingLabel: toPendingLabel(dto.pending_approvals),
  } satisfies PersonaVM;
}

/** Find one persona by id, or null. The caller decides what a miss means. */
export function findPersona(
  personas: readonly PersonaVM[],
  actorId: string | null,
): PersonaVM | null {
  if (!actorId) return null;
  const wanted = actorId.trim().toUpperCase();
  return personas.find((persona) => persona.actorId.toUpperCase() === wanted) ?? null;
}

/**
 * Anything the backend does not call `hr` is treated as an employee.
 *
 * Employee is the safer default of the two: it reaches self-service and an
 * approval inbox, where HR reaches the onboarding tools for other people.
 */
function toMode(raw: string): ActorMode {
  return raw.trim().toLowerCase() === 'hr' ? 'hr' : 'employee';
}

function toRoleLabel(dto: PersonaDTO, mode: ActorMode): string {
  if (mode === 'hr') return 'HR operations';
  const role = [dto.job_role, dto.department].filter(Boolean).join(' · ');
  return role ? `Employee · ${role}` : 'Employee';
}

function toPendingLabel(count: number): string {
  if (count <= 0) return 'No approvals waiting';
  return count === 1 ? '1 approval waiting' : `${count} approvals waiting`;
}

/**
 * Up to two initials, for the switcher avatar.
 *
 * The demo identities carry a single name ("Sneha"), so a one-word name has to
 * degrade to one letter rather than producing an empty badge.
 */
function toInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  const last = words[words.length - 1];
  if (!first || !last) return '?';
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}
