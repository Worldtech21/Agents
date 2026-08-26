"""The seven MCP servers, backed by Postgres instead of JSON files.

Run them all in one process:

    python db/mcp_server.py                 # 127.0.0.1:8900
    python db/mcp_server.py --port 9100
    DATABASE_URL=... python db/mcp_server.py

Each server is mounted at the same path its GKE counterpart uses, so switching
the backend over is a host swap in ``.env`` and nothing else:

    http://34.120.8.80/identities-mcp/mcp   ->   http://127.0.0.1:8900/identities-mcp/mcp

Tool names, argument names, defaults and return shapes match the deployed
servers exactly — they were read off the live ones with ``list_tools`` rather
than reconstructed from memory. What changes is where the rows come from.

The write tools are implemented because the backend genuinely uses two of them:
``ProvisioningService`` grants access through ``update_identity``, and
``RequestService`` writes the whole access-request lifecycle. The rest exist for
parity, and the agents' own prompts are what keep them from being called.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path
from typing import Annotated, Any, Literal

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastmcp import FastMCP  # noqa: E402
from fastmcp.exceptions import ToolError  # noqa: E402
from pydantic import Field  # noqa: E402
from sqlalchemy import select  # noqa: E402

from mcp_support import (  # noqa: E402
    DATABASE_URL,
    apply_patch,
    ensure_absent,
    fetch_one,
    health,
    paginate,
    row_to_dict,
    rows_to_list,
    session_scope,
)
from models import (  # noqa: E402
    AccessRequest,
    EntitlementCatalog,
    EntitlementRiskScore,
    Identity,
    NewJoiner,
    PeerAffinityScore,
    PolicyRule,
    SodRule,
)

Limit = Annotated[int, Field(default=100, ge=1, le=1000)]
Offset = Annotated[int, Field(default=0, ge=0)]

RiskCategory = Literal["Low", "Medium", "High", "Critical"]
PolicyType = Literal["ALLOW", "DENY", "HUMAN_APPROVAL"]


def _iso_date(value: str, field: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ToolError(f"{field}: {value!r} is not an ISO date (YYYY-MM-DD)") from exc


# ------------------------------------------------------------- new joiners ---

new_joiners = FastMCP(
    "new-joiners",
    version="1.0.0",
    instructions=(
        "CRUD access to the New Joiners HR dataset: employees who have been "
        "hired and have a start date, with their department, job role, level, "
        "location, manager and cost center. Use list_new_joiners to search or "
        "browse, and employee_id (e.g. 'NJ1004') to address a single record."
    ),
)


@new_joiners.tool
def list_new_joiners(
    department: str | None = None,
    location: str | None = None,
    job_level: str | None = None,
    manager_id: str | None = None,
    limit: Limit = 100,
    offset: Offset = 0,
) -> list[dict[str, Any]]:
    """Search or browse new joiners. All filters are exact matches, and combine."""
    with session_scope() as session:
        statement = select(NewJoiner).order_by(NewJoiner.employee_id)
        for column, value in (
            (NewJoiner.department, department),
            (NewJoiner.location, location),
            (NewJoiner.job_level, job_level),
            (NewJoiner.manager_id, manager_id),
        ):
            if value is not None:
                statement = statement.where(column == value)
        return rows_to_list(session.scalars(paginate(statement, limit, offset)).all())


@new_joiners.tool
def get_new_joiner(employee_id: str) -> dict[str, Any]:
    """One new joiner by employee_id, e.g. 'NJ1004'."""
    with session_scope() as session:
        return row_to_dict(fetch_one(session, NewJoiner, employee_id=employee_id))


@new_joiners.tool
def create_new_joiner(
    employee_id: str,
    name: str,
    department: str,
    job_role: str,
    job_level: str,
    location: str,
    manager_id: str,
    cost_center: str,
    start_date: str,
) -> dict[str, Any]:
    """Add a new joiner. Fails if employee_id is already taken."""
    with session_scope() as session:
        ensure_absent(session, NewJoiner, employee_id=employee_id)
        row = NewJoiner(
            employee_id=employee_id,
            name=name,
            department=department,
            job_role=job_role,
            job_level=job_level,
            location=location,
            manager_id=manager_id,
            cost_center=cost_center,
            start_date=_iso_date(start_date, "start_date"),
        )
        session.add(row)
        session.flush()
        return row_to_dict(row)


@new_joiners.tool
def update_new_joiner(
    employee_id: str,
    name: str | None = None,
    department: str | None = None,
    job_role: str | None = None,
    job_level: str | None = None,
    location: str | None = None,
    manager_id: str | None = None,
    cost_center: str | None = None,
    start_date: str | None = None,
) -> dict[str, Any]:
    """Partial update: only the fields you pass are changed."""
    with session_scope() as session:
        row = fetch_one(session, NewJoiner, employee_id=employee_id)
        return apply_patch(
            row,
            {
                "name": name,
                "department": department,
                "job_role": job_role,
                "job_level": job_level,
                "location": location,
                "manager_id": manager_id,
                "cost_center": cost_center,
                "start_date": _iso_date(start_date, "start_date") if start_date else None,
            },
        )


@new_joiners.tool
def replace_new_joiner(
    employee_id: str,
    name: str,
    department: str,
    job_role: str,
    job_level: str,
    location: str,
    manager_id: str,
    cost_center: str,
    start_date: str,
) -> dict[str, Any]:
    """Full replacement of an existing record. Every field is required."""
    with session_scope() as session:
        row = fetch_one(session, NewJoiner, employee_id=employee_id)
        return apply_patch(
            row,
            {
                "name": name,
                "department": department,
                "job_role": job_role,
                "job_level": job_level,
                "location": location,
                "manager_id": manager_id,
                "cost_center": cost_center,
                "start_date": _iso_date(start_date, "start_date"),
            },
        )


@new_joiners.tool
def delete_new_joiner(employee_id: str) -> dict[str, Any]:
    """Remove a new joiner by employee_id."""
    with session_scope() as session:
        row = fetch_one(session, NewJoiner, employee_id=employee_id)
        session.delete(row)
        return {"deleted": employee_id}


@new_joiners.tool
def api_health() -> dict[str, Any]:
    """Whether the backing store is reachable."""
    return health(NewJoiner)


# -------------------------------------------------------------- identities ---

identities = FastMCP(
    "identities",
    version="1.0.0",
    instructions=(
        "CRUD access to the Identities dataset: existing employees, their "
        "department, job role, level, location and manager, plus the "
        "entitlements they already hold as a semicolon-separated list. "
        "Records are addressed by employee_id (e.g. 'EMP001')."
    ),
)


@identities.tool
def list_identities(
    department: str | None = None,
    location: str | None = None,
    job_level: str | None = None,
    job_role: str | None = None,
    manager_id: str | None = None,
    entitlement: str | None = None,
    limit: Limit = 100,
    offset: Offset = 0,
) -> list[dict[str, Any]]:
    """Search identities. `entitlement` matches anyone holding that entitlement."""
    with session_scope() as session:
        statement = select(Identity).order_by(Identity.employee_id)
        for column, value in (
            (Identity.department, department),
            (Identity.location, location),
            (Identity.job_level, job_level),
            (Identity.job_role, job_role),
            (Identity.manager_id, manager_id),
        ):
            if value is not None:
                statement = statement.where(column == value)
        rows = session.scalars(statement).all()
        if entitlement is not None:
            # The column is a semicolon-separated string, so membership is a
            # split rather than a LIKE — 'JIRA' must not match 'JIRA_ADMIN'.
            rows = [r for r in rows if entitlement in (r.entitlements.split(";") if r.entitlements else [])]
        return rows_to_list(rows[offset : offset + limit])


@identities.tool
def get_identity(employee_id: str) -> dict[str, Any]:
    """One identity by employee_id, e.g. 'EMP001'."""
    with session_scope() as session:
        return row_to_dict(fetch_one(session, Identity, employee_id=employee_id))


@identities.tool
def get_identity_entitlements(employee_id: str) -> list[str]:
    """Just the entitlements one identity holds, as a list.

    A bare list, matching the GKE server — not an object wrapping one. Callers
    index into the result.
    """
    with session_scope() as session:
        row = fetch_one(session, Identity, employee_id=employee_id)
        return row.entitlements.split(";") if row.entitlements else []


@identities.tool
def create_identity(
    employee_id: str,
    name: str,
    department: str,
    job_role: str,
    job_level: str,
    location: str,
    entitlements: str,
    manager_id: str = "",
) -> dict[str, Any]:
    """Add an identity. `entitlements` is semicolon-separated, e.g. 'JIRA_USER;GITHUB_DEV'."""
    with session_scope() as session:
        ensure_absent(session, Identity, employee_id=employee_id)
        row = Identity(
            employee_id=employee_id,
            name=name,
            department=department,
            job_role=job_role,
            job_level=job_level,
            location=location,
            manager_id=manager_id,
            entitlements=entitlements,
        )
        session.add(row)
        session.flush()
        return row_to_dict(row)


@identities.tool
def update_identity(
    employee_id: str,
    name: str | None = None,
    department: str | None = None,
    job_role: str | None = None,
    job_level: str | None = None,
    location: str | None = None,
    manager_id: str | None = None,
    entitlements: str | None = None,
) -> dict[str, Any]:
    """Partial update. Passing `entitlements` replaces the whole set, not appends."""
    with session_scope() as session:
        row = fetch_one(session, Identity, employee_id=employee_id)
        return apply_patch(
            row,
            {
                "name": name,
                "department": department,
                "job_role": job_role,
                "job_level": job_level,
                "location": location,
                "manager_id": manager_id,
                "entitlements": entitlements,
            },
        )


@identities.tool
def replace_identity(
    employee_id: str,
    name: str,
    department: str,
    job_role: str,
    job_level: str,
    location: str,
    entitlements: str,
    manager_id: str = "",
) -> dict[str, Any]:
    """Full replacement of an existing identity."""
    with session_scope() as session:
        row = fetch_one(session, Identity, employee_id=employee_id)
        return apply_patch(
            row,
            {
                "name": name,
                "department": department,
                "job_role": job_role,
                "job_level": job_level,
                "location": location,
                "manager_id": manager_id,
                "entitlements": entitlements,
            },
        )


@identities.tool
def delete_identity(employee_id: str) -> dict[str, Any]:
    """Remove an identity by employee_id."""
    with session_scope() as session:
        session.delete(fetch_one(session, Identity, employee_id=employee_id))
        return {"deleted": employee_id}


@identities.tool
def api_health() -> dict[str, Any]:  # noqa: F811 — one per server, by design
    """Whether the backing store is reachable."""
    return health(Identity)


# ------------------------------------------------------------ entitlements ---

entitlements = FastMCP(
    "entitlements",
    version="1.0.0",
    instructions=(
        "Two datasets. The catalog says what an entitlement is — its id "
        "(e.g. 'ENT006'), name (e.g. 'GITHUB_DEV'), owning application and "
        "owner. The risk scores say how dangerous it is, keyed by entitlement "
        "name, with a 0-100 score and a Low/Medium/High/Critical category."
    ),
)


@entitlements.tool
def list_entitlements(
    application: str | None = None,
    owner: str | None = None,
    entitlement_name: str | None = None,
    limit: Limit = 100,
    offset: Offset = 0,
) -> list[dict[str, Any]]:
    """Search the entitlement catalog."""
    with session_scope() as session:
        statement = select(EntitlementCatalog).order_by(EntitlementCatalog.entitlement_id)
        for column, value in (
            (EntitlementCatalog.application, application),
            (EntitlementCatalog.owner, owner),
            (EntitlementCatalog.entitlement_name, entitlement_name),
        ):
            if value is not None:
                statement = statement.where(column == value)
        return rows_to_list(session.scalars(paginate(statement, limit, offset)).all())


@entitlements.tool
def get_entitlement(entitlement_id: str) -> dict[str, Any]:
    """One catalog entry by entitlement_id, e.g. 'ENT006'."""
    with session_scope() as session:
        return row_to_dict(fetch_one(session, EntitlementCatalog, entitlement_id=entitlement_id))


@entitlements.tool
def create_entitlement(
    entitlement_id: str, entitlement_name: str, application: str, owner: str
) -> dict[str, Any]:
    """Add a catalog entry."""
    with session_scope() as session:
        ensure_absent(session, EntitlementCatalog, entitlement_id=entitlement_id)
        row = EntitlementCatalog(
            entitlement_id=entitlement_id,
            entitlement_name=entitlement_name,
            application=application,
            owner=owner,
        )
        session.add(row)
        session.flush()
        return row_to_dict(row)


@entitlements.tool
def update_entitlement(
    entitlement_id: str,
    entitlement_name: str | None = None,
    application: str | None = None,
    owner: str | None = None,
) -> dict[str, Any]:
    """Partial update of a catalog entry."""
    with session_scope() as session:
        row = fetch_one(session, EntitlementCatalog, entitlement_id=entitlement_id)
        return apply_patch(
            row,
            {"entitlement_name": entitlement_name, "application": application, "owner": owner},
        )


@entitlements.tool
def replace_entitlement(
    entitlement_id: str, entitlement_name: str, application: str, owner: str
) -> dict[str, Any]:
    """Full replacement of a catalog entry."""
    with session_scope() as session:
        row = fetch_one(session, EntitlementCatalog, entitlement_id=entitlement_id)
        return apply_patch(
            row,
            {"entitlement_name": entitlement_name, "application": application, "owner": owner},
        )


@entitlements.tool
def delete_entitlement(entitlement_id: str) -> dict[str, Any]:
    """Remove a catalog entry by entitlement_id."""
    with session_scope() as session:
        session.delete(fetch_one(session, EntitlementCatalog, entitlement_id=entitlement_id))
        return {"deleted": entitlement_id}


@entitlements.tool
def list_risk_scores(
    application: str | None = None,
    risk_category: RiskCategory | None = None,
    min_score: int | None = None,
    max_score: int | None = None,
    limit: Limit = 100,
    offset: Offset = 0,
) -> list[dict[str, Any]]:
    """Search risk scores, optionally by category or score range."""
    with session_scope() as session:
        statement = select(EntitlementRiskScore).order_by(EntitlementRiskScore.entitlement_name)
        if application is not None:
            statement = statement.where(EntitlementRiskScore.application == application)
        if risk_category is not None:
            statement = statement.where(EntitlementRiskScore.risk_category == risk_category)
        if min_score is not None:
            statement = statement.where(EntitlementRiskScore.risk_score >= min_score)
        if max_score is not None:
            statement = statement.where(EntitlementRiskScore.risk_score <= max_score)
        return rows_to_list(session.scalars(paginate(statement, limit, offset)).all())


@entitlements.tool
def get_risk_score(entitlement_name: str) -> dict[str, Any]:
    """The risk score for one entitlement, by name, e.g. 'GITHUB_DEV'."""
    with session_scope() as session:
        return row_to_dict(
            fetch_one(session, EntitlementRiskScore, entitlement_name=entitlement_name)
        )


@entitlements.tool
def create_risk_score(
    entitlement_name: str, application: str, risk_score: int, risk_category: RiskCategory
) -> dict[str, Any]:
    """Add a risk score for an entitlement."""
    with session_scope() as session:
        ensure_absent(session, EntitlementRiskScore, entitlement_name=entitlement_name)
        row = EntitlementRiskScore(
            entitlement_name=entitlement_name,
            application=application,
            risk_score=risk_score,
            risk_category=risk_category,
        )
        session.add(row)
        session.flush()
        return row_to_dict(row)


@entitlements.tool
def update_risk_score(
    entitlement_name: str,
    application: str | None = None,
    risk_score: int | None = None,
    risk_category: RiskCategory | None = None,
) -> dict[str, Any]:
    """Partial update of a risk score."""
    with session_scope() as session:
        row = fetch_one(session, EntitlementRiskScore, entitlement_name=entitlement_name)
        return apply_patch(
            row,
            {
                "application": application,
                "risk_score": risk_score,
                "risk_category": risk_category,
            },
        )


@entitlements.tool
def replace_risk_score(
    entitlement_name: str, application: str, risk_score: int, risk_category: RiskCategory
) -> dict[str, Any]:
    """Full replacement of a risk score."""
    with session_scope() as session:
        row = fetch_one(session, EntitlementRiskScore, entitlement_name=entitlement_name)
        return apply_patch(
            row,
            {
                "application": application,
                "risk_score": risk_score,
                "risk_category": risk_category,
            },
        )


@entitlements.tool
def delete_risk_score(entitlement_name: str) -> dict[str, Any]:
    """Remove a risk score by entitlement name."""
    with session_scope() as session:
        session.delete(fetch_one(session, EntitlementRiskScore, entitlement_name=entitlement_name))
        return {"deleted": entitlement_name}


@entitlements.tool
def api_health() -> dict[str, Any]:  # noqa: F811
    """Whether the backing store is reachable."""
    return health(EntitlementCatalog)


# ------------------------------------------------------------------ policy ---

policy = FastMCP(
    "policy",
    version="1.0.0",
    instructions=(
        "The access policy rulebook. Each rule has a type -- ALLOW grants access "
        "outright (birthright entitlements for a role), DENY blocks it, and "
        "HUMAN_APPROVAL routes the request to a reviewer. The `rule` field holds "
        "the condition as free text, either a mapping like "
        "'Financial Analyst -> SAP_FIN_DISPLAY' or a threshold like "
        "'risk_score >= 70'. Rules are addressed by policy_id (e.g. 'POL001')."
    ),
)


@policy.tool
def list_policies(
    type: PolicyType | None = None,
    policy_name: str | None = None,
    rule_contains: str | None = None,
    limit: Limit = 100,
    offset: Offset = 0,
) -> list[dict[str, Any]]:
    """Search policies by type, name, or a substring of the rule text."""
    with session_scope() as session:
        statement = select(PolicyRule).order_by(PolicyRule.policy_id)
        if type is not None:
            statement = statement.where(PolicyRule.type == type)
        if policy_name is not None:
            statement = statement.where(PolicyRule.policy_name == policy_name)
        if rule_contains is not None:
            statement = statement.where(PolicyRule.rule.contains(rule_contains))
        return rows_to_list(session.scalars(paginate(statement, limit, offset)).all())


@policy.tool
def get_policy(policy_id: str) -> dict[str, Any]:
    """One policy by policy_id, e.g. 'POL001'."""
    with session_scope() as session:
        return row_to_dict(fetch_one(session, PolicyRule, policy_id=policy_id))


@policy.tool
def create_policy(policy_id: str, policy_name: str, type: PolicyType, rule: str) -> dict[str, Any]:
    """Add a policy rule."""
    with session_scope() as session:
        ensure_absent(session, PolicyRule, policy_id=policy_id)
        row = PolicyRule(policy_id=policy_id, policy_name=policy_name, type=type, rule=rule)
        session.add(row)
        session.flush()
        return row_to_dict(row)


@policy.tool
def update_policy(
    policy_id: str,
    policy_name: str | None = None,
    type: PolicyType | None = None,
    rule: str | None = None,
) -> dict[str, Any]:
    """Partial update of a policy rule."""
    with session_scope() as session:
        row = fetch_one(session, PolicyRule, policy_id=policy_id)
        return apply_patch(row, {"policy_name": policy_name, "type": type, "rule": rule})


@policy.tool
def replace_policy(policy_id: str, policy_name: str, type: PolicyType, rule: str) -> dict[str, Any]:
    """Full replacement of a policy rule."""
    with session_scope() as session:
        row = fetch_one(session, PolicyRule, policy_id=policy_id)
        return apply_patch(row, {"policy_name": policy_name, "type": type, "rule": rule})


@policy.tool
def delete_policy(policy_id: str) -> dict[str, Any]:
    """Remove a policy by policy_id."""
    with session_scope() as session:
        session.delete(fetch_one(session, PolicyRule, policy_id=policy_id))
        return {"deleted": policy_id}


@policy.tool
def api_health() -> dict[str, Any]:  # noqa: F811
    """Whether the backing store is reachable."""
    return health(PolicyRule)


# ---------------------------------------------------------------- sod test ---

sod_test = FastMCP(
    "sod-test",
    version="1.0.0",
    instructions=(
        "Separation-of-duties rules: pairs of entitlements that must not be held "
        "by the same person, each with a severity. Rules are addressed by sod_id "
        "(e.g. 'SOD001'). Use list_sod_rules with `entitlement` to find every "
        "rule one entitlement appears in, on either side of the pair."
    ),
)


@sod_test.tool
def list_sod_rules(
    severity: RiskCategory | None = None,
    entitlement: str | None = None,
    limit: Limit = 100,
    offset: Offset = 0,
) -> list[dict[str, Any]]:
    """Search SoD rules. `entitlement` matches either side of the pair."""
    with session_scope() as session:
        statement = select(SodRule).order_by(SodRule.sod_id)
        if severity is not None:
            statement = statement.where(SodRule.severity == severity)
        if entitlement is not None:
            statement = statement.where(
                (SodRule.entitlement_1 == entitlement) | (SodRule.entitlement_2 == entitlement)
            )
        return rows_to_list(session.scalars(paginate(statement, limit, offset)).all())


@sod_test.tool
def get_sod_rule(sod_id: str) -> dict[str, Any]:
    """One SoD rule by sod_id, e.g. 'SOD001'."""
    with session_scope() as session:
        return row_to_dict(fetch_one(session, SodRule, sod_id=sod_id))


@sod_test.tool
def create_sod_rule(
    sod_id: str, entitlement_1: str, entitlement_2: str, severity: RiskCategory
) -> dict[str, Any]:
    """Add an SoD rule."""
    with session_scope() as session:
        ensure_absent(session, SodRule, sod_id=sod_id)
        row = SodRule(
            sod_id=sod_id,
            entitlement_1=entitlement_1,
            entitlement_2=entitlement_2,
            severity=severity,
        )
        session.add(row)
        session.flush()
        return row_to_dict(row)


@sod_test.tool
def update_sod_rule(
    sod_id: str,
    entitlement_1: str | None = None,
    entitlement_2: str | None = None,
    severity: RiskCategory | None = None,
) -> dict[str, Any]:
    """Partial update of an SoD rule."""
    with session_scope() as session:
        row = fetch_one(session, SodRule, sod_id=sod_id)
        return apply_patch(
            row,
            {
                "entitlement_1": entitlement_1,
                "entitlement_2": entitlement_2,
                "severity": severity,
            },
        )


@sod_test.tool
def replace_sod_rule(
    sod_id: str, entitlement_1: str, entitlement_2: str, severity: RiskCategory
) -> dict[str, Any]:
    """Full replacement of an SoD rule."""
    with session_scope() as session:
        row = fetch_one(session, SodRule, sod_id=sod_id)
        return apply_patch(
            row,
            {
                "entitlement_1": entitlement_1,
                "entitlement_2": entitlement_2,
                "severity": severity,
            },
        )


@sod_test.tool
def delete_sod_rule(sod_id: str) -> dict[str, Any]:
    """Remove an SoD rule by sod_id."""
    with session_scope() as session:
        session.delete(fetch_one(session, SodRule, sod_id=sod_id))
        return {"deleted": sod_id}


@sod_test.tool
def api_health() -> dict[str, Any]:  # noqa: F811
    """Whether the backing store is reachable."""
    return health(SodRule)


# ----------------------------------------------------------- peer affinity ---

peer_affinity = FastMCP(
    "peer-affinity",
    version="1.0.0",
    instructions=(
        "How common an entitlement is within a job role: peer_count of "
        "total_peers hold it, and affinity_score is that share as a percentage. "
        "A row is identified by the (job_role, entitlement) pair rather than an "
        "id of its own."
    ),
)


@peer_affinity.tool
def list_peer_affinity(
    job_role: str | None = None,
    department: str | None = None,
    entitlement: str | None = None,
    min_score: int | None = None,
    max_score: int | None = None,
    limit: Limit = 100,
    offset: Offset = 0,
) -> list[dict[str, Any]]:
    """Search peer affinity rows, optionally bounded by affinity score."""
    with session_scope() as session:
        statement = select(PeerAffinityScore).order_by(
            PeerAffinityScore.job_role, PeerAffinityScore.entitlement
        )
        for column, value in (
            (PeerAffinityScore.job_role, job_role),
            (PeerAffinityScore.department, department),
            (PeerAffinityScore.entitlement, entitlement),
        ):
            if value is not None:
                statement = statement.where(column == value)
        if min_score is not None:
            statement = statement.where(PeerAffinityScore.affinity_score >= min_score)
        if max_score is not None:
            statement = statement.where(PeerAffinityScore.affinity_score <= max_score)
        return rows_to_list(session.scalars(paginate(statement, limit, offset)).all())


@peer_affinity.tool
def get_peer_affinity(job_role: str, entitlement: str) -> dict[str, Any]:
    """One row, by the (job_role, entitlement) pair that identifies it."""
    with session_scope() as session:
        return row_to_dict(
            fetch_one(session, PeerAffinityScore, job_role=job_role, entitlement=entitlement)
        )


@peer_affinity.tool
def create_peer_affinity(
    job_role: str,
    department: str,
    entitlement: str,
    peer_count: int,
    total_peers: int,
    affinity_score: int,
) -> dict[str, Any]:
    """Add a peer affinity row."""
    with session_scope() as session:
        ensure_absent(session, PeerAffinityScore, job_role=job_role, entitlement=entitlement)
        row = PeerAffinityScore(
            job_role=job_role,
            department=department,
            entitlement=entitlement,
            peer_count=peer_count,
            total_peers=total_peers,
            affinity_score=affinity_score,
        )
        session.add(row)
        session.flush()
        return row_to_dict(row)


@peer_affinity.tool
def update_peer_affinity(
    job_role: str,
    entitlement: str,
    department: str | None = None,
    peer_count: int | None = None,
    total_peers: int | None = None,
    affinity_score: int | None = None,
) -> dict[str, Any]:
    """Partial update, addressed by the (job_role, entitlement) pair."""
    with session_scope() as session:
        row = fetch_one(session, PeerAffinityScore, job_role=job_role, entitlement=entitlement)
        return apply_patch(
            row,
            {
                "department": department,
                "peer_count": peer_count,
                "total_peers": total_peers,
                "affinity_score": affinity_score,
            },
        )


@peer_affinity.tool
def replace_peer_affinity(
    job_role: str,
    entitlement: str,
    department: str,
    peer_count: int,
    total_peers: int,
    affinity_score: int,
) -> dict[str, Any]:
    """Full replacement, addressed by the (job_role, entitlement) pair."""
    with session_scope() as session:
        row = fetch_one(session, PeerAffinityScore, job_role=job_role, entitlement=entitlement)
        return apply_patch(
            row,
            {
                "department": department,
                "peer_count": peer_count,
                "total_peers": total_peers,
                "affinity_score": affinity_score,
            },
        )


@peer_affinity.tool
def delete_peer_affinity(job_role: str, entitlement: str) -> dict[str, Any]:
    """Remove a peer affinity row."""
    with session_scope() as session:
        session.delete(
            fetch_one(session, PeerAffinityScore, job_role=job_role, entitlement=entitlement)
        )
        return {"deleted": {"job_role": job_role, "entitlement": entitlement}}


@peer_affinity.tool
def api_health() -> dict[str, Any]:  # noqa: F811
    """Whether the backing store is reachable."""
    return health(PeerAffinityScore)


# ---------------------------------------------------------------- requests ---

requests = FastMCP(
    "requests",
    version="1.0.0",
    instructions=(
        "Access requests through their whole lifecycle: who asked, for whom, for "
        "what entitlement, what the policy and SoD checks said, who must approve, "
        "and where it ended up. Requests are addressed by request_id."
    ),
)

RequestStatus = Literal[
    "AUTO_GRANTED",
    "PENDING_APPROVAL",
    "APPROVED",
    "REJECTED",
    "GRANTED",
    "BLOCKED_NO_APPROVER",
    "PROVISIONING_FAILED",
]


@requests.tool
def list_access_requests(
    requester_id: str | None = None,
    approver_id: str | None = None,
    subject_id: str | None = None,
    status: RequestStatus | None = None,
    limit: Limit = 100,
    offset: Offset = 0,
) -> list[dict[str, Any]]:
    """Search access requests — the approval inbox and a requester's history."""
    with session_scope() as session:
        statement = select(AccessRequest).order_by(AccessRequest.request_id)
        for column, value in (
            (AccessRequest.requester_id, requester_id),
            (AccessRequest.approver_id, approver_id),
            (AccessRequest.subject_id, subject_id),
            (AccessRequest.status, status),
        ):
            if value is not None:
                statement = statement.where(column == value)
        return rows_to_list(session.scalars(paginate(statement, limit, offset)).all())


@requests.tool
def get_access_request(request_id: str) -> dict[str, Any]:
    """One access request by request_id."""
    with session_scope() as session:
        return row_to_dict(fetch_one(session, AccessRequest, request_id=request_id))


@requests.tool
def create_access_request(
    request_id: str,
    requester_type: Literal["EMPLOYEE", "HR"],
    subject_type: Literal["IDENTITY", "NEW_JOINER"],
    status: RequestStatus,
    requester_id: str = "",
    subject_id: str = "",
    entitlement_id: str = "",
    entitlement_name: str = "",
    application: str = "",
    risk_score: int | None = None,
    risk_category: str = "",
    approval_required: bool = False,
    policy_basis: str = "",
    sod_conflicts: str = "",
    approver_id: str = "",
    justification: str = "",
    decision_note: str = "",
    created_at: str = "",
    decided_at: str = "",
    granted_at: str = "",
) -> dict[str, Any]:
    """Raise an access request."""
    with session_scope() as session:
        ensure_absent(session, AccessRequest, request_id=request_id)
        row = AccessRequest(
            request_id=request_id,
            requester_id=requester_id,
            requester_type=requester_type,
            subject_id=subject_id,
            subject_type=subject_type,
            entitlement_id=entitlement_id,
            entitlement_name=entitlement_name,
            application=application,
            risk_score=risk_score,
            risk_category=risk_category,
            approval_required=approval_required,
            policy_basis=policy_basis,
            sod_conflicts=sod_conflicts,
            approver_id=approver_id,
            status=status,
            justification=justification,
            decision_note=decision_note,
            created_at=created_at,
            decided_at=decided_at,
            granted_at=granted_at,
        )
        session.add(row)
        session.flush()
        return row_to_dict(row)


@requests.tool
def update_access_request(
    request_id: str,
    requester_id: str | None = None,
    requester_type: Literal["EMPLOYEE", "HR"] | None = None,
    subject_id: str | None = None,
    subject_type: Literal["IDENTITY", "NEW_JOINER"] | None = None,
    entitlement_id: str | None = None,
    entitlement_name: str | None = None,
    application: str | None = None,
    risk_score: int | None = None,
    risk_category: str | None = None,
    approval_required: bool | None = None,
    policy_basis: str | None = None,
    sod_conflicts: str | None = None,
    approver_id: str | None = None,
    status: RequestStatus | None = None,
    justification: str | None = None,
    decision_note: str | None = None,
    created_at: str | None = None,
    decided_at: str | None = None,
    granted_at: str | None = None,
) -> dict[str, Any]:
    """Partial update — how a request moves through its lifecycle."""
    with session_scope() as session:
        row = fetch_one(session, AccessRequest, request_id=request_id)
        return apply_patch(
            row,
            {
                "requester_id": requester_id,
                "requester_type": requester_type,
                "subject_id": subject_id,
                "subject_type": subject_type,
                "entitlement_id": entitlement_id,
                "entitlement_name": entitlement_name,
                "application": application,
                "risk_score": risk_score,
                "risk_category": risk_category,
                "approval_required": approval_required,
                "policy_basis": policy_basis,
                "sod_conflicts": sod_conflicts,
                "approver_id": approver_id,
                "status": status,
                "justification": justification,
                "decision_note": decision_note,
                "created_at": created_at,
                "decided_at": decided_at,
                "granted_at": granted_at,
            },
        )


@requests.tool
def replace_access_request(
    request_id: str,
    requester_type: Literal["EMPLOYEE", "HR"],
    subject_type: Literal["IDENTITY", "NEW_JOINER"],
    status: RequestStatus,
    requester_id: str = "",
    subject_id: str = "",
    entitlement_id: str = "",
    entitlement_name: str = "",
    application: str = "",
    risk_score: int | None = None,
    risk_category: str = "",
    approval_required: bool = False,
    policy_basis: str = "",
    sod_conflicts: str = "",
    approver_id: str = "",
    justification: str = "",
    decision_note: str = "",
    created_at: str = "",
    decided_at: str = "",
    granted_at: str = "",
) -> dict[str, Any]:
    """Full replacement of an existing request."""
    with session_scope() as session:
        row = fetch_one(session, AccessRequest, request_id=request_id)
        return apply_patch(
            row,
            {
                "requester_id": requester_id,
                "requester_type": requester_type,
                "subject_id": subject_id,
                "subject_type": subject_type,
                "entitlement_id": entitlement_id,
                "entitlement_name": entitlement_name,
                "application": application,
                "risk_score": risk_score,
                "risk_category": risk_category,
                "approval_required": approval_required,
                "policy_basis": policy_basis,
                "sod_conflicts": sod_conflicts,
                "approver_id": approver_id,
                "status": status,
                "justification": justification,
                "decision_note": decision_note,
                "created_at": created_at,
                "decided_at": decided_at,
                "granted_at": granted_at,
            },
        )


@requests.tool
def delete_access_request(request_id: str) -> dict[str, Any]:
    """Remove an access request by request_id."""
    with session_scope() as session:
        session.delete(fetch_one(session, AccessRequest, request_id=request_id))
        return {"deleted": request_id}


@requests.tool
def api_health() -> dict[str, Any]:  # noqa: F811
    """Whether the backing store is reachable."""
    return health(AccessRequest)


# ----------------------------------------------------------------- serving ---

#: Path -> server, mirroring the GKE gateway's routes exactly.
SERVERS: dict[str, FastMCP] = {
    "new-joiners-mcp": new_joiners,
    "identities-mcp": identities,
    "entitlements-mcp": entitlements,
    "policy-mcp": policy,
    "sod-test-mcp": sod_test,
    "peer-affinity-mcp": peer_affinity,
    "requests-mcp": requests,
}


def build_app():
    """Mount all seven servers into one ASGI app.

    Each ``http_app()`` carries its own session-manager lifespan, and Starlette
    only runs the lifespan of the outermost app — so the mounted ones are
    chained explicitly here. Without that the servers accept connections and
    then fail on the first request with an uninitialised session manager.
    """
    from contextlib import AsyncExitStack, asynccontextmanager

    from starlette.applications import Starlette
    from starlette.routing import Mount

    apps = {path: server.http_app(path="/mcp") for path, server in SERVERS.items()}

    @asynccontextmanager
    async def lifespan(_app: Starlette):
        async with AsyncExitStack() as stack:
            for mounted in apps.values():
                await stack.enter_async_context(mounted.router.lifespan_context(mounted))
            yield

    return Starlette(
        routes=[Mount(f"/{path}", app=mounted) for path, mounted in apps.items()],
        lifespan=lifespan,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Postgres-backed MCP servers.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8900)
    args = parser.parse_args()

    import uvicorn

    print(f"database: {DATABASE_URL}")
    for path, server in SERVERS.items():
        print(f"  http://{args.host}:{args.port}/{path}/mcp  ({server.name})")

    uvicorn.run(build_app(), host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
