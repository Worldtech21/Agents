"""MCP tool adapter implementing :class:`ToolProvider`.

Wraps ``MultiServerMCPClient`` with three behaviours the rest of the app relies
on:

1. **Lazy, cached discovery.**  Tools are fetched once per server at startup and
   reused; agents never pay a round-trip per build.
2. **Graceful degradation.**  A server whose URL is still a placeholder — or
   which is simply down — is skipped with a warning instead of taking the whole
   API down.  Set ``MCP_REQUIRED=true`` to make failures fatal instead.
3. **Per-server grouping.**  Each agent asks for the servers named in its spec
   and gets exactly those tools.
"""

from __future__ import annotations

import asyncio
from typing import Any

from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient

from app.core.config import Settings
from app.core.exceptions import MCPConnectionError
from app.core.logging import get_logger
from app.domain.models import MCPServerSpec, MCPServerStatus

logger = get_logger(__name__)


class MCPToolProvider:
    """Discovers and caches MCP tools across several servers."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._specs: dict[str, MCPServerSpec] = {
            name: MCPServerSpec(
                name=name,
                url=raw.get("url"),
                transport=raw.get("transport", "streamable_http"),
                headers=raw.get("headers", {}) or {},
                extra={
                    k: v
                    for k, v in raw.items()
                    if k not in {"url", "transport", "headers"}
                },
            )
            for name, raw in settings.mcp_server_settings().items()
        }
        self._client: MultiServerMCPClient | None = None
        self._tools: dict[str, list[BaseTool]] = {}
        self._errors: dict[str, str] = {}
        self._lock = asyncio.Lock()
        self._started = False

    # ---------------------------------------------------------------- lifecycle
    async def startup(self) -> None:
        """Connect to every configured server and cache its tool list."""
        async with self._lock:
            if self._started:
                return
            self._started = True

            if not self._specs:
                logger.warning(
                    "No MCP servers configured — agents will run with zero MCP tools. "
                    "Set MCP_RESEARCH_URL / MCP_KNOWLEDGE_URL / MCP_AUTOMATION_URL "
                    "in your .env to wire them up."
                )
                return

            connections = {
                name: spec.to_connection() for name, spec in self._specs.items()
            }
            self._client = MultiServerMCPClient(connections)

            results = await asyncio.gather(
                *(self._load_server(name) for name in self._specs),
                return_exceptions=True,
            )
            failures = [r for r in results if isinstance(r, BaseException)]
            if failures and self._settings.mcp_required:
                raise MCPConnectionError(
                    "One or more required MCP servers failed to connect.",
                    details={"errors": self._errors},
                )

    async def _load_server(self, name: str) -> None:
        assert self._client is not None
        try:
            tools = await asyncio.wait_for(
                self._client.get_tools(server_name=name),
                timeout=self._settings.mcp_connect_timeout_seconds,
            )
        except Exception as exc:  # noqa: BLE001 - one bad server must not fail the rest
            message = _describe(exc)
            self._errors[name] = message
            self._tools[name] = []
            logger.warning(
                "MCP server '%s' unavailable — its agent will run without those tools (%s)",
                name,
                message,
            )
            if self._settings.mcp_required:
                raise
            return

        self._tools[name] = list(tools)
        self._errors.pop(name, None)
        logger.info(
            "Connected to MCP server '%s' (%d tools: %s)",
            name,
            len(tools),
            ", ".join(t.name for t in tools) or "none",
        )

    async def shutdown(self) -> None:
        async with self._lock:
            self._client = None
            self._tools.clear()
            self._started = False

    # ------------------------------------------------------------------ queries
    async def get_tools(self, server_names: tuple[str, ...]) -> list[BaseTool]:
        """Return the union of tools exposed by *server_names*, de-duplicated."""
        if not self._started:
            await self.startup()

        collected: list[BaseTool] = []
        seen: set[str] = set()
        for name in server_names:
            if name not in self._specs:
                logger.warning(
                    "Agent references MCP server '%s', which is not configured.", name
                )
                continue
            for tool in self._tools.get(name, []):
                if tool.name in seen:
                    continue
                seen.add(tool.name)
                collected.append(tool)
        return collected

    def status(self) -> list[MCPServerStatus]:
        statuses: list[MCPServerStatus] = []
        for name, spec in self._specs.items():
            statuses.append(
                MCPServerStatus(
                    name=name,
                    configured=True,
                    connected=name in self._tools and name not in self._errors,
                    transport=spec.transport,
                    tool_count=len(self._tools.get(name, [])),
                    error=self._errors.get(name),
                )
            )
        return statuses

    @property
    def configured_servers(self) -> tuple[str, ...]:
        return tuple(self._specs)


def _describe(exc: BaseException, _depth: int = 0) -> str:
    """Render an exception usefully, unwrapping ExceptionGroups.

    The MCP transport wraps connection failures in an anyio TaskGroup, so the
    surface exception is an unhelpful ``ExceptionGroup: unhandled errors in a
    TaskGroup``. Callers need the actual cause (connection refused, 401, ...).
    """
    if isinstance(exc, BaseExceptionGroup) and _depth < 5:
        inner = "; ".join(_describe(e, _depth + 1) for e in exc.exceptions)
        return inner or f"{type(exc).__name__}: {exc}"
    if isinstance(exc, TimeoutError):
        return "TimeoutError: connection timed out"
    text = str(exc).strip()
    return f"{type(exc).__name__}: {text}" if text else type(exc).__name__


class NullToolProvider:
    """No-op provider — useful in tests and for running without MCP at all."""

    async def startup(self) -> None:  # noqa: D102
        return None

    async def shutdown(self) -> None:  # noqa: D102
        return None

    async def get_tools(self, server_names: tuple[str, ...]) -> list[Any]:  # noqa: D102
        return []

    def status(self) -> list[MCPServerStatus]:  # noqa: D102
        return []
