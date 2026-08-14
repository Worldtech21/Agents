"""Custom-event emission for the LangGraph ``custom`` stream mode.

``custom`` is the one stream mode LangGraph never populates on its own — it only
carries what graph code explicitly writes via ``get_stream_writer()``.  Without
a writer somewhere in the graph, a client subscribing to `graph.custom` would
wait forever.

This module provides:

* :func:`emit` — a safe writer usable from any node **or tool**, so application
  code can push domain progress events onto the same stream.
* :func:`make_progress_hook` — a ``pre_model_hook`` that announces each agent
  turn, which is what guarantees the channel is live out of the box.
"""

from __future__ import annotations

import time
from typing import Any

from langgraph.config import get_stream_writer

from app.core.logging import get_logger

logger = get_logger(__name__)


def emit(event: str, **fields: Any) -> None:
    """Write a custom event onto the ``custom`` stream, if one is listening.

    Safe to call from anywhere: outside a graph run, or when the caller did not
    subscribe to ``custom``, this is a no-op rather than an error. That makes it
    usable inside MCP tool wrappers and helper functions without ceremony.
    """
    try:
        writer = get_stream_writer()
    except (RuntimeError, LookupError):
        # Not inside a runnable context — nothing to stream to.
        return
    if writer is None:
        return
    try:
        writer({"type": event, "ts": time.time(), **fields})
    except Exception as exc:  # noqa: BLE001 - telemetry must never break a run
        logger.debug("Dropped custom event %s: %s", event, exc)


def make_progress_hook(agent_name: str):
    """Build a ``pre_model_hook`` that emits a progress event per agent turn.

    Returns an empty dict, so it contributes no state updates — it exists purely
    for observability.
    """

    def progress_hook(state: dict[str, Any]) -> dict[str, Any]:
        messages = state.get("messages") or []
        emit(
            "agent.turn_start",
            agent=agent_name,
            message_count=len(messages),
        )
        return {}

    return progress_hook
