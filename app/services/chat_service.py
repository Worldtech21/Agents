"""Application service for conversational runs.

Coordinates the graph runner and translates its output into the domain shapes
the API layer serialises.  Contains no HTTP and no LangGraph specifics.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from app.agents.prompts import build_employee_context
from app.core.config import Settings
from app.core.exceptions import RecordNotFoundError
from app.core.logging import get_logger
from app.domain.models import ChatMessage, RunRequest, StreamEnvelope
from app.graph.runner import GraphRunner
from app.infrastructure.streaming.serialization import to_jsonable
from app.services.directory_service import DirectoryService

logger = get_logger(__name__)

#: The metadata value that puts a run into employee self-service mode.
EMPLOYEE_MODE = "employee"


class ChatService:
    """Use cases for talking to the supervisor graph."""

    def __init__(
        self,
        *,
        settings: Settings,
        runner: GraphRunner,
        directory: DirectoryService | None = None,
    ) -> None:
        self._settings = settings
        self._runner = runner
        self._directory = directory

    async def prepare(self, request: RunRequest) -> RunRequest:
        """Apply per-run mode before the graph sees the turn.

        One compiled graph serves both modes.  HR runs are left exactly as they
        arrive — their output contract has clients depending on it — and an
        employee run is opened with a system turn describing who is speaking.

        The turn is added only when the thread has no checkpoint yet, so a
        continuing conversation is not re-briefed on every message.
        """
        mode = str(request.metadata.get("mode") or "").lower()
        if mode != EMPLOYEE_MODE or self._directory is None:
            return request

        actor_id = str(request.metadata.get("actor_id") or "").strip()
        if not actor_id:
            logger.warning("Employee mode requested with no actor_id — ignoring mode")
            return request

        if await self._runner.get_state(request.thread_id) is not None:
            return request

        try:
            subject = await self._directory.get_subject(actor_id)
        except RecordNotFoundError:
            logger.warning("Employee mode names %s, which matches no record", actor_id)
            return request

        context = build_employee_context(
            employee_id=subject.employee_id,
            name=subject.name,
            job_role=subject.job_role,
            job_level=subject.job_level,
            department=subject.department,
            location=subject.location,
            entitlements=subject.entitlements,
            manager_id=await self._directory.resolve_approver(subject),
        )
        request.messages = [ChatMessage(role="system", content=context), *request.messages]
        logger.info("Opened thread %s in employee mode as %s", request.thread_id, actor_id)
        return request

    async def complete(self, request: RunRequest) -> dict[str, Any]:
        """Run to completion and return the final assistant turn plus state."""
        logger.info("Running completion for thread %s", request.thread_id)
        request = await self.prepare(request)
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

    async def stream_graph(self, request: RunRequest) -> AsyncIterator[StreamEnvelope]:
        """Stream every LangGraph state-stream mode.

        An async generator rather than a plain delegate so ``prepare`` can run
        before the first chunk; callers use it exactly as before.
        """
        request = await self.prepare(request)
        logger.info(
            "Streaming graph modes for thread %s: %s",
            request.thread_id,
            request.stream_modes or self._settings.graph_stream_modes,
        )
        async for envelope in self._runner.stream_graph(request):
            yield envelope

    async def stream_events(self, request: RunRequest) -> AsyncIterator[StreamEnvelope]:
        """Stream the full astream_events v2 taxonomy."""
        request = await self.prepare(request)
        logger.info("Streaming events for thread %s", request.thread_id)
        async for envelope in self._runner.stream_events(request):
            yield envelope

    async def get_thread_state(self, thread_id: str) -> dict[str, Any] | None:
        state = await self._runner.get_state(thread_id)
        return to_jsonable(state) if state is not None else None


def _flatten(content: Any) -> str:
    """Collapse block-list message content into plain text.

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
