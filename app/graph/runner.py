"""Execution surface over the compiled graph.

Exposes the three ways to run it:

* :meth:`GraphRunner.invoke` — await the final state.
* :meth:`GraphRunner.stream_graph` — ``astream`` across *every* stream mode.
* :meth:`GraphRunner.stream_events` — ``astream_events`` v2, the full callback
  taxonomy (model tokens, tool starts/ends, chain spans, retriever calls).

Together the two streaming methods cover everything LangGraph exposes.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from langgraph.errors import GraphRecursionError

from app.core.config import Settings
from app.core.exceptions import (
    GraphExecutionError,
    GraphNotReadyError,
    RecursionLimitError,
)
from app.core.logging import get_logger
from app.domain.models import RunRequest, StreamEnvelope
from app.infrastructure.streaming.normalizer import (
    KNOWN_STREAM_MODES,
    StreamNormalizer,
)

logger = get_logger(__name__)


class GraphRunner:
    """Runs a compiled LangGraph and normalises everything it emits."""

    def __init__(self, *, settings: Settings, graph: Any) -> None:
        self._settings = settings
        self._graph = graph

    # ------------------------------------------------------------------ config
    def _config(self, request: RunRequest) -> dict[str, Any]:
        return {
            "configurable": {"thread_id": request.thread_id},
            "recursion_limit": request.recursion_limit
            or self._settings.graph_recursion_limit,
            "metadata": {"thread_id": request.thread_id, **request.metadata},
        }

    def _resolve_modes(self, request: RunRequest) -> list[str]:
        """Pick the stream modes for a run, dropping anything unsupported."""
        requested = request.stream_modes or self._settings.graph_stream_modes
        modes = [mode for mode in requested if mode in KNOWN_STREAM_MODES]
        unknown = sorted(set(requested) - KNOWN_STREAM_MODES)
        if unknown:
            logger.warning("Ignoring unsupported stream mode(s): %s", ", ".join(unknown))
        return modes or ["values"]

    def _require_graph(self) -> Any:
        if self._graph is None:  # pragma: no cover - defensive
            raise GraphNotReadyError("The agent graph has not been built yet.")
        return self._graph

    # ------------------------------------------------------------------ invoke
    async def invoke(self, request: RunRequest) -> dict[str, Any]:
        """Run to completion and return the final graph state."""
        graph = self._require_graph()
        try:
            return await graph.ainvoke(request.to_graph_input(), config=self._config(request))
        except GraphRecursionError as exc:
            raise RecursionLimitError(
                "The agents exceeded the configured recursion limit before finishing.",
                details={"recursion_limit": self._config(request)["recursion_limit"]},
            ) from exc
        except Exception as exc:  # noqa: BLE001 - normalised for the API layer
            raise GraphExecutionError(f"Graph execution failed: {exc}") from exc

    # ------------------------------------------------------------ graph stream
    async def stream_graph(self, request: RunRequest) -> AsyncIterator[StreamEnvelope]:
        """Stream every LangGraph state-stream mode for this run.

        Emitted with ``subgraphs=True`` so worker-internal steps surface with the
        namespace that produced them, rather than being collapsed away.
        """
        graph = self._require_graph()
        modes = self._resolve_modes(request)
        normalizer = StreamNormalizer(request.thread_id)
        subgraphs = self._settings.graph_stream_subgraphs

        yield normalizer.control(
            "stream.start",
            {"channel": "graph", "modes": modes, "subgraphs": subgraphs},
        )

        try:
            async for chunk in graph.astream(
                request.to_graph_input(),
                config=self._config(request),
                stream_mode=modes,
                subgraphs=subgraphs,
            ):
                yield normalizer.normalize_graph_chunk(chunk, default_mode=modes[0])
        except GraphRecursionError as exc:
            yield normalizer.control(
                "stream.error",
                {"code": "recursion_limit_exceeded", "message": str(exc)},
            )
            return
        except Exception as exc:  # noqa: BLE001 - reported in-band, not as a 500
            logger.exception("Graph stream failed for thread %s", request.thread_id)
            yield normalizer.control(
                "stream.error",
                {"code": "graph_execution_error", "message": str(exc)},
            )
            return

        yield normalizer.control("stream.end", {"channel": "graph"})

    # ----------------------------------------------------------- event stream
    async def stream_events(self, request: RunRequest) -> AsyncIterator[StreamEnvelope]:
        """Stream the full ``astream_events`` v2 taxonomy for this run.

        This is the finest-grained surface LangGraph offers: individual model
        token deltas, tool invocation start/end, and chain spans for every node
        and subgraph.
        """
        graph = self._require_graph()
        normalizer = StreamNormalizer(request.thread_id)

        yield normalizer.control("stream.start", {"channel": "events", "version": "v2"})

        try:
            async for event in graph.astream_events(
                request.to_graph_input(),
                config=self._config(request),
                version="v2",
            ):
                yield normalizer.normalize_event(event)
        except GraphRecursionError as exc:
            yield normalizer.control(
                "stream.error",
                {"code": "recursion_limit_exceeded", "message": str(exc)},
            )
            return
        except Exception as exc:  # noqa: BLE001
            logger.exception("Event stream failed for thread %s", request.thread_id)
            yield normalizer.control(
                "stream.error",
                {"code": "graph_execution_error", "message": str(exc)},
            )
            return

        yield normalizer.control("stream.end", {"channel": "events"})

    # ------------------------------------------------------------------- state
    async def get_state(self, thread_id: str) -> dict[str, Any] | None:
        """Read the checkpointed state for a thread, if any."""
        graph = self._require_graph()
        config = {"configurable": {"thread_id": thread_id}}
        try:
            snapshot = await graph.aget_state(config)
        except Exception as exc:  # noqa: BLE001 - no checkpointer configured
            logger.debug("State lookup failed for thread %s: %s", thread_id, exc)
            return None
        if snapshot is None or not snapshot.values:
            return None
        return {
            "values": snapshot.values,
            "next": list(snapshot.next or ()),
            "created_at": snapshot.created_at,
            "metadata": snapshot.metadata,
        }
