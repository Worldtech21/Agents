"""Normalise raw LangGraph chunks into :class:`StreamEnvelope`.

LangGraph's two streaming surfaces have different shapes, and ``astream``'s
shape changes depending on how it was called:

* ``astream(stream_mode=[...], subgraphs=True)``  -> ``(namespace, mode, payload)``
* ``astream(stream_mode=[...], subgraphs=False)`` -> ``(mode, payload)``
* ``astream(stream_mode="values")``               -> ``payload``
* ``astream_events(version="v2")``                -> ``{"event": ..., "data": ...}``

This module absorbs all four so the service layer never has to branch.
"""

from __future__ import annotations

import itertools
from typing import Any

from app.domain.models import StreamChannel, StreamEnvelope
from app.infrastructure.streaming.serialization import to_jsonable

#: Every mode LangGraph 1.x can emit. Used to recognise a leading mode tag.
KNOWN_STREAM_MODES = frozenset(
    {"values", "updates", "messages", "custom", "debug", "tasks", "checkpoints"}
)


class EnvelopeSequencer:
    """Monotonic counter so clients can detect gaps or reorder chunks."""

    def __init__(self, start: int = 0) -> None:
        self._counter = itertools.count(start)

    def next(self) -> int:
        return next(self._counter)


class StreamNormalizer:
    """Convert raw chunks into envelopes for a single run."""

    def __init__(self, thread_id: str, sequencer: EnvelopeSequencer | None = None) -> None:
        self._thread_id = thread_id
        self._sequencer = sequencer or EnvelopeSequencer()

    # ------------------------------------------------------------------ graph
    def normalize_graph_chunk(
        self, chunk: Any, *, default_mode: str = "values"
    ) -> StreamEnvelope:
        """Normalise one item from ``CompiledStateGraph.astream``."""
        namespace: tuple[str, ...] = ()
        mode = default_mode
        payload = chunk

        if isinstance(chunk, tuple):
            if len(chunk) == 3:
                raw_namespace, mode, payload = chunk
                namespace = _coerce_namespace(raw_namespace)
            elif len(chunk) == 2:
                first, second = chunk
                if isinstance(first, str) and first in KNOWN_STREAM_MODES:
                    mode, payload = first, second
                elif isinstance(first, (tuple, list)):
                    # subgraphs=True with a single stream mode.
                    namespace, payload = _coerce_namespace(first), second
                else:
                    payload = chunk

        return StreamEnvelope(
            seq=self._sequencer.next(),
            channel=StreamChannel.GRAPH,
            event=str(mode),
            namespace=namespace,
            payload=self._render_mode_payload(str(mode), payload),
            thread_id=self._thread_id,
        )

    def _render_mode_payload(self, mode: str, payload: Any) -> Any:
        """Give the ``messages`` mode a friendlier shape; pass others through."""
        if mode == "messages" and isinstance(payload, tuple) and len(payload) == 2:
            chunk, metadata = payload
            return {"chunk": to_jsonable(chunk), "metadata": to_jsonable(metadata)}
        return to_jsonable(payload)

    # ----------------------------------------------------------------- events
    def normalize_event(self, event: dict[str, Any]) -> StreamEnvelope:
        """Normalise one item from ``Runnable.astream_events(version='v2')``."""
        name = event.get("event", "unknown")
        metadata = event.get("metadata") or {}
        namespace = _coerce_namespace(metadata.get("langgraph_checkpoint_ns"))

        payload = {
            "name": event.get("name"),
            "run_id": event.get("run_id"),
            "parent_ids": event.get("parent_ids") or [],
            "tags": event.get("tags") or [],
            "metadata": to_jsonable(metadata),
            "data": to_jsonable(event.get("data")),
        }

        return StreamEnvelope(
            seq=self._sequencer.next(),
            channel=StreamChannel.EVENTS,
            event=str(name),
            namespace=namespace,
            payload=payload,
            thread_id=self._thread_id,
        )

    # ---------------------------------------------------------------- control
    def control(self, event: str, payload: Any = None) -> StreamEnvelope:
        return StreamEnvelope(
            seq=self._sequencer.next(),
            channel=StreamChannel.CONTROL,
            event=event,
            namespace=(),
            payload=to_jsonable(payload) if payload is not None else {},
            thread_id=self._thread_id,
        )


def _coerce_namespace(value: Any) -> tuple[str, ...]:
    """Normalise the many spellings of a checkpoint namespace into a tuple."""
    if value is None or value == "":
        return ()
    if isinstance(value, str):
        return tuple(part for part in value.split("|") if part)
    if isinstance(value, (tuple, list)):
        return tuple(str(part) for part in value if part not in (None, ""))
    return (str(value),)
