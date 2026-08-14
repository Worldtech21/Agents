#!/usr/bin/env python
"""Reference consumer for both streaming endpoints.

    python examples/client.py "Summarise Q3 churn drivers"
    python examples/client.py --events "Summarise Q3 churn drivers"

Demonstrates the envelope contract: gapless `seq`, `<channel>.<event>` naming,
and in-band termination via `control.stream.end` / `control.stream.error`.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

import httpx

BASE_URL = "http://localhost:8000/api/v1"


async def stream(endpoint: str, message: str, thread_id: str | None) -> int:
    payload: dict[str, object] = {"message": message}
    if thread_id:
        payload["thread_id"] = thread_id

    counts: dict[str, int] = {}
    last_seq = -1
    exit_code = 0

    # read=None: a long agentic run can go minutes between chunks.
    async with (
        httpx.AsyncClient(timeout=httpx.Timeout(None, read=None)) as client,
        client.stream("POST", f"{BASE_URL}{endpoint}", json=payload) as response,
    ):
        response.raise_for_status()
        event_name = None

        async for line in response.aiter_lines():
            if line.startswith("event:"):
                event_name = line.split(":", 1)[1].strip()
                continue
            if not line.startswith("data:") or event_name is None:
                continue

            envelope = json.loads(line.split(":", 1)[1].strip())
            counts[event_name] = counts.get(event_name, 0) + 1

            # `seq` is gapless — a jump means chunks were dropped.
            if envelope["seq"] != last_seq + 1:
                print(
                    f"\n[warn] sequence gap: {last_seq} -> {envelope['seq']}",
                    file=sys.stderr,
                )
            last_seq = envelope["seq"]

            render(event_name, envelope)

            if event_name == "control.stream.error":
                print(f"\n[error] {envelope['payload']}", file=sys.stderr)
                exit_code = 1
            elif event_name == "control.stream.end":
                break

    print("\n\n--- envelopes by event ---")
    for name, count in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {count:5}  {name}")
    return exit_code


def render(event_name: str, envelope: dict) -> None:
    """Print the interesting bits; everything else is just counted."""
    payload = envelope["payload"]
    where = "/".join(envelope["namespace"]) or "supervisor"

    if event_name == "graph.messages":
        for block in _text_blocks(payload.get("chunk", {}).get("content")):
            print(block, end="", flush=True)

    elif event_name == "events.on_chat_model_stream":
        chunk = payload.get("data", {}).get("chunk", {})
        for block in _text_blocks(chunk.get("content")):
            print(block, end="", flush=True)

    elif event_name in ("graph.custom",):
        print(f"\n[{where}] {payload}", flush=True)

    elif event_name == "events.on_tool_start":
        print(f"\n[{where}] -> tool {payload['name']}", flush=True)

    elif event_name == "events.on_tool_end":
        print(f"\n[{where}] <- tool {payload['name']}", flush=True)


def _text_blocks(content) -> list[str]:
    """Anthropic content is a list of blocks when thinking is enabled."""
    if isinstance(content, str):
        return [content]
    if isinstance(content, list):
        return [
            b["text"]
            for b in content
            if isinstance(b, dict) and b.get("type") == "text" and b.get("text")
        ]
    return []


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("message", help="What to ask the agents.")
    parser.add_argument(
        "--events",
        action="store_true",
        help="Use /chat/events (astream_events v2) instead of /chat/stream.",
    )
    parser.add_argument("--thread-id", default=None, help="Continue an existing thread.")
    args = parser.parse_args()

    endpoint = "/chat/events" if args.events else "/chat/stream"
    return asyncio.run(stream(endpoint, args.message, args.thread_id))


if __name__ == "__main__":
    raise SystemExit(main())
