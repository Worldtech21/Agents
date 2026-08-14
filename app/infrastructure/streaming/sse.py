"""Server-Sent Events encoding for stream envelopes."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from app.domain.models import StreamEnvelope


def encode_envelope(envelope: StreamEnvelope) -> dict[str, Any]:
    """Render an envelope as an ``EventSourceResponse`` chunk.

    The SSE ``event:`` field carries ``<channel>.<event>`` so a browser can
    subscribe selectively via ``addEventListener`` instead of parsing every
    message body.
    """
    return {
        "event": f"{envelope.channel.value}.{envelope.event}",
        "id": str(envelope.seq),
        "data": json.dumps(envelope.to_dict(), default=str, ensure_ascii=False),
    }


async def to_sse(
    envelopes: AsyncIterator[StreamEnvelope],
) -> AsyncIterator[dict[str, Any]]:
    """Adapt an envelope stream into an SSE chunk stream."""
    async for envelope in envelopes:
        yield encode_envelope(envelope)


async def to_ndjson(envelopes: AsyncIterator[StreamEnvelope]) -> AsyncIterator[bytes]:
    """Adapt an envelope stream into newline-delimited JSON.

    Useful for non-browser clients (curl, httpx, worker processes) that would
    rather not implement SSE framing.
    """
    async for envelope in envelopes:
        line = json.dumps(envelope.to_dict(), default=str, ensure_ascii=False)
        yield f"{line}\n".encode()
