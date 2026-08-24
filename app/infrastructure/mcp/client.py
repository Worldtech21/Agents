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
4. **Self-healing.**  A server that failed is retried on the next call once
   ``MCP_RETRY_AFTER_SECONDS`` has passed, so a server that comes back up is
   picked up without restarting the API.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient

from app.core.config import Settings
from app.core.exceptions import MCPConnectionError, MCPToolError
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
        #: Monotonic timestamp of the last failed load, per server. Without it a
        #: retry would fire on every call — and since each one waits up to
        #: ``mcp_connect_timeout_seconds``, a polled endpoint would stall on a
        #: server that is simply down instead of failing fast off the error.
        self._failed_at: dict[str, float] = {}
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
            self._failed_at[name] = time.monotonic()
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
        self._failed_at.pop(name, None)
        logger.info(
            "Connected to MCP server '%s' (%d tools: %s)",
            name,
            len(tools),
            ", ".join(t.name for t in tools) or "none",
        )

    async def _retry_if_due(self, name: str) -> None:
        """Reconnect to a previously failed *name*, at most once per cooldown.

        A server that was down at startup would otherwise stay written off for
        the life of the process: ``_load_server`` only ever runs from
        ``startup``, which is guarded by ``_started``. Bringing the server back
        would then need an API restart, which is a poor answer to an upstream
        that fixed itself.
        """
        failed_at = self._failed_at.get(name)
        if failed_at is None:
            return
        if time.monotonic() - failed_at < self._settings.mcp_retry_after_seconds:
            return

        async with self._lock:
            # Another caller may have reconnected while we waited for the lock.
            if self._failed_at.get(name) != failed_at or self._client is None:
                return
            logger.info("Retrying MCP server '%s' after an earlier failure.", name)
            try:
                await self._load_server(name)
            except Exception:  # noqa: BLE001 - _load_server already recorded it
                pass

    async def shutdown(self) -> None:
        async with self._lock:
            self._client = None
            self._tools.clear()
            self._errors.clear()
            self._failed_at.clear()
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
            await self._retry_if_due(name)
            for tool in self._tools.get(name, []):
                if tool.name in seen:
                    continue
                seen.add(tool.name)
                collected.append(tool)
        return collected

    async def call_tool(self, server: str, tool: str, arguments: dict[str, Any]) -> Any:
        """Invoke one tool on *server* directly and return its decoded result.

        This is the workflow layer's door into MCP.  Agents get tools handed to a
        model, which then chooses among them; the approval and provisioning
        services call through here instead, so granting access is an ordinary
        function call rather than something a model decided to do.

        Arguments whose value is ``None`` are dropped: the upstream APIs treat a
        field as "leave unchanged" only when it is absent, and as "set to null"
        when it is present.
        """
        if not self._started:
            await self.startup()

        if server not in self._specs:
            raise MCPConnectionError(
                f"MCP server '{server}' is not configured.",
                details={"server": server, "tool": tool},
            )
        await self._retry_if_due(server)
        if error := self._errors.get(server):
            raise MCPConnectionError(
                f"MCP server '{server}' is not connected.",
                details={"server": server, "tool": tool, "error": error},
            )

        found = next((t for t in self._tools.get(server, []) if t.name == tool), None)
        if found is None:
            raise MCPToolError(
                f"MCP server '{server}' exposes no tool named '{tool}'.",
                details={
                    "server": server,
                    "tool": tool,
                    "available": [t.name for t in self._tools.get(server, [])],
                },
            )

        payload = {k: v for k, v in arguments.items() if v is not None}
        try:
            result = await found.ainvoke(payload)
        except Exception as exc:  # noqa: BLE001 - surfaced as a typed app error
            message = _describe(exc)
            logger.warning("MCP tool %s.%s failed: %s", server, tool, message)
            raise MCPToolError(
                f"{server}.{tool} failed: {message}",
                details={"server": server, "tool": tool, "arguments": payload},
            ) from exc

        return _decode(result)

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


def _decode(result: Any) -> Any:
    """Turn an MCP tool result into Python data.

    ``ainvoke`` hands back whatever the adapter made of the content blocks: a
    JSON string for these servers, occasionally a one-element list of blocks.
    Anything that does not parse as JSON is returned as-is — a tool is entitled
    to answer with plain text.
    """
    if isinstance(result, list) and len(result) == 1:
        result = result[0]
    if isinstance(result, dict) and "text" in result:
        result = result["text"]
    if isinstance(result, str):
        try:
            return json.loads(result)
        except json.JSONDecodeError:
            return result
    return result


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

    async def call_tool(  # noqa: D102
        self, server: str, tool: str, arguments: dict[str, Any]
    ) -> Any:
        raise MCPConnectionError(
            "No MCP servers are configured.",
            details={"server": server, "tool": tool},
        )

    def status(self) -> list[MCPServerStatus]:  # noqa: D102
        return []
