"""The agent roster, defined as data.

Adding a fourth worker is one entry here plus one MCP URL in ``.env``; no other
module changes.  ``mcp_servers`` names must match the server keys produced by
``Settings.mcp_server_settings()``.  Every worker here is read-only; see
``app/agents/prompts.py``.
"""

from __future__ import annotations

from app.agents.prompts import (
    NEW_JOINER_AGENT_PROMPT,
    IDENTITIES_AGENT_PROMPT,
    PEER_AFFINITY_AGENT_PROMPT,
    SOD_TEST_AGENT_PROMPT,
    POLICY_AGENT_PROMPT,
    ENTITILEMENTS_AGENT_PROMPT,
)
from app.domain.models import AgentSpec

NEW_JOINERS_AGENT = AgentSpec(
    name="new_joiners_agent",
    title="New Joiners agent",
    description=(
        "Looks up new hires and their joining attributes — department, job "
        "role, level, location, manager and cost center — by employee_id."
    ),
    prompt=NEW_JOINER_AGENT_PROMPT,
    mcp_servers=("new_joiners_mcp",),
)

IDENTITIES_AGENT = AgentSpec(
    name="identities_agent",
    title="Identities agent",
    description=(
        "Looks up identity records — status, lifecycle dates, linked "
        "downstream accounts, manager and department — by any identifier."
    ),
    prompt=IDENTITIES_AGENT_PROMPT,
    mcp_servers=("identities_mcp",),
)

PEER_AFFINITY_AGENT = AgentSpec(
    name="peer_affinity_agent",
    title="Peer Affinity agent",
    description=(
        "Reads the peer group for a person and reports what those peers "
        "hold in common, with the counts behind each proportion."
    ),
    prompt=PEER_AFFINITY_AGENT_PROMPT,
    mcp_servers=("peer_affinity_mcp",),
)

SOD_TEST_AGENT = AgentSpec(
    name="sod_test_agent",
    title="SOD Test agent",
    description=(
        "Runs separation-of-duties checks over a combination of "
        "entitlements and reports the rules it breaks, with severity."
    ),
    prompt=SOD_TEST_AGENT_PROMPT,
    mcp_servers=("sod_test_mcp",),
)

POLICY_AGENT = AgentSpec(
    name="policy_agent",
    title="Policy agent",
    description=(
        "Retrieves access policies — eligibility, approval requirements and "
        "certification cadence — and quotes the clause that applies."
    ),
    prompt=POLICY_AGENT_PROMPT,
    mcp_servers=("policy_mcp",),
)

ENTITILEMENTS_AGENT = AgentSpec(
    name="entitlements_agent",
    title="Entitlements agent",
    description=(
        "Looks up entitlements — owning application, owner, risk rating and "
        "current holders — by entitlement id or display name."
    ),
    prompt=ENTITILEMENTS_AGENT_PROMPT,
    mcp_servers=("entitlements_mcp",),
)

#: Registration order is the order the supervisor sees the roster in.
DEFAULT_AGENT_SPECS: tuple[AgentSpec, ...] = (
    NEW_JOINERS_AGENT,
    ENTITILEMENTS_AGENT,
    POLICY_AGENT,
    SOD_TEST_AGENT,
    PEER_AFFINITY_AGENT,
    IDENTITIES_AGENT,

)


def describe_team(specs: tuple[AgentSpec, ...]) -> str:
    """Render the roster as the bullet list injected into the supervisor prompt."""
    return "\n".join(f"- `{spec.name}` — {spec.handoff_description}" for spec in specs)
