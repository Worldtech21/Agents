"""The access request lifecycle: raise it, route it, decide it, apply it.

This service is where the two modes converge.  HR onboarding a joiner and an
employee asking for themselves differ only in who the requester is and who the
subject is; from the moment a request exists, the path is identical.

The order of writes matters and is deliberate.  Access is applied *first*, and
only then is the request stamped as granted.  A failure between those two steps
leaves a request marked ``PROVISIONING_FAILED`` with the error on it — visible
and recoverable — rather than a request claiming success for access that was
never handed out.  The two writes land in different services, so there is no
transaction to lean on and the ordering is the only safeguard.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.core.config import Settings
from app.core.exceptions import (
    MCPConnectionError,
    MCPToolError,
    NotApproverError,
    RecordNotFoundError,
    WorkflowError,
)
from app.core.logging import get_logger
from app.domain.models import (
    AccessRequest,
    DecisionVerdict,
    RequesterType,
    RequestStatus,
    Subject,
)
from app.domain.ports import ToolProvider
from app.services.decision_service import DecisionService
from app.services.directory_service import DirectoryService
from app.services.provisioning_service import ProvisioningService

logger = get_logger(__name__)

REQUESTS_MCP = "requests_mcp"

#: Statuses that mean the request is finished and must not be decided again.
TERMINAL = frozenset(
    {
        RequestStatus.AUTO_GRANTED,
        RequestStatus.GRANTED,
        RequestStatus.REJECTED,
    }
)


class RequestService:
    """Use cases for raising, listing and deciding access requests."""

    def __init__(
        self,
        *,
        settings: Settings,
        tools: ToolProvider,
        directory: DirectoryService,
        decisions: DecisionService,
        provisioning: ProvisioningService,
    ) -> None:
        self._settings = settings
        self._tools = tools
        self._directory = directory
        self._decisions = decisions
        self._provisioning = provisioning

    # ------------------------------------------------------------- analysing
    async def analyze(
        self,
        subject_id: str,
        *,
        entitlement_id: str | None = None,
        entitlement_name: str | None = None,
    ) -> tuple[Subject, DecisionVerdict, str]:
        """Evaluate without writing anything. Returns (subject, verdict, approver)."""
        subject = await self._directory.get_subject(subject_id)
        verdict = await self._decisions.evaluate(
            subject, entitlement_id=entitlement_id, entitlement_name=entitlement_name
        )
        approver = (
            await self._directory.resolve_approver(subject)
            if verdict.approval_required
            else ""
        )
        return subject, verdict, approver

    # --------------------------------------------------------------- raising
    async def raise_requests(
        self,
        *,
        requester_id: str,
        requester_type: RequesterType,
        subject_id: str,
        entitlements: list[dict[str, str | None]],
        justification: str = "",
    ) -> list[AccessRequest]:
        """Raise one request per entitlement, auto-granting what policy permits.

        Taking a list rather than a single entitlement is what lets HR submit a
        whole accepted recommendation in one call.  Each entitlement is judged on
        its own — one needing approval does not hold up the rest.
        """
        if not entitlements:
            raise WorkflowError("No entitlements were named in the request.")

        subject = await self._directory.get_subject(subject_id)
        raised: list[AccessRequest] = []

        for item in entitlements:
            verdict = await self._decisions.evaluate(
                subject,
                entitlement_id=item.get("entitlement_id"),
                entitlement_name=item.get("entitlement_name"),
            )
            raised.append(
                await self._raise_one(
                    subject=subject,
                    verdict=verdict,
                    requester_id=requester_id,
                    requester_type=requester_type,
                    justification=item.get("justification") or justification or "",
                )
            )
        return raised

    async def _raise_one(
        self,
        *,
        subject: Subject,
        verdict: DecisionVerdict,
        requester_id: str,
        requester_type: RequesterType,
        justification: str,
    ) -> AccessRequest:
        if verdict.already_held:
            raise WorkflowError(
                f"{subject.employee_id} already holds {verdict.entitlement_name}.",
                details={
                    "subject_id": subject.employee_id,
                    "entitlement_name": verdict.entitlement_name,
                },
            )

        approver = ""
        if verdict.approval_required:
            approver = await self._directory.resolve_approver(subject)
            status = (
                RequestStatus.PENDING_APPROVAL
                if approver
                else RequestStatus.BLOCKED_NO_APPROVER
            )
        else:
            status = RequestStatus.AUTO_GRANTED

        record = await self._create(
            requester_id=requester_id,
            requester_type=requester_type,
            subject=subject,
            verdict=verdict,
            approver_id=approver,
            status=status,
            justification=justification,
        )

        if status is not RequestStatus.AUTO_GRANTED:
            return record

        # No approval needed, so the access is applied in the same breath as the
        # request being raised — that is what "granted then and there" means.
        return await self._apply(record, subject=subject)

    # -------------------------------------------------------------- deciding
    async def approve(
        self, request_id: str, *, approver_id: str, note: str = ""
    ) -> AccessRequest:
        """Approve, then provision. The approval stands even if provisioning fails."""
        await self._decidable(request_id, approver_id)
        decided = await self._update(
            request_id,
            status=RequestStatus.APPROVED,
            decision_note=note,
            decided_at=_now(),
        )
        subject = await self._directory.get_subject(decided.subject_id)
        return await self._apply(decided, subject=subject)

    async def reject(
        self, request_id: str, *, approver_id: str, note: str = ""
    ) -> AccessRequest:
        """Reject. The note is the refusal the requester reads back."""
        await self._decidable(request_id, approver_id)
        return await self._update(
            request_id,
            status=RequestStatus.REJECTED,
            decision_note=note,
            decided_at=_now(),
        )

    async def _decidable(self, request_id: str, approver_id: str) -> AccessRequest:
        """Load a request and check this actor is entitled to decide it.

        There is no login, but that is a reason to check the approver explicitly
        rather than a reason to skip it: without this, any persona could approve
        anything, which is precisely the control being demonstrated.
        """
        record = await self.get(request_id)
        if record.status in TERMINAL:
            raise WorkflowError(
                f"Request {request_id} is already {record.status.value.lower()}.",
                details={"request_id": request_id, "status": record.status.value},
            )
        if not record.approver_id:
            raise WorkflowError(
                f"Request {request_id} has no approver on record.",
                details={"request_id": request_id},
            )
        if record.approver_id.upper() != approver_id.strip().upper():
            raise NotApproverError(
                f"{approver_id} is not the approver for request {request_id}.",
                details={"request_id": request_id, "approver_id": record.approver_id},
            )
        return record

    # ------------------------------------------------------------ provisioning
    async def _apply(self, record: AccessRequest, *, subject: Subject) -> AccessRequest:
        """Hand out the access, then record that it landed.

        A provisioning failure is caught and written onto the request rather than
        raised: the decision genuinely happened, and losing that fact because the
        downstream write failed would be worse than reporting a failed grant.
        """
        try:
            result = await self._provisioning.grant(subject, record.entitlement_name)
        except Exception as exc:  # noqa: BLE001 - recorded on the request instead
            logger.exception("Provisioning failed for request %s", record.request_id)
            return await self._update(
                record.request_id,
                status=RequestStatus.PROVISIONING_FAILED,
                decision_note=f"{record.decision_note}\nProvisioning failed: {exc}".strip(),
            )

        if result.skipped_reason:
            return await self._update(
                record.request_id,
                status=record.status,
                decision_note=f"{record.decision_note}\n{result.skipped_reason}".strip(),
            )

        granted_status = (
            RequestStatus.AUTO_GRANTED
            if record.status is RequestStatus.AUTO_GRANTED
            else RequestStatus.GRANTED
        )
        return await self._update(
            record.request_id, status=granted_status, granted_at=_now()
        )

    # -------------------------------------------------------------- retrieval
    async def get(self, request_id: str) -> AccessRequest:
        record = await self._tools.call_tool(
            REQUESTS_MCP, "get_access_request", {"request_id": request_id}
        )
        if not isinstance(record, dict) or not record.get("request_id"):
            raise RecordNotFoundError(
                f"No access request with id {request_id}.",
                details={"request_id": request_id},
            )
        return AccessRequest.from_record(record)

    async def list_requests(
        self,
        *,
        requester_id: str | None = None,
        approver_id: str | None = None,
        subject_id: str | None = None,
        status: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[AccessRequest]:
        """One listing serving both inboxes.

        Filtered by ``approver_id`` it is a manager's queue; filtered by
        ``requester_id`` it is the requester's own history, which is where an
        approval or a refusal is read back.
        """
        records = await self._tools.call_tool(
            REQUESTS_MCP,
            "list_access_requests",
            {
                "requester_id": requester_id,
                "approver_id": approver_id,
                "subject_id": subject_id,
                "status": status,
                "limit": limit,
                "offset": offset,
            },
        )
        rows = records if isinstance(records, list) else []
        return [AccessRequest.from_record(r) for r in rows if isinstance(r, dict)]

    async def count_pending_for(self, approver_id: str) -> int:
        """How many requests are waiting on one approver — the inbox badge.

        Reports 0 when the tracker cannot be reached rather than propagating.
        This count is decoration on the persona list, and the persona list is
        how the client knows who it may act as: failing that for a missing badge
        would take down the whole actor switcher, which is the same reasoning
        behind ``MCP_REQUIRED=false`` elsewhere.
        """
        try:
            pending = await self.list_requests(
                approver_id=approver_id,
                status=RequestStatus.PENDING_APPROVAL.value,
                limit=200,
            )
        except (MCPConnectionError, MCPToolError) as exc:
            logger.warning(
                "Could not count pending approvals for %s: %s", approver_id, exc
            )
            return 0
        return len(pending)

    # -------------------------------------------------------------- internals
    async def _create(
        self,
        *,
        requester_id: str,
        requester_type: RequesterType,
        subject: Subject,
        verdict: DecisionVerdict,
        approver_id: str,
        status: RequestStatus,
        justification: str,
    ) -> AccessRequest:
        payload: dict[str, Any] = {
            "requester_id": requester_id,
            "requester_type": requester_type.value,
            "subject_id": subject.employee_id,
            "subject_type": subject.subject_type.value,
            "entitlement_id": verdict.entitlement_id,
            "entitlement_name": verdict.entitlement_name,
            "application": verdict.application,
            "risk_score": verdict.risk_score,
            "risk_category": verdict.risk_category,
            "approval_required": verdict.approval_required,
            "policy_basis": verdict.policy_basis,
            "sod_conflicts": verdict.rendered_conflicts,
            "approver_id": approver_id,
            "status": status.value,
            "justification": justification,
        }
        record = await self._tools.call_tool(
            REQUESTS_MCP, "create_access_request", payload
        )
        if not isinstance(record, dict) or not record.get("request_id"):
            raise WorkflowError(
                "The request tracker did not return a created request.",
                details={"response": record},
            )
        return AccessRequest.from_record(record)

    async def _update(self, request_id: str, **fields: Any) -> AccessRequest:
        payload: dict[str, Any] = {"request_id": request_id}
        for key, value in fields.items():
            payload[key] = value.value if isinstance(value, RequestStatus) else value
        record = await self._tools.call_tool(
            REQUESTS_MCP, "update_access_request", payload
        )
        if not isinstance(record, dict) or not record.get("request_id"):
            raise WorkflowError(
                f"The request tracker did not return request {request_id} after an "
                "update.",
                details={"request_id": request_id, "response": record},
            )
        return AccessRequest.from_record(record)


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")
