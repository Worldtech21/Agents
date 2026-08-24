"""Who someone is, and who approves for them.

The two datasets behind this service do not overlap: identities are ``EMP###``
and new joiners are ``NJ####``, and a joiner has no identity record until their
first grant creates one.  Callers should not have to care which they are holding,
so everything here takes a bare employee id and works it out.
"""

from __future__ import annotations

from typing import Any

from app.core.exceptions import MCPToolError, RecordNotFoundError
from app.core.logging import get_logger
from app.domain.models import Subject, SubjectType
from app.domain.ports import ToolProvider

logger = get_logger(__name__)

IDENTITIES_MCP = "identities_mcp"
NEW_JOINERS_MCP = "new_joiners_mcp"


class DirectoryService:
    """Resolves subjects and approvers across the identity and joiner datasets."""

    def __init__(self, *, tools: ToolProvider) -> None:
        self._tools = tools

    # ------------------------------------------------------------------ lookups
    async def get_subject(self, employee_id: str) -> Subject:
        """Resolve *employee_id* against identities first, then new joiners.

        Identities are tried first because an onboarded joiner exists in *both*
        datasets, and the identity row is the one carrying their entitlements.
        """
        employee_id = employee_id.strip().upper()
        if not employee_id:
            raise RecordNotFoundError("An employee id is required.")

        if record := await self._try_get(IDENTITIES_MCP, "get_identity", employee_id):
            return _identity_to_subject(record)

        if record := await self._try_get(NEW_JOINERS_MCP, "get_new_joiner", employee_id):
            return _joiner_to_subject(record)

        raise RecordNotFoundError(
            f"No identity or new joiner record matches {employee_id}.",
            details={"employee_id": employee_id},
        )

    async def get_identity(self, employee_id: str) -> dict[str, Any] | None:
        """The raw identity row, or None when the person has no identity yet."""
        return await self._try_get(IDENTITIES_MCP, "get_identity", employee_id)

    async def get_new_joiner(self, employee_id: str) -> dict[str, Any] | None:
        """The raw new joiner row, or None."""
        return await self._try_get(NEW_JOINERS_MCP, "get_new_joiner", employee_id)

    async def resolve_approver(self, subject: Subject) -> str:
        """The manager id an approval for *subject* should be routed to.

        Empty string when nobody is on record.  That is a real state — the
        identities data carries blank managers — and the workflow reports it as
        ``BLOCKED_NO_APPROVER`` rather than inventing an approver.
        """
        if subject.manager_id:
            return subject.manager_id

        # An onboarded joiner keeps their reporting line in the joiner row even
        # once an identity exists for them, so fall back to it.
        if subject.subject_type is SubjectType.IDENTITY and (
            joiner := await self.get_new_joiner(subject.employee_id)
        ):
            return str(joiner.get("manager_id") or "")
        return ""

    # -------------------------------------------------------------- internals
    async def _try_get(self, server: str, tool: str, employee_id: str) -> dict[str, Any] | None:
        """One lookup, treating "no such record" as an answer rather than a fault.

        The upstream APIs 404 on an unknown id, which surfaces here as a tool
        error.  Every other failure — server down, bad arguments — propagates.
        """
        try:
            record = await self._tools.call_tool(
                server, tool, {"employee_id": employee_id}
            )
        except MCPToolError as exc:
            if _is_not_found(str(exc)):
                return None
            raise
        return record if isinstance(record, dict) else None


def _is_not_found(message: str) -> bool:
    """Whether a tool error means "no such record" rather than a real failure.

    Sniffing the message is unlovely, but MCP gives us no status code and the
    alternative — treating a missing joiner as an outage — is worse.
    """
    lowered = message.lower()
    return "404" in lowered or "not found" in lowered or "no such" in lowered


def split_entitlements(raw: Any) -> tuple[str, ...]:
    """Parse the ``';'``-separated entitlement string identities store.

    Public because provisioning needs the same encoding when it writes the set
    back; the two must agree or a grant would corrupt what the person holds.
    """
    if not raw:
        return ()
    if isinstance(raw, (list, tuple)):
        return tuple(str(item).strip() for item in raw if str(item).strip())
    return tuple(part.strip() for part in str(raw).split(";") if part.strip())


def join_entitlements(entitlements: tuple[str, ...]) -> str:
    """Render an entitlement set back into the stored string form.

    Sorted so the stored value is stable between grants and a diff shows only
    what actually changed.
    """
    return ";".join(sorted(entitlements))


def _identity_to_subject(record: dict[str, Any]) -> Subject:
    return Subject(
        employee_id=str(record.get("employee_id", "")),
        subject_type=SubjectType.IDENTITY,
        name=str(record.get("name", "")),
        department=str(record.get("department", "")),
        job_role=str(record.get("job_role", "")),
        job_level=str(record.get("job_level", "")),
        location=str(record.get("location", "")),
        # Added to the identities data for employee mode; blank for anyone
        # without a manager, which the schema allows.
        manager_id=str(record.get("manager_id") or ""),
        entitlements=split_entitlements(record.get("entitlements")),
    )


def _joiner_to_subject(record: dict[str, Any]) -> Subject:
    return Subject(
        employee_id=str(record.get("employee_id", "")),
        subject_type=SubjectType.NEW_JOINER,
        name=str(record.get("name", "")),
        department=str(record.get("department", "")),
        job_role=str(record.get("job_role", "")),
        job_level=str(record.get("job_level", "")),
        location=str(record.get("location", "")),
        manager_id=str(record.get("manager_id") or ""),
        # A joiner holds nothing until their identity is created on first grant.
        entitlements=(),
    )
