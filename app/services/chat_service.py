"""Application service for conversational runs.

Coordinates the graph runner and translates its output into the domain shapes
the API layer serialises.  Contains no HTTP and no LangGraph specifics.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from app.core.config import Settings
from app.core.logging import get_logger
from app.domain.models import RunRequest, StreamEnvelope
from app.graph.runner import GraphRunner
from app.infrastructure.streaming.serialization import to_jsonable

logger = get_logger(__name__)


class ChatService:
    """Use cases for talking to the supervisor graph."""

    def __init__(self, *, settings: Settings, runner: GraphRunner) -> None:
        self._settings = settings
        self._runner = runner

    async def complete(self, request: RunRequest) -> dict[str, Any]:
        """Run to completion and return the final assistant turn plus state."""
        logger.info("Running completion for thread %s", request.thread_id)
        state = await self._runner.invoke(request)
        messages = state.get("messages", []) if isinstance(state, dict) else []

        answer = ""
        for message in reversed(messages):
            content = getattr(message, "content", None)
            if getattr(message, "type", None) == "ai" and content:
                answer = content if isinstance(content, str) else _flatten(content)
                break

        return {
            "thread_id": request.thread_id,
            "answer": answer,
            "messages": to_jsonable(messages),
        }

    def stream_graph(self, request: RunRequest) -> AsyncIterator[StreamEnvelope]:
        """Stream every LangGraph state-stream mode."""
        logger.info(
            "Streaming graph modes for thread %s: %s",
            request.thread_id,
            request.stream_modes or self._settings.graph_stream_modes,
        )
        return self._runner.stream_graph(request)

    def stream_events(self, request: RunRequest) -> AsyncIterator[StreamEnvelope]:
        """Stream the full astream_events v2 taxonomy."""
        logger.info("Streaming events for thread %s", request.thread_id)
        return self._runner.stream_events(request)

    async def get_thread_state(self, thread_id: str) -> dict[str, Any] | None:
        state = await self._runner.get_state(thread_id)
        return to_jsonable(state) if state is not None else None


def _flatten(content: Any) -> str:
    """Collapse Anthropic's block-list content into plain text.

    With thinking enabled, ``content`` is a list of blocks; only the ``text``
    blocks belong in the answer field (thinking is surfaced via the stream).
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        ]
        return "".join(parts)
    return str(content)
