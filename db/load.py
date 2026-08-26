"""Load the JSON datasets into Postgres.

    python db/load.py --dry-run       # read and validate, write nothing
    python db/load.py                 # create tables, then load
    python db/load.py --reset         # drop every table first, then load
    python db/load.py --url postgresql+psycopg://user:pass@host:5432/db

The JSON files under ``../<service>/api/*.json`` are the source of truth; this
script is one-way. Each table is filled with a single ``bulk_insert_mappings``
inside one transaction, so a failure anywhere — a bad enum value, a dangling
entitlement name — leaves the database exactly as it was rather than
half-migrated.

Load order matters: ``entitlement_catalog`` is written first because risk
scores, peer affinity and SoD rules all carry a foreign key to its
``entitlement_name``.

**On a database created by ../db/init/*.sql**, use ``--reset``. Those scripts run
automatically the first time the compose volume is empty, and they both create
the tables and seed them — so a plain run would find the tables already
populated and fail on duplicate keys. ``--reset`` drops and rebuilds from
``models.py``, which is what makes the ORM the definition rather than a second
opinion.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Callable, Iterator
from datetime import date
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parent))

from models import (  # noqa: E402  (path set up above)
    AccessRequest,
    Base,
    EntitlementCatalog,
    EntitlementRiskScore,
    Identity,
    NewJoiner,
    PeerAffinityScore,
    PolicyRule,
    SodRule,
)

#: The compose service in ../docker-compose.yml. Host port is 5433, not 5432 —
#: that machine already runs a system Postgres on 5432 and it is left alone.
DEFAULT_URL = "postgresql+psycopg://alchemy:alchemy@127.0.0.1:5433/alchemy"

#: Where the service directories live: two levels up from this file, i.e. the
#: parent of the Agents checkout.
ROOT = Path(__file__).resolve().parent.parent.parent


class LoadError(RuntimeError):
    """A dataset could not be read or did not look the way it must."""


def _rows(relative: str) -> list[dict[str, Any]]:
    """Read one JSON file as a list of records."""
    path = ROOT / relative
    if not path.exists():
        raise LoadError(f"{relative} not found (looked in {path})")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise LoadError(f"{relative} is not valid JSON: {exc}") from exc
    if not isinstance(data, list):
        raise LoadError(f"{relative} must hold a JSON array, found {type(data).__name__}")
    return data


def _optional_rows(relative: str) -> list[dict[str, Any]]:
    """Like ``_rows``, but a missing file means no rows rather than an error.

    ``access_requests.json`` only exists once the requests service has written
    one, so its absence is the normal case rather than a problem.
    """
    return _rows(relative) if (ROOT / relative).exists() else []


def _to_date(value: Any, *, field: str) -> date:
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError as exc:
        raise LoadError(f"{field}: {value!r} is not an ISO date") from exc


Mapper = Callable[[dict[str, Any]], dict[str, Any]]

# Each entry: model, source file, and how one JSON record becomes one row.
# Order is load order, and the catalog leads because everything references it.
DATASETS: tuple[tuple[type[Base], str, Mapper], ...] = (
    (
        EntitlementCatalog,
        "entitlements/api/entitlement_catalog.json",
        dict,
    ),
    (
        EntitlementRiskScore,
        "entitlements/api/entitlement_risk_scores.json",
        dict,
    ),
    (
        Identity,
        "identities/api/identities.json",
        lambda r: {
            **r,
            "manager_id": r.get("manager_id", ""),
            "entitlements": r.get("entitlements", ""),
        },
    ),
    (
        NewJoiner,
        "new-joiners/api/new_joiners.json",
        lambda r: {**r, "start_date": _to_date(r["start_date"], field="new_joiners.start_date")},
    ),
    (
        PeerAffinityScore,
        "peer-affinity/api/peer_affinity_scores.json",
        dict,
    ),
    (PolicyRule, "policy/api/policy_rules.json", dict),
    (SodRule, "sod-test/api/sod_rules.json", dict),
)

#: Loaded only if present — see ``_optional_rows``.
OPTIONAL_DATASETS: tuple[tuple[type[Base], str, Mapper], ...] = (
    (AccessRequest, "requests/api/access_requests.json", dict),
)


def read_all() -> Iterator[tuple[type[Base], str, list[dict[str, Any]]]]:
    """Read and map every dataset, before anything is written.

    Reading up front means a malformed file is reported without having touched
    the database at all.
    """
    for model, relative, to_row in DATASETS:
        yield model, relative, [to_row(record) for record in _rows(relative)]
    for model, relative, to_row in OPTIONAL_DATASETS:
        yield model, relative, [to_row(record) for record in _optional_rows(relative)]


def load(
    session: Session,
    datasets: list[tuple[type[Base], str, list[dict[str, Any]]]],
) -> dict[str, int]:
    """Insert every dataset. Caller owns the transaction."""
    counts: dict[str, int] = {}
    for model, _relative, rows in datasets:
        if rows:
            session.bulk_insert_mappings(model, rows)
        counts[model.__tablename__] = len(rows)
    return counts


def verify(session: Session, expected: dict[str, int]) -> list[str]:
    """Count what actually landed, and report anything that disagrees."""
    problems: list[str] = []
    for model, _relative, _mapper in DATASETS + OPTIONAL_DATASETS:
        table = model.__tablename__
        actual = session.scalar(select(func.count()).select_from(model))
        if actual != expected[table]:
            problems.append(f"{table}: expected {expected[table]} rows, found {actual}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--url",
        default=os.environ.get("DATABASE_URL", DEFAULT_URL),
        help="SQLAlchemy URL (env: DATABASE_URL). Default: the compose Postgres on 5433.",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Drop every table defined by the models before creating them again.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read and map every dataset, report the counts, and write nothing.",
    )
    args = parser.parse_args()

    try:
        datasets = list(read_all())
    except LoadError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    total = sum(len(rows) for _model, _relative, rows in datasets)
    for _model, relative, rows in datasets:
        print(f"  read {len(rows):>4} rows  {relative}")
    print(f"  {'':>9} {total} rows total")

    if args.dry_run:
        print("\ndry run: nothing written.")
        return 0

    engine = create_engine(args.url, future=True)

    try:
        if args.reset:
            print("\ndropping existing tables")
            Base.metadata.drop_all(engine)

        print("creating tables")
        Base.metadata.create_all(engine)

        with sessionmaker(engine, future=True)() as session, session.begin():
            counts = load(session, datasets)

        # A separate transaction, so this counts what was committed.
        with sessionmaker(engine, future=True)() as session:
            problems = verify(session, counts)
    except Exception as exc:  # noqa: BLE001 — the message is the whole point here
        print(f"\nerror: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    finally:
        engine.dispose()

    print()
    for table, count in counts.items():
        print(f"  loaded {count:>4} rows  {table}")

    if problems:
        print("\nverification failed:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1

    print(f"\nloaded {total} rows into {len(counts)} tables; counts verified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
