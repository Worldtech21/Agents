"""Access request endpoints — the workflow surface.

These are the first write endpoints in the service.  Everything they do is
deterministic Python over MCP data; no request here runs the agent graph, so
they answer in milliseconds rather than minutes and cost nothing.
"""

from __future__ import annotations

from fastapi import APIRouter, Path, Query

from app.api.deps import PersonaServiceDep, RequestServiceDep
from app.schemas.requests import (
    REQUEST_STATUSES,
    AccessRequestDTO,
    AnalyzeRequestDTO,
    AnalyzeResponseDTO,
    DecisionDTO,
    RaiseRequestDTO,
    SubjectDTO,
    VerdictDTO,
)

router = APIRouter(prefix="/requests", tags=["requests"])


@router.post(
    "/analyze",
    response_model=AnalyzeResponseDTO,
    summary="Decide whether an entitlement needs approval — writes nothing",
)
async def analyze(
    payload: AnalyzeRequestDTO, service: RequestServiceDep
) -> AnalyzeResponseDTO:
    """Evaluate one entitlement for one person against policy and SoD rules.

    The verdict is derived from the policy rows, not from a model: the
    `HUMAN_APPROVAL` policies are read at call time and their thresholds applied
    to the entitlement's risk score. Editing a policy changes the answer.

    This is also what the conversational bot's proposal is checked against — the
    bot describes what it expects, this endpoint decides.
    """
    subject, verdict, approver = await service.analyze(
        payload.subject_id,
        entitlement_id=payload.entitlement_id,
        entitlement_name=payload.entitlement_name,
    )
    return AnalyzeResponseDTO(
        subject=SubjectDTO.from_domain(subject),
        verdict=VerdictDTO.from_domain(verdict, approver),
    )


@router.post(
    "",
    response_model=list[AccessRequestDTO],
    summary="Raise access requests, granting immediately where policy allows",
)
async def raise_requests(
    payload: RaiseRequestDTO, service: RequestServiceDep, personas: PersonaServiceDep
) -> list[AccessRequestDTO]:
    """Raise one request per entitlement named.

    Each is evaluated on its own. Where no approval is required the access is
    applied in the same call and the request comes back `AUTO_GRANTED`. Where it
    is required the request comes back `PENDING_APPROVAL` addressed to the
    subject's manager — or `BLOCKED_NO_APPROVER` when no manager is on record.

    Taking a list is what lets HR submit a whole accepted recommendation at once.
    """
    requester_id = personas.require_known_actor(payload.requester_id)
    records = await service.raise_requests(
        requester_id=requester_id,
        requester_type=payload.to_domain_type(),
        subject_id=payload.subject_id,
        entitlements=[e.model_dump() for e in payload.entitlements],
        justification=payload.justification,
    )
    return [AccessRequestDTO.from_domain(r) for r in records]


@router.get(
    "",
    response_model=list[AccessRequestDTO],
    summary="List requests — the approval inbox and the requester's own history",
)
async def list_requests(
    service: RequestServiceDep,
    requester_id: str | None = Query(default=None, description="Who raised it."),
    approver_id: str | None = Query(
        default=None, description="Whose decision it waits on — the inbox filter."
    ),
    subject_id: str | None = Query(default=None, description="Who the access is for."),
    status: str | None = Query(default=None, description="e.g. PENDING_APPROVAL."),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[AccessRequestDTO]:
    """One listing, two jobs.

    `?approver_id=EMP001&status=PENDING_APPROVAL` is a manager's queue.
    `?requester_id=EMP002` is that person's own history, which is where an
    approval or a refusal — and the note explaining it — is read back.
    """
    records = await service.list_requests(
        requester_id=requester_id,
        approver_id=approver_id,
        subject_id=subject_id,
        status=status,
        limit=limit,
        offset=offset,
    )
    return [AccessRequestDTO.from_domain(r) for r in records]


@router.get(
    "/statuses",
    response_model=list[str],
    summary="The statuses a request can hold",
)
async def statuses() -> list[str]:
    """Exposed so a client renders the workflow states without hardcoding them."""
    return REQUEST_STATUSES


# Declared after the literal paths so /statuses is not swallowed by the wildcard,
# matching how /agents/{name} sits below /agents/mcp.
@router.get(
    "/{request_id}",
    response_model=AccessRequestDTO,
    summary="One access request",
)
async def get_request(
    service: RequestServiceDep,
    request_id: str = Path(description="e.g. REQ0001."),
) -> AccessRequestDTO:
    return AccessRequestDTO.from_domain(await service.get(request_id))


@router.post(
    "/{request_id}/approve",
    response_model=AccessRequestDTO,
    summary="Approve a pending request and provision the access",
)
async def approve(
    payload: DecisionDTO,
    service: RequestServiceDep,
    request_id: str = Path(description="e.g. REQ0001."),
) -> AccessRequestDTO:
    """Approve, then apply the access.

    `approver_id` must match the request's approver; anyone else gets a 403.
    There is no login here, which is exactly why that check is enforced rather
    than assumed.

    The request comes back `GRANTED` once the access has actually landed, or
    `PROVISIONING_FAILED` if applying it failed — the approval is not lost
    either way.
    """
    record = await service.approve(
        request_id, approver_id=payload.approver_id, note=payload.note
    )
    return AccessRequestDTO.from_domain(record)


@router.post(
    "/{request_id}/reject",
    response_model=AccessRequestDTO,
    summary="Reject a pending request",
)
async def reject(
    payload: DecisionDTO,
    service: RequestServiceDep,
    request_id: str = Path(description="e.g. REQ0001."),
) -> AccessRequestDTO:
    """Reject. `note` is the refusal the requester reads back on their history."""
    record = await service.reject(
        request_id, approver_id=payload.approver_id, note=payload.note
    )
    return AccessRequestDTO.from_domain(record)
