"""Checkpointer construction.

The checkpointer is what makes ``thread_id`` meaningful: with one installed, a
second request carrying the same thread resumes the prior conversation.
"""

from __future__ import annotations

from typing import Any

from langgraph.checkpoint.memory import InMemorySaver

from app.core.config import Settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class CheckpointerFactoryImpl:
    """Creates the configured checkpointer, or ``None`` for a stateless graph."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def create(self) -> Any | None:
        kind = self._settings.graph_checkpointer
        if kind == "none":
            logger.info("Checkpointing disabled — threads will not persist.")
            return None

        # InMemorySaver is per-process: fine for local/dev and single-replica
        # deploys. Swap in langgraph-checkpoint-postgres for multi-replica.
        logger.info("Using in-memory checkpointer (per-process, non-durable).")
        return InMemorySaver()
