"""Personas and the entitlement catalog — what a client needs before acting.

There is no login.  `/personas` is the closed set of actors the client may act
as, and every write endpoint validates its actor against it.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import DecisionServiceDep, PersonaServiceDep
from app.schemas.requests import CatalogEntryDTO, PersonaDTO

router = APIRouter(tags=["workflow"])


@router.get(
    "/personas",
    response_model=list[PersonaDTO],
    summary="The actors this prototype can be used as",
)
async def personas(service: PersonaServiceDep) -> list[PersonaDTO]:
    """The HR persona plus each configured demo employee.

    Employees are hydrated from the identities data, so `manager_id` is the real
    approval route and `pending_approvals` is the live count waiting on them —
    an employee is a requester and a manager at the same time.
    """
    return [PersonaDTO.from_domain(p) for p in await service.list_personas()]


@router.get(
    "/catalog/entitlements",
    response_model=list[CatalogEntryDTO],
    summary="The entitlement catalog with risk and approval verdicts",
)
async def catalog(service: DecisionServiceDep) -> list[CatalogEntryDTO]:
    """Every catalog entitlement joined to its risk score and approval verdict.

    Lets a client label an entitlement as auto-grant or approval-needed before
    anybody requests it, without a round trip per row.
    """
    return [CatalogEntryDTO(**row) for row in await service.catalog()]
