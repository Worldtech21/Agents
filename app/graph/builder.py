"""Graph assembly — the composition point for the agent layer."""

from __future__ import annotations

from typing import Any

from app.agents.factory import ReactAgentFactory
from app.agents.supervisor import SupervisorFactory
from app.core.config import Settings
from app.core.logging import get_logger
from app.domain.models import AgentInfo, AgentSpec
from app.domain.ports import CheckpointerFactory

logger = get_logger(__name__)


class GraphBuilder:
    """Builds workers, wires them under a supervisor, and compiles the result."""

    def __init__(
        self,
        *,
        settings: Settings,
        agent_factory: ReactAgentFactory,
        supervisor_factory: SupervisorFactory,
        checkpointer_factory: CheckpointerFactory,
        specs: tuple[AgentSpec, ...],
    ) -> None:
        self._settings = settings
        self._agent_factory = agent_factory
        self._supervisor_factory = supervisor_factory
        self._checkpointer_factory = checkpointer_factory
        self._specs = specs

    async def build(self) -> tuple[Any, dict[str, AgentInfo]]:
        """Compile the supervisor graph. Returns the graph and agent metadata."""
        agents = await self._agent_factory.build_all(self._specs)
        state_graph = self._supervisor_factory.build(agents, self._specs)

        checkpointer = self._checkpointer_factory.create()
        compiled = state_graph.compile(checkpointer=checkpointer)
        compiled.name = "supervisor_graph"

        logger.info("Compiled supervisor graph with %d worker(s)", len(agents))
        return compiled, self._agent_factory.built_agents

    @property
    def specs(self) -> tuple[AgentSpec, ...]:
        return self._specs
