"""Shared plumbing for the Postgres-backed MCP servers.

The servers in ``mcp_server.py`` are drop-in replacements for the ones deployed
in GKE: same server names, same tool names, same arguments, same JSON shapes
coming back. Only the storage differs — those read ``/app/*.json`` inside a pod,
these read the Postgres that ``load.py`` filled.

That parity is the whole point. Nothing in ``app/`` changes to use these; the
six MCP URLs in ``.env`` move from the GKE gateway to localhost and the agents
cannot tell the difference.
"""

from __future__ import annotations

import os
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import date
from typing import Any

from fastmcp.exceptions import ToolError
from sqlalchemy import create_engine, func, inspect as sa_inspect, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.sql import Select

from models import Base

#: Same default as ``load.py`` — the compose Postgres on 5433.
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg://alchemy:alchemy@127.0.0.1:5433/alchemy",
)

#: `pool_pre_ping` because this process outlives any single query and a
#: restarted container should not poison the pool.
_engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
_Session = sessionmaker(_engine, future=True, expire_on_commit=False)


@contextmanager
def session_scope() -> Iterator[Session]:
    """One transaction per tool call, committed on success."""
    session = _Session()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def row_to_dict(row: Base) -> dict[str, Any]:
    """One ORM row as the JSON object the GKE services return.

    Dates go out as ISO strings and ``None`` becomes ``''`` for text columns,
    because that is what the JSON files hold and what the callers parse.

    Columns named in a model's ``__mcp_exclude__`` are dropped. That exists for
    ``peer_affinity_scores.id``: the table needs a surrogate key because those
    rows carry no identifier of their own, but the JSON has no such field and a
    caller that round-trips a record must not start sending one.
    """
    excluded: frozenset[str] = getattr(type(row), "__mcp_exclude__", frozenset())
    out: dict[str, Any] = {}
    for column in sa_inspect(type(row)).columns:
        if column.key in excluded:
            continue
        value = getattr(row, column.key)
        if isinstance(value, date):
            value = value.isoformat()
        elif value is None and not column.nullable:
            value = ""
        out[column.key] = value
    return out


def rows_to_list(rows: Sequence[Base]) -> list[dict[str, Any]]:
    return [row_to_dict(row) for row in rows]


def paginate(statement: Select[Any], limit: int, offset: int) -> Select[Any]:
    return statement.limit(limit).offset(offset)


def fetch_one(session: Session, model: type[Base], **keys: Any) -> Base:
    """Load one row by primary key, or raise the 404 the MCP layer expects."""
    row = session.scalar(select(model).filter_by(**keys))
    if row is None:
        described = ", ".join(f"{k}={v!r}" for k, v in keys.items())
        raise ToolError(f"No {model.__tablename__} record with {described}")
    return row


def ensure_absent(session: Session, model: type[Base], **keys: Any) -> None:
    """Raise the 409 the MCP layer expects when a record already exists."""
    if session.scalar(select(model).filter_by(**keys)) is not None:
        described = ", ".join(f"{k}={v!r}" for k, v in keys.items())
        raise ToolError(f"A {model.__tablename__} record with {described} already exists")


def apply_patch(row: Base, values: dict[str, Any]) -> dict[str, Any]:
    """Assign the non-``None`` values of a PATCH, and return the row."""
    for field, value in values.items():
        if value is not None:
            setattr(row, field, value)
    return row_to_dict(row)


def health(model: type[Base]) -> dict[str, Any]:
    """The ``api_health`` payload, shaped like the GKE servers' but for a table.

    Those report the data file they read; these report the table and its row
    count, which is the same question asked of a different store.
    """
    try:
        with session_scope() as session:
            count = session.scalar(select(func.count()).select_from(model))
    except Exception as exc:  # noqa: BLE001 — health must answer, not raise
        return {
            "status": "error",
            "table": model.__tablename__,
            "error": f"{type(exc).__name__}: {exc}",
        }
    return {
        "status": "ok",
        "table": model.__tablename__,
        "rows": count,
        "source": "postgres",
    }
