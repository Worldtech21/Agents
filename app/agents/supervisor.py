"""Supervisor construction.

The supervisor is itself an LLM agent: it holds handoff tools (one per worker),
picks a delegate, and writes the final answer.  ``langgraph-supervisor`` builds
the routing graph; this module owns the configuration of it.
"""

from __future__ import annotations

from typing import Any

from langgraph_supervisor import create_supervisor

from app.agents.hooks import make_progress_hook
from app.agents.prompts import build_supervisor_prompt
from app.agents.specs import describe_team
from app.core.config import Settings
from app.core.logging import get_logger
from app.domain.models import AgentSpec
from app.domain.ports import ChatModelProvider

logger = get_logger(__name__)

SUPERVISOR_NAME = "supervisor"


class SupervisorFactory:
    """Assembles worker agents into a supervisor graph."""

    def __init__(self, *, settings: Settings, model_provider: ChatModelProvider) -> None:
        self._settings = settings
        self._model_provider = model_provider

    def build(self, agents: list[Any], specs: tuple[AgentSpec, ...]) -> Any:
        """Return an *uncompiled* ``StateGraph`` wiring the supervisor to *agents*."""
        # The supervisor can run on a different vendor than the workers — routing
        # is a light task, so a cheaper/faster provider often suffices.
        model = self._model_provider.get_model(
            model=self._settings.supervisor_model,
            provider=self._settings.supervisor_provider,
        )

        graph = create_supervisor(
            agents,
            model=model,
            prompt=build_supervisor_prompt(describe_team(specs)),
            supervisor_name=SUPERVISOR_NAME,
            # Keeps the `custom` stream mode live on every run, including runs
            # where the supervisor answers directly without delegating.
            pre_model_hook=make_progress_hook(SUPERVISOR_NAME),
            # `last_message` keeps the supervisor's context small: it sees each
            # worker's conclusion, not the worker's full tool transcript.
            output_mode=self._settings.graph_supervisor_output_mode,
            # Sequential delegation. Set True only if workers are genuinely
            # independent — parallel handoffs interleave in shared state.
            parallel_tool_calls=True,
            add_handoff_messages=True,
            add_handoff_back_messages=True,
            # Prefixes each worker's output with its name so the supervisor can
            # attribute findings correctly.
            include_agent_name="inline",
        )
        logger.info(
            "Built supervisor on %s/%s over %d agent(s): %s",
            self._settings.supervisor_provider,
            self._settings.supervisor_model,
            len(agents),
            ", ".join(spec.name for spec in specs),
        )
        return graph
