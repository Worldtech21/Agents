"""Granting access — the only place in the application that writes entitlements.

Two things make this narrow on purpose.  It is reachable from exactly one caller
(``RequestService``, after a verdict or an approval), and it is invisible to the
agents: no worker's prompt mentions it and no MCP write tool is bound to any
``AgentSpec``.  A model can describe a grant; only this module performs one.

``update_identity`` replaces the whole entitlement set rather than appending to
it, so every write here sends the complete list.  Getting that wrong would
silently revoke everything the person already had.
"""

from __future__ import annotations

from typing import Any

from app.core.config import Settings
from app.core.exceptions import RecordNotFoundError
from app.core.logging import get_logger
from app.domain.models import GrantResult, Subject, SubjectType
from app.domain.ports import ToolProvider
from app.services.directory_service import (
    DirectoryService,
    join_entitlements,
    split_entitlements,
)

logger = get_logger(__name__)

IDENTITIES_MCP = "identities_mcp"


class ProvisioningService:
    """Applies a granted entitlement to a person's identity record."""

    def __init__(
        self,
        *,
        settings: Settings,
        tools: ToolProvider,
        directory: DirectoryService,
    ) -> None:
        self._settings = settings
        self._tools = tools
        self._directory = directory

    async def grant(self, subject: Subject, entitlement_name: str) -> GrantResult:
        """Add *entitlement_name* to *subject*'s identity, creating it if needed."""
        if not self._settings.provisioning_enabled:
            logger.info(
                "PROVISIONING_ENABLED is false — not granting %s to %s",
                entitlement_name,
                subject.employee_id,
            )
            return GrantResult(
                granted=False,
                already_held=False,
                identity_created=False,
                entitlements=subject.entitlements,
                skipped_reason="Provisioning is disabled (PROVISIONING_ENABLED=false)",
            )

        identity, created = await self._ensure_identity(subject)
        current = split_entitlements(identity.get("entitlements"))

        if entitlement_name in current:
            return GrantResult(
                granted=False,
                already_held=True,
                identity_created=created,
                entitlements=current,
            )

        updated = tuple(sorted({*current, entitlement_name}))
        await self._tools.call_tool(
            IDENTITIES_MCP,
            "update_identity",
            {
                "employee_id": subject.employee_id,
                # The whole set, every time — this field is replaced, not merged.
                "entitlements": join_entitlements(updated),
            },
        )
        logger.info(
            "Granted %s to %s (now holds %d entitlement(s))",
            entitlement_name,
            subject.employee_id,
            len(updated),
        )
        return GrantResult(
            granted=True,
            already_held=False,
            identity_created=created,
            entitlements=updated,
        )

    async def _ensure_identity(
        self, subject: Subject
    ) -> tuple[dict[str, Any], bool]:
        """Return the identity row, creating one for a joiner who has none.

        New joiners live only in the joiner dataset until something is granted to
        them.  Without this, an HR-mode grant would have nowhere to land.
        """
        if identity := await self._directory.get_identity(subject.employee_id):
            return identity, False

        if subject.subject_type is not SubjectType.NEW_JOINER:
            raise RecordNotFoundError(
                f"{subject.employee_id} has no identity record to grant against.",
                details={"employee_id": subject.employee_id},
            )

        logger.info(
            "Creating identity for new joiner %s on first grant", subject.employee_id
        )
        await self._tools.call_tool(
            IDENTITIES_MCP,
            "create_identity",
            {
                "employee_id": subject.employee_id,
                "name": subject.name,
                "department": subject.department,
                "job_role": subject.job_role,
                "job_level": subject.job_level,
                "location": subject.location,
                "entitlements": "",
            },
        )
        created = await self._directory.get_identity(subject.employee_id)
        if created is None:
            raise RecordNotFoundError(
                f"Created an identity for {subject.employee_id} but could not read "
                "it back.",
                details={"employee_id": subject.employee_id},
            )
        return created, True
