"""Make arbitrary LangGraph payloads JSON-safe.

LangGraph streams rich Python objects — LangChain messages, pydantic models,
``Send``/``Command`` directives, datetimes, exceptions.  ``json.dumps`` chokes on
all of them, so every payload passes through :func:`to_jsonable` before it is
written to the wire.

The goal is *lossless enough to be useful*, not a faithful round-trip: messages
are flattened into a readable dict rather than LangChain's verbose ``lc``
serialisation format.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import enum
import uuid
from collections.abc import Mapping, Sequence
from typing import Any

from langchain_core.messages import BaseMessage

#: Guard against pathological/self-referential structures in debug payloads.
MAX_DEPTH = 12
#: Truncate very long strings so one chunk cannot blow up a browser tab.
MAX_STRING_LENGTH = 100_000


def _truncate(value: str) -> str:
    if len(value) <= MAX_STRING_LENGTH:
        return value
    return value[:MAX_STRING_LENGTH] + f"...[truncated {len(value) - MAX_STRING_LENGTH} chars]"


def message_to_dict(message: BaseMessage) -> dict[str, Any]:
    """Flatten a LangChain message (or message chunk) into a compact dict."""
    data: dict[str, Any] = {
        "id": getattr(message, "id", None),
        "type": message.type,
        "role": getattr(message, "role", None) or message.type,
        "name": getattr(message, "name", None),
        "content": to_jsonable(message.content),
    }

    # Only present on AI messages; omitted entirely when empty to keep the
    # stream readable.
    for attribute in ("tool_calls", "invalid_tool_calls", "tool_call_chunks"):
        value = getattr(message, attribute, None)
        if value:
            data[attribute] = to_jsonable(value)

    for attribute in ("tool_call_id", "status", "artifact"):
        value = getattr(message, attribute, None)
        if value is not None:
            data[attribute] = to_jsonable(value)

    if getattr(message, "usage_metadata", None):
        data["usage_metadata"] = to_jsonable(message.usage_metadata)
    if getattr(message, "response_metadata", None):
        data["response_metadata"] = to_jsonable(message.response_metadata)
    if getattr(message, "additional_kwargs", None):
        data["additional_kwargs"] = to_jsonable(message.additional_kwargs)

    return {key: value for key, value in data.items() if value is not None}


def to_jsonable(value: Any, _depth: int = 0) -> Any:  # noqa: C901 - a dispatch table
    """Recursively convert *value* into something ``json.dumps`` accepts."""
    if _depth > MAX_DEPTH:
        return f"<max depth exceeded: {type(value).__name__}>"

    # Fast path for the overwhelming majority of leaves.
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _truncate(value)

    if isinstance(value, BaseMessage):
        return message_to_dict(value)

    if isinstance(value, enum.Enum):
        return to_jsonable(value.value, _depth + 1)

    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    if isinstance(value, dt.timedelta):
        return value.total_seconds()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", errors="replace")

    if isinstance(value, BaseException):
        return {"error_type": type(value).__name__, "message": str(value)}

    if isinstance(value, Mapping):
        return {str(k): to_jsonable(v, _depth + 1) for k, v in value.items()}

    if isinstance(value, (set, frozenset)):
        return [to_jsonable(item, _depth + 1) for item in value]

    # str/bytes are handled above, so any remaining Sequence is list-like.
    if isinstance(value, Sequence):
        return [to_jsonable(item, _depth + 1) for item in value]

    # pydantic v2, then v1, then dataclasses.
    dump = getattr(value, "model_dump", None)
    if callable(dump):
        try:
            return to_jsonable(dump(), _depth + 1)
        except Exception:  # noqa: BLE001 - fall through to the next strategy
            pass

    legacy_dump = getattr(value, "dict", None)
    if callable(legacy_dump) and not isinstance(value, type):
        try:
            return to_jsonable(legacy_dump(), _depth + 1)
        except Exception:  # noqa: BLE001
            pass

    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return to_jsonable(dataclasses.asdict(value), _depth + 1)

    if hasattr(value, "__dict__") and not isinstance(value, type):
        public = {k: v for k, v in vars(value).items() if not k.startswith("_")}
        if public:
            return {
                "__type__": type(value).__name__,
                **{k: to_jsonable(v, _depth + 1) for k, v in public.items()},
            }

    return _truncate(repr(value))
