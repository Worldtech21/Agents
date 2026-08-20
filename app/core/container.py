"""Composition root.

Every concrete adapter is chosen here and nowhere else.  The API layer receives
already-wired services; it never constructs an LLM client, an MCP client, or a
graph.  That is what keeps the dependency arrows pointing inward.
"""

from __future__ import annotations

from typing import Any

from app.agents.factory import ReactAgentFactory
from app.agents.specs import DEFAULT_AGENT_SPECS
from app.agents.supervisor import SupervisorFactory
from app.core.config import Settings
from app.core.exceptions import GraphNotReadyError
from app.core.logging import get_logger
from app.domain.models import AgentInfo, AgentSpec
from app.domain.ports import ChatModelProvider, ToolProvider
from app.graph.builder import GraphBuilder
from app.graph.runner import GraphRunner
from app.infrastructure.checkpoint.factory import CheckpointerFactoryImpl
from app.infrastructure.llm.factory import LLMFactory
from app.infrastructure.mcp.client import MCPToolProvider
from app.services.agent_service import AgentService
from app.services.chat_service import ChatService

logger = get_logger(__name__)


class ApplicationContainer:
    """Owns the object graph and its lifecycle."""

    def __init__(
        self,
        settings: Settings,
        specs: tuple[AgentSpec, ...] | None = None,
        *,
        model_provider: ChatModelProvider | None = None,
        tool_provider: ToolProvider | None = None,
    ) -> None:
        """Wire the object graph.

        ``model_provider`` / ``tool_provider`` exist as an injection seam: tests
        pass fakes so the whole stack can run without an API key or a live MCP
        server. Production always uses the defaults.
        """
        self.settings = settings
        self.specs = specs or DEFAULT_AGENT_SPECS

        # LLMFactory serves whichever vendor `LLM_PROVIDER` names, so switching
        # providers is a configuration change, not a code change.
        self.model_provider = model_provider or LLMFactory(settings)
        self.tool_provider = tool_provider or MCPToolProvider(settings)
        self.checkpointer_factory = CheckpointerFactoryImpl(settings)

        self.agent_factory = ReactAgentFactory(
            settings=settings,
            model_provider=self.model_provider,
            tool_provider=self.tool_provider,
        )
        self.supervisor_factory = SupervisorFactory(
            settings=settings, model_provider=self.model_provider
        )
        self.graph_builder = GraphBuilder(
            settings=settings,
            agent_factory=self.agent_factory,
            supervisor_factory=self.supervisor_factory,
            checkpointer_factory=self.checkpointer_factory,
            specs=self.specs,
        )

        self._graph: Any | None = None
        self._agent_info: dict[str, AgentInfo] = {}
        self._runner: GraphRunner | None = None
        self._chat_service: ChatService | None = None
        self._agent_service: AgentService | None = None
        self._startup_error: str | None = None

    # ---------------------------------------------------------------- lifecycle
    async def startup(self) -> None:
        """Connect to MCP, build the graph, and expose the services."""
        await self.tool_provider.startup()
        try:
            self._graph, self._agent_info = await self.graph_builder.build()
        except Exception as exc:  # noqa: BLE001 - keep /health serving so the
            # cause is diagnosable instead of the process crash-looping.
            self._startup_error = f"{type(exc).__name__}: {exc}"
            logger.exception("Failed to build the agent graph")
            return

        self._runner = GraphRunner(settings=self.settings, graph=self._graph)
        self._chat_service = ChatService(settings=self.settings, runner=self._runner)
        self._agent_service = AgentService(
            settings=self.settings,
            specs=self.specs,
            agent_info=self._agent_info,
            tool_provider=self.tool_provider,
        )
        logger.info("Application container ready")

    async def shutdown(self) -> None:
        await self.tool_provider.shutdown()
        self._graph = None
        self._runner = None
        self._chat_service = None
        self._agent_service = None
        logger.info("Application container shut down")

    # ----------------------------------------------------------------- accessors
    @property
    def is_ready(self) -> bool:
        return self._chat_service is not None

    @property
    def startup_error(self) -> str | None:
        return self._startup_error

    @property
    def chat_service(self) -> ChatService:
        if self._chat_service is None:
            raise GraphNotReadyError(
                "The agent graph is not available.",
                details={"reason": self._startup_error or "startup has not completed"},
            )
        return self._chat_service

    @property
    def agent_service(self) -> AgentService:
        if self._agent_service is None:
            raise GraphNotReadyError(
                "The agent graph is not available.",
                details={"reason": self._startup_error or "startup has not completed"},
            )
        return self._agent_service

    @property
    def graph(self) -> Any:
        if self._graph is None:
            raise GraphNotReadyError("The agent graph is not available.")
        return self._graph