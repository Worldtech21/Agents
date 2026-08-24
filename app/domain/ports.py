"""Ports — the interfaces the inner layers depend on.

Infrastructure supplies concrete adapters for each of these Protocols.  Because
services depend on the Protocol rather than the adapter, swapping Gemini for
another provider, or MCP for a local tool registry, is a one-file change.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from app.domain.models import AgentSpec, MCPServerStatus


@runtime_checkable
class ChatModelProvider(Protocol):
    """Supplies configured chat models to the agent layer."""

    def get_model(
        self, *, model: str | None = None, provider: str | None = None, **overrides: Any
    ) -> Any:
        """Return a LangChain ``BaseChatModel`` ready to bind tools to.

        ``provider`` selects a registered vendor adapter; when omitted the
        configured default (``LLM_PROVIDER``) is used.
        """
        ...


@runtime_checkable
class ToolProvider(Protocol):
    """Supplies tools, grouped by logical server name."""

    async def startup(self) -> None:
        """Establish connections and warm any caches."""
        ...

    async def shutdown(self) -> None:
        """Release connections."""
        ...

    async def get_tools(self, server_names: tuple[str, ...]) -> list[Any]:
        """Return every tool exposed by the named servers."""
        ...

    async def call_tool(self, server: str, tool: str, arguments: dict[str, Any]) -> Any:
        """Invoke one tool directly, with no LLM in the loop.

        The agents reach tools through a model that chooses them; the workflow
        services reach them through here, so a grant or an approval is an
        ordinary function call rather than something a model decided to do.
        """
        ...

    def status(self) -> list[MCPServerStatus]:
        """Report per-server connectivity for health checks."""
        ...


@runtime_checkable
class AgentBuilder(Protocol):
    """Turns an :class:`AgentSpec` into an executable graph node."""

    async def build(self, spec: AgentSpec) -> Any:
        ...


@runtime_checkable
class CheckpointerFactory(Protocol):
    """Creates the persistence layer for graph state."""

    def create(self) -> Any | None:
        ...
