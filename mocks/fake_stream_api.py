"""A stand-in for `POST /chat/stream` that needs no LLM, MCP server or API key.

The real endpoint takes 40-90s because six agents actually run.  Reproducing the
GKE truncation does not need any of that — it only needs a response that stays
open past the load balancer's 30s budget.  This emits the same
`StreamEnvelope` shape, under the same SSE headers and the same `ping=15`
keep-alive as `app/api/v1/endpoints/chat.py`, on a fixed schedule.

    python mocks/fake_stream_api.py --port 8000 --duration 60

Pair it with `gclb_timeout_proxy.py` to see the failure without touching the
deployed stack; see `mocks/repro.sh`.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from collections.abc import AsyncIterator
from typing import Any

import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

# Copied from app/api/v1/endpoints/chat.py so the mock and the real endpoint
# answer with identical framing.
SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}

#: Roughly the cadence of a real supervisor run's `updates` envelopes.
STEP_INTERVAL_SEC = 2.0


class ChatRequest(BaseModel):
    message: str = ""
    thread_id: str = "mock-thread"
    stream_modes: list[str] | None = None


def create_app(duration: float) -> FastAPI:
    app = FastAPI(title="Access Advisor stream mock")

    async def envelopes(thread_id: str) -> AsyncIterator[dict[str, Any]]:
        started = time.monotonic()
        seq = 0

        def frame(event: str, channel: str, payload: dict[str, Any]) -> dict[str, Any]:
            nonlocal seq
            body = {
                "seq": seq,
                "channel": channel,
                "event": event,
                "namespace": [],
                "thread_id": thread_id,
                "ts": time.time(),
                "payload": payload,
            }
            seq += 1
            return {
                "event": f"{channel}.{event}",
                "id": str(body["seq"]),
                "data": json.dumps(body, ensure_ascii=False),
            }

        yield frame("stream.start", "control", {})

        while (elapsed := time.monotonic() - started) < duration:
            yield frame(
                "updates",
                "graph",
                {"step": seq, "elapsed_sec": round(elapsed, 1)},
            )
            await asyncio.sleep(STEP_INTERVAL_SEC)

        # The frame a truncated run never gets to see.  `repro.sh` keys off it.
        yield frame(
            "stream.end",
            "control",
            {"elapsed_sec": round(time.monotonic() - started, 1)},
        )

    @app.post("/api/v1/chat/stream")
    async def stream(payload: ChatRequest) -> EventSourceResponse:
        return EventSourceResponse(
            envelopes(payload.thread_id), headers=SSE_HEADERS, ping=15
        )

    @app.get("/api/v1/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument(
        "--duration",
        type=float,
        default=60.0,
        help="seconds the stream stays open (must exceed the proxy timeout to fail)",
    )
    args = parser.parse_args()

    uvicorn.run(create_app(args.duration), host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
