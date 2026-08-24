"""The access request workflow, exercised without any MCP server running.

``StubMCP`` implements the same ``ToolProvider`` port the real adapter does, over
dictionaries seeded with the live data's actual shape and values.  That is what
lets the whole approval path — policy evaluation, routing, provisioning, the
approver check — be tested before the request tracker exists, and afterwards
without depending on it.

The fixtures below mirror the deployed data deliberately: `RSA_GRC` really is
scored 70, `JIRA_USER` really is 5, and `POL005`/`POL006` really are the two
HUMAN_APPROVAL policies.  A test that passes here should behave the same way
against GKE.
"""

from __future__ import annotations

import re
from typing import Any

import pytest

from app.core.config import Settings
from app.core.exceptions import (
    MCPToolError,
    NotApproverError,
    RecordNotFoundError,
    WorkflowError,
)
from app.domain.models import RequesterType, RequestStatus
from app.services.decision_service import DecisionService
from app.services.directory_service import DirectoryService
from app.services.persona_service import PersonaService
from app.services.provisioning_service import ProvisioningService
from app.services.request_service import RequestService

# --------------------------------------------------------------------- fixtures

IDENTITIES = {
    "EMP001": {
        "employee_id": "EMP001",
        "name": "Ramesh",
        "department": "Finance",
        "job_role": "Financial Analyst",
        "job_level": "L2",
        "location": "Bangalore",
        "manager_id": "",  # the top of the chain — nobody approves for them
        "entitlements": "SAP_FIN_DISPLAY;SAP_AP_INVOICE;POWERBI_FINANCE",
    },
    "EMP002": {
        "employee_id": "EMP002",
        "name": "Sneha",
        "department": "Finance",
        "job_role": "Financial Analyst",
        "job_level": "L2",
        "location": "Bangalore",
        "manager_id": "EMP001",
        "entitlements": "SAP_FIN_DISPLAY;POWERBI_FINANCE",
    },
}

NEW_JOINERS = {
    "NJ1004": {
        "employee_id": "NJ1004",
        "name": "Anjali Rao",
        "department": "Technology",
        "job_role": "Software Engineer",
        "job_level": "L2",
        "location": "Bangalore",
        "manager_id": "EMP002",
        "cost_center": "TECH001",
        "start_date": "2026-08-01",
    },
}

ENTITLEMENTS = [
    {"entitlement_id": "ENT005", "entitlement_name": "JIRA_USER", "application": "JIRA", "owner": "Engineering IT"},
    {"entitlement_id": "ENT008", "entitlement_name": "RSA_GRC", "application": "RSA Archer", "owner": "Risk IT"},
    {"entitlement_id": "ENT010", "entitlement_name": "AUDIT_TOOL", "application": "Audit Platform", "owner": "Audit IT"},
    {"entitlement_id": "ENT002", "entitlement_name": "SAP_AP_INVOICE", "application": "SAP ECC", "owner": "Finance IT"},
    {"entitlement_id": "ENT003", "entitlement_name": "POWERBI_FINANCE", "application": "PowerBI", "owner": "BI Team"},
    {"entitlement_id": "ENT999", "entitlement_name": "UNSCORED_THING", "application": "Somewhere", "owner": "Nobody"},
]

RISK_SCORES = [
    {"entitlement_name": "JIRA_USER", "application": "JIRA", "risk_score": 5, "risk_category": "Low"},
    {"entitlement_name": "RSA_GRC", "application": "RSA Archer", "risk_score": 70, "risk_category": "High"},
    {"entitlement_name": "AUDIT_TOOL", "application": "Audit Platform", "risk_score": 75, "risk_category": "High"},
    {"entitlement_name": "SAP_AP_INVOICE", "application": "SAP ECC", "risk_score": 45, "risk_category": "Medium"},
    {"entitlement_name": "POWERBI_FINANCE", "application": "PowerBI", "risk_score": 10, "risk_category": "Low"},
]

POLICIES = [
    {"policy_id": "POL001", "policy_name": "Finance Birthright", "type": "ALLOW", "rule": "Financial Analyst -> SAP_FIN_DISPLAY"},
    {"policy_id": "POL005", "policy_name": "Risk Review", "type": "HUMAN_APPROVAL", "rule": "risk_score >= 70"},
    {"policy_id": "POL006", "policy_name": "Critical Access", "type": "HUMAN_APPROVAL", "rule": "risk_score >= 90"},
]

SOD_RULES = [
    {"sod_id": "SOD002", "entitlement_1": "AUDIT_TOOL", "entitlement_2": "SAP_AP_INVOICE", "severity": "High"},
]


class StubMCP:
    """In-memory stand-in for all seven MCP servers.

    Only the tools the workflow actually calls are implemented; anything else
    raises, so a service reaching for a tool nobody wired up fails loudly in a
    test rather than silently in production.
    """

    def __init__(self) -> None:
        self.identities = {k: dict(v) for k, v in IDENTITIES.items()}
        self.new_joiners = {k: dict(v) for k, v in NEW_JOINERS.items()}
        self.requests: dict[str, dict[str, Any]] = {}
        self._seq = 0
        self.calls: list[tuple[str, str]] = []

    # ----------------------------------------------------------- ToolProvider
    async def startup(self) -> None: ...

    async def shutdown(self) -> None: ...

    async def get_tools(self, server_names: tuple[str, ...]) -> list[Any]:
        return []

    def status(self) -> list[Any]:
        return []

    async def call_tool(self, server: str, tool: str, arguments: dict[str, Any]) -> Any:
        self.calls.append((server, tool))
        handler = getattr(self, f"_{tool}", None)
        if handler is None:
            raise AssertionError(f"StubMCP has no handler for {server}.{tool}")
        return handler(arguments)

    # --------------------------------------------------------------- handlers
    def _get_identity(self, args: dict[str, Any]) -> dict[str, Any]:
        record = self.identities.get(args["employee_id"])
        if record is None:
            raise MCPToolError(f"404: no identity {args['employee_id']}")
        return record

    def _get_new_joiner(self, args: dict[str, Any]) -> dict[str, Any]:
        record = self.new_joiners.get(args["employee_id"])
        if record is None:
            raise MCPToolError(f"404: no new joiner {args['employee_id']}")
        return record

    def _create_identity(self, args: dict[str, Any]) -> dict[str, Any]:
        self.identities[args["employee_id"]] = {**args, "manager_id": ""}
        return self.identities[args["employee_id"]]

    def _update_identity(self, args: dict[str, Any]) -> dict[str, Any]:
        record = self.identities[args["employee_id"]]
        record.update({k: v for k, v in args.items() if k != "employee_id"})
        return record

    def _get_entitlement(self, args: dict[str, Any]) -> dict[str, Any]:
        for row in ENTITLEMENTS:
            if row["entitlement_id"] == args["entitlement_id"]:
                return row
        raise MCPToolError(f"404: no entitlement {args['entitlement_id']}")

    def _list_entitlements(self, args: dict[str, Any]) -> list[dict[str, Any]]:
        name = args.get("entitlement_name")
        if not name:
            return list(ENTITLEMENTS)
        return [r for r in ENTITLEMENTS if r["entitlement_name"].lower() == name.lower()]

    def _get_risk_score(self, args: dict[str, Any]) -> dict[str, Any]:
        for row in RISK_SCORES:
            if row["entitlement_name"] == args["entitlement_name"]:
                return row
        raise MCPToolError(f"404: no risk score for {args['entitlement_name']}")

    def _list_risk_scores(self, args: dict[str, Any]) -> list[dict[str, Any]]:
        return list(RISK_SCORES)

    def _list_policies(self, args: dict[str, Any]) -> list[dict[str, Any]]:
        wanted = args.get("type")
        return [p for p in POLICIES if not wanted or p["type"] == wanted]

    def _list_sod_rules(self, args: dict[str, Any]) -> list[dict[str, Any]]:
        name = (args.get("entitlement") or "").upper()
        if not name:
            return list(SOD_RULES)
        return [
            r
            for r in SOD_RULES
            if name in (r["entitlement_1"].upper(), r["entitlement_2"].upper())
        ]

    def _create_access_request(self, args: dict[str, Any]) -> dict[str, Any]:
        self._seq += 1
        request_id = f"REQ{self._seq:04d}"
        record = {
            **args,
            "request_id": request_id,
            "created_at": "2026-08-21T00:00:00+00:00",
            "decided_at": "",
            "granted_at": "",
            "decision_note": "",
        }
        self.requests[request_id] = record
        return record

    def _get_access_request(self, args: dict[str, Any]) -> dict[str, Any]:
        record = self.requests.get(args["request_id"])
        if record is None:
            raise MCPToolError(f"404: no request {args['request_id']}")
        return record

    def _update_access_request(self, args: dict[str, Any]) -> dict[str, Any]:
        record = self.requests[args["request_id"]]
        record.update({k: v for k, v in args.items() if k != "request_id"})
        return record

    def _list_access_requests(self, args: dict[str, Any]) -> list[dict[str, Any]]:
        rows = list(self.requests.values())
        for key in ("requester_id", "approver_id", "subject_id", "status"):
            if wanted := args.get(key):
                rows = [r for r in rows if str(r.get(key, "")).upper() == wanted.upper()]
        return rows


@pytest.fixture
def mcp() -> StubMCP:
    return StubMCP()


@pytest.fixture
def workflow_settings() -> Settings:
    return Settings(
        _env_file=None,
        google_genai_api_key="test-key",
        demo_employee_ids=["EMP001", "EMP002"],
        demo_hr_actor_id="HR001",
        provisioning_enabled=True,
        sod_conflict_requires_approval=True,
    )


@pytest.fixture
def services(mcp: StubMCP, workflow_settings: Settings) -> RequestService:
    directory = DirectoryService(tools=mcp)
    decisions = DecisionService(settings=workflow_settings, tools=mcp)
    provisioning = ProvisioningService(
        settings=workflow_settings, tools=mcp, directory=directory
    )
    return RequestService(
        settings=workflow_settings,
        tools=mcp,
        directory=directory,
        decisions=decisions,
        provisioning=provisioning,
    )


# ------------------------------------------------------------------- the rule


async def test_a_low_risk_entitlement_needs_no_approval(services: RequestService):
    _, verdict, approver = await services.analyze(
        "EMP002", entitlement_name="JIRA_USER"
    )
    assert verdict.approval_required is False
    assert approver == ""
    assert "risk score 5" in verdict.policy_basis


async def test_the_threshold_comes_from_policy_not_from_code(services: RequestService):
    """RSA_GRC scores exactly 70, which is where POL005 starts to bite."""
    _, verdict, approver = await services.analyze("EMP002", entitlement_name="RSA_GRC")
    assert verdict.approval_required is True
    assert "POL005" in verdict.policy_basis
    assert approver == "EMP001"


async def test_the_strictest_matching_policy_is_the_one_quoted(
    services: RequestService, mcp: StubMCP
):
    """A score tripping both POL005 and POL006 should cite POL006."""
    RISK_SCORES.append(
        {
            "entitlement_name": "UNSCORED_THING",
            "application": "Somewhere",
            "risk_score": 95,
            "risk_category": "Critical",
        }
    )
    try:
        _, verdict, _ = await services.analyze(
            "EMP002", entitlement_name="UNSCORED_THING"
        )
        assert "POL006" in verdict.policy_basis
    finally:
        RISK_SCORES.pop()


async def test_an_unscored_entitlement_requires_approval(services: RequestService):
    """Absence of a risk assessment is not an assessment of safety."""
    _, verdict, approver = await services.analyze(
        "EMP002", entitlement_name="UNSCORED_THING"
    )
    assert verdict.approval_required is True
    assert verdict.risk_score is None
    assert approver == "EMP001"


async def test_an_sod_conflict_escalates_an_otherwise_grantable_entitlement(
    services: RequestService,
):
    """EMP001 holds SAP_AP_INVOICE, which SOD002 pairs with AUDIT_TOOL."""
    _, verdict, _ = await services.analyze("EMP001", entitlement_name="AUDIT_TOOL")
    assert verdict.approval_required is True
    assert verdict.rendered_conflicts == "SOD002:SAP_AP_INVOICE"
    assert "separation of duties" in verdict.policy_basis


async def test_the_sod_escalation_can_be_switched_off(mcp: StubMCP):
    settings = Settings(
        _env_file=None,
        google_genai_api_key="test-key",
        sod_conflict_requires_approval=False,
    )
    directory = DirectoryService(tools=mcp)
    decisions = DecisionService(settings=settings, tools=mcp)
    # AUDIT_TOOL scores 75, so POL005 still applies — but the conflict must no
    # longer be the reason, and it must still be reported.
    subject = await directory.get_subject("EMP001")
    verdict = await decisions.evaluate(subject, entitlement_name="AUDIT_TOOL")
    assert verdict.sod_conflicts  # still surfaced
    assert "separation of duties" not in verdict.policy_basis


# ---------------------------------------------------------------- the workflow


async def test_no_approval_needed_means_granted_then_and_there(
    services: RequestService, mcp: StubMCP
):
    [record] = await services.raise_requests(
        requester_id="EMP002",
        requester_type=RequesterType.EMPLOYEE,
        subject_id="EMP002",
        entitlements=[{"entitlement_name": "JIRA_USER"}],
    )
    assert record.status is RequestStatus.AUTO_GRANTED
    assert record.granted_at
    assert "JIRA_USER" in mcp.identities["EMP002"]["entitlements"]


async def test_approval_needed_routes_to_the_manager_and_grants_nothing_yet(
    services: RequestService, mcp: StubMCP
):
    [record] = await services.raise_requests(
        requester_id="EMP002",
        requester_type=RequesterType.EMPLOYEE,
        subject_id="EMP002",
        entitlements=[{"entitlement_name": "RSA_GRC"}],
        justification="Quarterly risk reporting",
    )
    assert record.status is RequestStatus.PENDING_APPROVAL
    assert record.approver_id == "EMP001"
    assert "RSA_GRC" not in mcp.identities["EMP002"]["entitlements"]


async def test_approving_grants_the_access(services: RequestService, mcp: StubMCP):
    [raised] = await services.raise_requests(
        requester_id="EMP002",
        requester_type=RequesterType.EMPLOYEE,
        subject_id="EMP002",
        entitlements=[{"entitlement_name": "RSA_GRC"}],
    )
    decided = await services.approve(
        raised.request_id, approver_id="EMP001", note="Fine by me"
    )
    assert decided.status is RequestStatus.GRANTED
    assert decided.decided_at and decided.granted_at
    assert "RSA_GRC" in mcp.identities["EMP002"]["entitlements"]
    # The set is replaced wholesale on write; nothing may be lost doing so.
    assert "SAP_FIN_DISPLAY" in mcp.identities["EMP002"]["entitlements"]


async def test_rejecting_grants_nothing_and_carries_the_reason_back(
    services: RequestService, mcp: StubMCP
):
    [raised] = await services.raise_requests(
        requester_id="EMP002",
        requester_type=RequesterType.EMPLOYEE,
        subject_id="EMP002",
        entitlements=[{"entitlement_name": "RSA_GRC"}],
    )
    decided = await services.reject(
        raised.request_id, approver_id="EMP001", note="Not needed for your role"
    )
    assert decided.status is RequestStatus.REJECTED
    assert decided.decision_note == "Not needed for your role"
    assert "RSA_GRC" not in mcp.identities["EMP002"]["entitlements"]

    # The refusal is read back off the requester's own history.
    [seen] = await services.list_requests(requester_id="EMP002")
    assert seen.decision_note == "Not needed for your role"


async def test_only_the_named_approver_may_decide(services: RequestService):
    [raised] = await services.raise_requests(
        requester_id="EMP002",
        requester_type=RequesterType.EMPLOYEE,
        subject_id="EMP002",
        entitlements=[{"entitlement_name": "RSA_GRC"}],
    )
    with pytest.raises(NotApproverError):
        await services.approve(raised.request_id, approver_id="EMP002")


async def test_a_decided_request_cannot_be_decided_again(services: RequestService):
    [raised] = await services.raise_requests(
        requester_id="EMP002",
        requester_type=RequesterType.EMPLOYEE,
        subject_id="EMP002",
        entitlements=[{"entitlement_name": "RSA_GRC"}],
    )
    await services.reject(raised.request_id, approver_id="EMP001", note="No")
    with pytest.raises(WorkflowError, match="already rejected"):
        await services.approve(raised.request_id, approver_id="EMP001")


async def test_approval_with_nobody_to_approve_is_blocked_not_dropped(
    services: RequestService,
):
    """EMP001 has no manager, so an approval-needing request has nowhere to go."""
    [record] = await services.raise_requests(
        requester_id="EMP001",
        requester_type=RequesterType.EMPLOYEE,
        subject_id="EMP001",
        entitlements=[{"entitlement_name": "AUDIT_TOOL"}],
    )
    assert record.status is RequestStatus.BLOCKED_NO_APPROVER
    assert record.approver_id == ""


async def test_requesting_something_already_held_is_refused(services: RequestService):
    with pytest.raises(WorkflowError, match="already holds"):
        await services.raise_requests(
            requester_id="EMP002",
            requester_type=RequesterType.EMPLOYEE,
            subject_id="EMP002",
            entitlements=[{"entitlement_name": "POWERBI_FINANCE"}],
        )


# -------------------------------------------------------------------- HR mode


async def test_hr_granting_to_a_joiner_creates_their_identity_on_first_grant(
    services: RequestService, mcp: StubMCP
):
    """NJ1004 exists only as a joiner; a grant has nowhere to land without this."""
    assert "NJ1004" not in mcp.identities
    [record] = await services.raise_requests(
        requester_id="HR001",
        requester_type=RequesterType.HR,
        subject_id="NJ1004",
        entitlements=[{"entitlement_id": "ENT005"}],
    )
    assert record.status is RequestStatus.AUTO_GRANTED
    assert mcp.identities["NJ1004"]["entitlements"] == "JIRA_USER"
    assert mcp.identities["NJ1004"]["department"] == "Technology"


async def test_hr_approval_routes_to_the_joiners_manager(
    services: RequestService, mcp: StubMCP
):
    [record] = await services.raise_requests(
        requester_id="HR001",
        requester_type=RequesterType.HR,
        subject_id="NJ1004",
        entitlements=[{"entitlement_name": "RSA_GRC"}],
    )
    assert record.status is RequestStatus.PENDING_APPROVAL
    assert record.approver_id == "EMP002"  # NJ1004's manager in the joiner data


async def test_a_mixed_batch_is_judged_entitlement_by_entitlement(
    services: RequestService,
):
    """One item needing approval must not hold up the rest — this is HR's path."""
    records = await services.raise_requests(
        requester_id="HR001",
        requester_type=RequesterType.HR,
        subject_id="NJ1004",
        entitlements=[
            {"entitlement_name": "JIRA_USER"},
            {"entitlement_name": "RSA_GRC"},
        ],
    )
    assert [r.status for r in records] == [
        RequestStatus.AUTO_GRANTED,
        RequestStatus.PENDING_APPROVAL,
    ]


# ------------------------------------------------------------------- the rest


async def test_provisioning_can_be_switched_off_without_faking_success(mcp: StubMCP):
    settings = Settings(
        _env_file=None, google_genai_api_key="test-key", provisioning_enabled=False
    )
    directory = DirectoryService(tools=mcp)
    decisions = DecisionService(settings=settings, tools=mcp)
    service = RequestService(
        settings=settings,
        tools=mcp,
        directory=directory,
        decisions=decisions,
        provisioning=ProvisioningService(
            settings=settings, tools=mcp, directory=directory
        ),
    )
    [record] = await service.raise_requests(
        requester_id="EMP002",
        requester_type=RequesterType.EMPLOYEE,
        subject_id="EMP002",
        entitlements=[{"entitlement_name": "JIRA_USER"}],
    )
    assert "JIRA_USER" not in mcp.identities["EMP002"]["entitlements"]
    assert not record.granted_at
    assert "Provisioning is disabled" in record.decision_note


async def test_a_provisioning_failure_is_recorded_not_reported_as_success(
    services: RequestService, mcp: StubMCP, monkeypatch
):
    def explode(args):
        raise MCPToolError("identities API is down")

    [raised] = await services.raise_requests(
        requester_id="EMP002",
        requester_type=RequesterType.EMPLOYEE,
        subject_id="EMP002",
        entitlements=[{"entitlement_name": "RSA_GRC"}],
    )
    monkeypatch.setattr(mcp, "_update_identity", explode)
    decided = await services.approve(raised.request_id, approver_id="EMP001")
    assert decided.status is RequestStatus.PROVISIONING_FAILED
    assert "identities API is down" in decided.decision_note


async def test_the_managers_inbox_only_shows_what_waits_on_them(
    services: RequestService,
):
    await services.raise_requests(
        requester_id="EMP002",
        requester_type=RequesterType.EMPLOYEE,
        subject_id="EMP002",
        entitlements=[
            {"entitlement_name": "JIRA_USER"},  # auto-granted, not an approval
            {"entitlement_name": "RSA_GRC"},  # waits on EMP001
        ],
    )
    inbox = await services.list_requests(
        approver_id="EMP001", status=RequestStatus.PENDING_APPROVAL.value
    )
    assert [r.entitlement_name for r in inbox] == ["RSA_GRC"]
    assert await services.count_pending_for("EMP001") == 1
    assert await services.count_pending_for("EMP002") == 0


async def test_an_unknown_person_is_a_clear_404_not_a_crash(services: RequestService):
    with pytest.raises(RecordNotFoundError):
        await services.analyze("EMP999", entitlement_name="JIRA_USER")


async def test_personas_carry_the_live_approval_route_and_inbox_count(
    services: RequestService, mcp: StubMCP, workflow_settings: Settings
):
    await services.raise_requests(
        requester_id="EMP002",
        requester_type=RequesterType.EMPLOYEE,
        subject_id="EMP002",
        entitlements=[{"entitlement_name": "RSA_GRC"}],
    )
    personas = PersonaService(
        settings=workflow_settings,
        directory=DirectoryService(tools=mcp),
        requests=services,
    )
    listed = await personas.list_personas()
    assert [p.mode for p in listed] == ["hr", "employee", "employee"]
    by_id = {p.actor_id: p for p in listed}
    assert by_id["EMP002"].manager_id == "EMP001"
    assert by_id["EMP001"].pending_approvals == 1


async def test_an_actor_we_do_not_serve_is_refused(
    services: RequestService, mcp: StubMCP, workflow_settings: Settings
):
    """The only thing standing in for a login, so it is enforced, not assumed."""
    personas = PersonaService(
        settings=workflow_settings,
        directory=DirectoryService(tools=mcp),
        requests=services,
    )
    assert personas.require_known_actor("emp002") == "EMP002"
    with pytest.raises(RecordNotFoundError):
        personas.require_known_actor("EMP007")


async def test_the_catalog_labels_each_entitlement_with_its_verdict(
    services: RequestService, mcp: StubMCP, workflow_settings: Settings
):
    catalog = await DecisionService(
        settings=workflow_settings, tools=mcp
    ).catalog()
    by_name = {row["entitlement_name"]: row for row in catalog}
    assert by_name["JIRA_USER"]["approval_required"] is False
    assert by_name["RSA_GRC"]["approval_required"] is True
    assert by_name["UNSCORED_THING"]["approval_required"] is True


# ------------------------------------------------------- employee mode on chat


class StubRunner:
    """GraphRunner stand-in that records what the graph would have been given."""

    def __init__(self, existing_thread: bool = False) -> None:
        self.existing_thread = existing_thread
        self.seen: Any = None

    async def get_state(self, thread_id: str) -> dict[str, Any] | None:
        return {"values": {}} if self.existing_thread else None

    async def invoke(self, request):
        self.seen = request
        return {"messages": []}


def _run_request(**metadata):
    from app.domain.models import ChatMessage, RunRequest

    return RunRequest(
        messages=[ChatMessage(role="user", content="I need access to RSA Archer")],
        thread_id="t1",
        metadata=metadata,
    )


async def test_employee_mode_opens_the_thread_with_who_is_speaking(
    mcp: StubMCP, workflow_settings: Settings
):
    from app.services.chat_service import ChatService

    runner = StubRunner()
    service = ChatService(
        settings=workflow_settings,
        runner=runner,
        directory=DirectoryService(tools=mcp),
    )
    prepared = await service.prepare(_run_request(mode="employee", actor_id="EMP002"))

    assert prepared.messages[0].role == "system"
    context = prepared.messages[0].content
    assert "Sneha (EMP002)" in context
    assert "SAP_FIN_DISPLAY, POWERBI_FINANCE" in context
    assert "EMP001" in context  # their manager, so approvals have a route
    assert prepared.messages[1].content.startswith("I need access")


async def test_an_hr_run_is_left_exactly_as_it_arrived(
    mcp: StubMCP, workflow_settings: Settings
):
    """The HR output contract has clients depending on it; nothing may leak in."""
    from app.services.chat_service import ChatService

    service = ChatService(
        settings=workflow_settings,
        runner=StubRunner(),
        directory=DirectoryService(tools=mcp),
    )
    request = _run_request(surface="recommendation", employee_id="NJ1004")
    prepared = await service.prepare(request)
    assert [m.role for m in prepared.messages] == ["user"]


async def test_a_continuing_thread_is_not_re_briefed(
    mcp: StubMCP, workflow_settings: Settings
):
    from app.services.chat_service import ChatService

    service = ChatService(
        settings=workflow_settings,
        runner=StubRunner(existing_thread=True),
        directory=DirectoryService(tools=mcp),
    )
    prepared = await service.prepare(_run_request(mode="employee", actor_id="EMP002"))
    assert [m.role for m in prepared.messages] == ["user"]


async def test_an_employee_with_no_manager_is_described_as_such(
    mcp: StubMCP, workflow_settings: Settings
):
    """EMP001 has nobody above them, and the model must be told rather than guess."""
    from app.services.chat_service import ChatService

    service = ChatService(
        settings=workflow_settings,
        runner=StubRunner(),
        directory=DirectoryService(tools=mcp),
    )
    prepared = await service.prepare(_run_request(mode="employee", actor_id="EMP001"))
    assert "nobody on record" in prepared.messages[0].content


async def test_employee_mode_without_an_actor_is_ignored_not_guessed(
    mcp: StubMCP, workflow_settings: Settings
):
    from app.services.chat_service import ChatService

    service = ChatService(
        settings=workflow_settings,
        runner=StubRunner(),
        directory=DirectoryService(tools=mcp),
    )
    prepared = await service.prepare(_run_request(mode="employee"))
    assert [m.role for m in prepared.messages] == ["user"]


def test_the_policy_rule_parser_matches_the_deployed_rule_text():
    """Guards the one regex the approval decision hangs on."""
    from app.services.decision_service import RISK_RULE

    assert RISK_RULE.search("risk_score >= 70").group(2) == "70"
    assert RISK_RULE.search("risk_score>=90").group(2) == "90"
    assert RISK_RULE.search("Risk_Score > 50").group(1) == ">"
    assert RISK_RULE.search("affinity_score >= 70") is None
    assert isinstance(RISK_RULE, re.Pattern)
