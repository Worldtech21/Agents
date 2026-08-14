"""Builds ReAct worker agents from specs.

One factory serves every worker: the differences between agents live entirely in
their :class:`AgentSpec`.
"""

from __future__ import annotations

from typing import Any

from langgraph.prebuilt import create_react_agent

from app.agents.hooks import make_progress_hook
from app.core.config import Settings
from app.core.logging import get_logger
from app.domain.models import AgentInfo, AgentSpec
from app.domain.ports import ChatModelProvider, ToolProvider

logger = get_logger(__name__)


class ReactAgentFactory:
    """Turns an :class:`AgentSpec` into a compiled ReAct graph."""

    def __init__(
        self,
        *,
        settings: Settings,
        model_provider: ChatModelProvider,
        tool_provider: ToolProvider,
    ) -> None:
        self._settings = settings
        self._model_provider = model_provider
        self._tool_provider = tool_provider
        self._built: dict[str, AgentInfo] = {}

    async def build(self, spec: AgentSpec) -> Any:
        """Resolve the spec's tools and compile its ReAct agent."""
        tools = await self._tool_provider.get_tools(spec.mcp_servers)
        model_name = spec.model or self._settings.llm_model
        model = self._model_provider.get_model(model=model_name)

        agent = create_react_agent(
            model=model,
            tools=tools,
            prompt=spec.prompt,
            # `name` is what the supervisor's handoff tools address, so it must
            # match AgentSpec.name exactly.
            name=spec.name,
            # Emits onto the `custom` stream mode. Without a writer somewhere in
            # the graph that channel stays permanently silent.
            pre_model_hook=make_progress_hook(spec.name),
        )

        self._built[spec.name] = AgentInfo(
            name=spec.name,
            title=spec.title,
            description=spec.description,
            mcp_servers=spec.mcp_servers,
            tools=tuple(tool.name for tool in tools),
            model=model_name,
        )
        logger.info(
            "Built agent '%s' with %d MCP tool(s) from %s",
            spec.name,
            len(tools),
            ", ".join(spec.mcp_servers) or "no servers",
        )
        return agent

    async def build_all(self, specs: tuple[AgentSpec, ...]) -> list[Any]:
        return [await self.build(spec) for spec in specs]

    @property
    def built_agents(self) -> dict[str, AgentInfo]:
        return dict(self._built)
