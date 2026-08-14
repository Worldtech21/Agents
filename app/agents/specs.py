"""The agent roster, defined as data.

Adding a fourth worker is one entry here plus one MCP URL in ``.env``; no other
module changes.  ``mcp_servers`` names must match the server keys produced by
``Settings.mcp_server_settings()``.
"""

from __future__ import annotations

from app.agents.prompts import (
    AUTOMATION_AGENT_PROMPT,
    KNOWLEDGE_AGENT_PROMPT,
    RESEARCH_AGENT_PROMPT,
)
from app.domain.models import AgentSpec

RESEARCH_AGENT = AgentSpec(
    name="research_agent",
    title="Research agent",
    description=(
        "Gathers external information — web sources, public data, third-party "
        "APIs — and reports findings with citations."
    ),
    prompt=RESEARCH_AGENT_PROMPT,
    mcp_servers=("research",),
)

KNOWLEDGE_AGENT = AgentSpec(
    name="knowledge_agent",
    title="Knowledge agent",
    description=(
        "Answers questions from internal documents, records, and databases, "
        "citing the specific records used."
    ),
    prompt=KNOWLEDGE_AGENT_PROMPT,
    mcp_servers=("knowledge",),
)

AUTOMATION_AGENT = AgentSpec(
    name="automation_agent",
    title="Automation agent",
    description=(
        "Executes actions in external systems — creating, updating, and "
        "triggering workflows — and reports the outcome."
    ),
    prompt=AUTOMATION_AGENT_PROMPT,
    mcp_servers=("automation",),
)

#: Registration order is the order the supervisor sees the roster in.
DEFAULT_AGENT_SPECS: tuple[AgentSpec, ...] = (
    RESEARCH_AGENT,
    KNOWLEDGE_AGENT,
    AUTOMATION_AGENT,
)


def describe_team(specs: tuple[AgentSpec, ...]) -> str:
    """Render the roster as the bullet list injected into the supervisor prompt."""
    return "\n".join(f"- `{spec.name}` — {spec.handoff_description}" for spec in specs)
