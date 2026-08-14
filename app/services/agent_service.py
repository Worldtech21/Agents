"""Application service for introspecting the agent topology."""

from __future__ import annotations

from app.core.config import Settings
from app.core.exceptions import AgentNotFoundError
from app.domain.models import AgentInfo, AgentSpec, MCPServerStatus
from app.domain.ports import ToolProvider


class AgentService:
    """Read-only views over the configured roster and its MCP wiring."""

    def __init__(
        self,
        *,
        settings: Settings,
        specs: tuple[AgentSpec, ...],
        agent_info: dict[str, AgentInfo],
        tool_provider: ToolProvider,
    ) -> None:
        self._settings = settings
        self._specs = specs
        self._agent_info = agent_info
        self._tool_provider = tool_provider

    def list_agents(self) -> list[AgentInfo]:
        return [
            self._agent_info.get(spec.name, self._fallback(spec)) for spec in self._specs
        ]

    def get_agent(self, name: str) -> AgentInfo:
        info = self._agent_info.get(name)
        if info is not None:
            return info
        for spec in self._specs:
            if spec.name == name:
                return self._fallback(spec)
        raise AgentNotFoundError(
            f"No agent named '{name}'.",
            details={"available": [spec.name for spec in self._specs]},
        )

    def mcp_status(self) -> list[MCPServerStatus]:
        return self._tool_provider.status()

    def _fallback(self, spec: AgentSpec) -> AgentInfo:
        """Metadata for an agent that was declared but never built."""
        return AgentInfo(
            name=spec.name,
            title=spec.title,
            description=spec.description,
            mcp_servers=spec.mcp_servers,
            tools=(),
            model=spec.model or self._settings.llm_model,
        )
