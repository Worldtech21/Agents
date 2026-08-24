"""The actor list that stands in for a login.

This is a prototype with no authentication.  Rather than pretend otherwise, the
client states which persona it is acting as and this service defines the closed
set it may choose from — the two demo employees named by ``DEMO_EMPLOYEE_IDS``,
plus the single HR persona.

HR is deliberately not an identity record: HR acts on other people's behalf and
never receives access itself, so it has no entitlements and no manager.
"""

from __future__ import annotations

from app.core.config import Settings
from app.core.exceptions import RecordNotFoundError
from app.core.logging import get_logger
from app.domain.models import Persona
from app.services.directory_service import DirectoryService
from app.services.request_service import RequestService

logger = get_logger(__name__)


class PersonaService:
    """Lists the actors the client may act as, and validates the one it names."""

    def __init__(
        self,
        *,
        settings: Settings,
        directory: DirectoryService,
        requests: RequestService,
    ) -> None:
        self._settings = settings
        self._directory = directory
        self._requests = requests

    async def list_personas(self) -> list[Persona]:
        """The HR persona followed by each configured employee, hydrated.

        An employee id that resolves to no record is skipped with a warning
        rather than failing the whole list — a misconfigured demo id should not
        take the mode switcher down.
        """
        personas = [
            Persona(
                actor_id=self._settings.demo_hr_actor_id,
                name=self._settings.demo_hr_actor_name,
                mode="hr",
            )
        ]

        for employee_id in self._settings.demo_employee_ids:
            try:
                subject = await self._directory.get_subject(employee_id)
            except RecordNotFoundError:
                logger.warning(
                    "DEMO_EMPLOYEE_IDS names %s, which matches no record — skipping",
                    employee_id,
                )
                continue
            personas.append(
                Persona(
                    actor_id=subject.employee_id,
                    name=subject.name,
                    mode="employee",
                    department=subject.department,
                    job_role=subject.job_role,
                    manager_id=await self._directory.resolve_approver(subject),
                    pending_approvals=await self._requests.count_pending_for(
                        subject.employee_id
                    ),
                )
            )
        return personas

    def is_known_actor(self, actor_id: str) -> bool:
        """Whether *actor_id* is one of the personas we serve."""
        candidate = actor_id.strip().upper()
        known = {self._settings.demo_hr_actor_id.upper()} | {
            e.strip().upper() for e in self._settings.demo_employee_ids
        }
        return candidate in known

    def require_known_actor(self, actor_id: str) -> str:
        """Normalise and validate an actor id, or explain what is allowed.

        Without a login the actor is client-supplied, so this is the only thing
        standing between the demo and one persona acting as another.
        """
        candidate = actor_id.strip().upper()
        if not self.is_known_actor(candidate):
            allowed = [self._settings.demo_hr_actor_id, *self._settings.demo_employee_ids]
            raise RecordNotFoundError(
                f"'{actor_id}' is not a persona this service serves.",
                details={"allowed": allowed},
            )
        return candidate
