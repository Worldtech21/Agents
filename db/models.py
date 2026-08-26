"""The alchemy schema, as SQLAlchemy ORM models.

These classes are the definition of the schema this project migrates to:
``load.py`` calls ``Base.metadata.create_all`` and Postgres gets exactly what is
declared here.

They were written against ``../db/init/01_schema.sql``, which predates them and
still runs when the compose Postgres first starts. That file is *not* read by
anything here — see the note in ``load.py`` about ``--reset``, which is how a
database created from that SQL is brought under these models.

Columns mirror the JSON files field-for-field, including the shapes that are not
what you would design from scratch:

* ``Identity.entitlements`` is a semicolon-separated string, not a join table.
  The services read and write that string as-is, so normalising it here would
  mean translating on every read for no gain until they move off JSON.
* ``AccessRequest`` uses ``''`` rather than NULL for not-yet-set fields, because
  that is what ``../requests/api/main.py`` writes and what its Pydantic model
  expects back.

Text is used for identifiers throughout: they are natural keys with meaning
(``ENT006``, ``EMP001``), assigned upstream rather than generated here.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

#: Risk and severity share one vocabulary across the datasets.
RISK_CATEGORIES = ("Low", "Medium", "High", "Critical")
POLICY_TYPES = ("ALLOW", "DENY", "HUMAN_APPROVAL")
REQUESTER_TYPES = ("EMPLOYEE", "HR")
SUBJECT_TYPES = ("IDENTITY", "NEW_JOINER")
REQUEST_STATUSES = (
    "AUTO_GRANTED",
    "PENDING_APPROVAL",
    "APPROVED",
    "REJECTED",
    "GRANTED",
    "BLOCKED_NO_APPROVER",
    "PROVISIONING_FAILED",
)


def _in(column: str, allowed: tuple[str, ...]) -> CheckConstraint:
    """A CHECK constraint pinning *column* to *allowed*."""
    values = ", ".join(f"'{value}'" for value in allowed)
    return CheckConstraint(f"{column} IN ({values})", name=f"ck_{column}")


class Base(DeclarativeBase):
    pass


class EntitlementCatalog(Base):
    """What an entitlement is: its id, name, owning application and owner.

    The catalog is the anchor of the schema — risk scores, peer affinity and SoD
    rules all reference an entitlement by *name*, not by id, because that is the
    key the source JSON joins on.
    """

    __tablename__ = "entitlement_catalog"

    entitlement_id: Mapped[str] = mapped_column(Text, primary_key=True)
    entitlement_name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    application: Mapped[str] = mapped_column(Text, nullable=False)
    owner: Mapped[str] = mapped_column(Text, nullable=False)


class EntitlementRiskScore(Base):
    """The risk rating attached to one entitlement.

    One row per entitlement, so the name is both primary key and foreign key.
    """

    __tablename__ = "entitlement_risk_scores"
    __table_args__ = (
        CheckConstraint("risk_score BETWEEN 0 AND 100", name="ck_risk_score_range"),
        _in("risk_category", RISK_CATEGORIES),
    )

    entitlement_name: Mapped[str] = mapped_column(
        Text,
        ForeignKey("entitlement_catalog.entitlement_name"),
        primary_key=True,
    )
    application: Mapped[str] = mapped_column(Text, nullable=False)
    risk_score: Mapped[int] = mapped_column(Integer, nullable=False)
    risk_category: Mapped[str] = mapped_column(Text, nullable=False)


class Identity(Base):
    """An existing employee and the entitlements they already hold."""

    __tablename__ = "identities"

    employee_id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    department: Mapped[str] = mapped_column(Text, nullable=False)
    job_role: Mapped[str] = mapped_column(Text, nullable=False)
    job_level: Mapped[str] = mapped_column(Text, nullable=False)
    location: Mapped[str] = mapped_column(Text, nullable=False)
    #: `''` for the top of a reporting line, which is what the JSON carries.
    manager_id: Mapped[str] = mapped_column(Text, nullable=False, default="")
    #: Semicolon-separated entitlement names — see the module docstring.
    entitlements: Mapped[str] = mapped_column(Text, nullable=False, default="")


class NewJoiner(Base):
    """A hire with a start date, before any access has been granted."""

    __tablename__ = "new_joiners"

    employee_id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    department: Mapped[str] = mapped_column(Text, nullable=False)
    job_role: Mapped[str] = mapped_column(Text, nullable=False)
    job_level: Mapped[str] = mapped_column(Text, nullable=False)
    location: Mapped[str] = mapped_column(Text, nullable=False)
    manager_id: Mapped[str] = mapped_column(Text, nullable=False)
    cost_center: Mapped[str] = mapped_column(Text, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)


class PeerAffinityScore(Base):
    """How common an entitlement is within one job role.

    ``peer_count`` of ``total_peers`` hold it; ``affinity_score`` is that share
    as a percentage, carried from the source rather than recomputed — the score
    is the upstream system's opinion, not this schema's arithmetic.
    """

    __tablename__ = "peer_affinity_scores"
    __table_args__ = (
        UniqueConstraint("job_role", "entitlement", name="uq_peer_role_entitlement"),
        CheckConstraint("peer_count >= 0", name="ck_peer_count"),
        CheckConstraint("total_peers >= 1", name="ck_total_peers"),
        CheckConstraint("affinity_score BETWEEN 0 AND 100", name="ck_affinity_range"),
    )

    #: Surrogate key: the source rows carry no id of their own. It is a storage
    #: detail, so the MCP layer drops it — see ``mcp_support.row_to_dict``.
    __mcp_exclude__ = frozenset({"id"})

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_role: Mapped[str] = mapped_column(Text, nullable=False)
    department: Mapped[str] = mapped_column(Text, nullable=False)
    entitlement: Mapped[str] = mapped_column(
        Text,
        ForeignKey("entitlement_catalog.entitlement_name"),
        nullable=False,
    )
    peer_count: Mapped[int] = mapped_column(Integer, nullable=False)
    total_peers: Mapped[int] = mapped_column(Integer, nullable=False)
    affinity_score: Mapped[int] = mapped_column(Integer, nullable=False)


class PolicyRule(Base):
    """One access policy: what it is called, what it does, and its rule text."""

    __tablename__ = "policy_rules"
    __table_args__ = (_in("type", POLICY_TYPES),)

    policy_id: Mapped[str] = mapped_column(Text, primary_key=True)
    policy_name: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    #: Free text, e.g. `Financial Analyst -> SAP_FIN_DISPLAY`.
    rule: Mapped[str] = mapped_column(Text, nullable=False)


class SodRule(Base):
    """A pair of entitlements that must not be held together."""

    __tablename__ = "sod_rules"
    __table_args__ = (
        _in("severity", RISK_CATEGORIES),
        CheckConstraint("entitlement_1 <> entitlement_2", name="ck_sod_distinct"),
    )

    sod_id: Mapped[str] = mapped_column(Text, primary_key=True)
    entitlement_1: Mapped[str] = mapped_column(
        Text, ForeignKey("entitlement_catalog.entitlement_name"), nullable=False
    )
    entitlement_2: Mapped[str] = mapped_column(
        Text, ForeignKey("entitlement_catalog.entitlement_name"), nullable=False
    )
    severity: Mapped[str] = mapped_column(Text, nullable=False)


class AccessRequest(Base):
    """A request for access, through its whole lifecycle.

    Mirrors ``../requests/api/main.py`` field-for-field. Timestamps are stored as
    text because that service writes ISO strings and reads them back unparsed;
    changing that here would break the round-trip it depends on.
    """

    __tablename__ = "access_requests"
    __table_args__ = (
        _in("requester_type", REQUESTER_TYPES),
        _in("subject_type", SUBJECT_TYPES),
        _in("status", REQUEST_STATUSES),
    )

    request_id: Mapped[str] = mapped_column(Text, primary_key=True)
    requester_id: Mapped[str] = mapped_column(Text, nullable=False, default="")
    requester_type: Mapped[str] = mapped_column(Text, nullable=False)
    subject_id: Mapped[str] = mapped_column(Text, nullable=False, default="")
    subject_type: Mapped[str] = mapped_column(Text, nullable=False)
    entitlement_id: Mapped[str] = mapped_column(Text, nullable=False, default="")
    entitlement_name: Mapped[str] = mapped_column(Text, nullable=False, default="")
    application: Mapped[str] = mapped_column(Text, nullable=False, default="")
    #: Nullable: a request can exist before it has been priced.
    risk_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    risk_category: Mapped[str] = mapped_column(Text, nullable=False, default="")
    approval_required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    policy_basis: Mapped[str] = mapped_column(Text, nullable=False, default="")
    #: Semicolon-separated SoD ids, empty when the check came back clean.
    sod_conflicts: Mapped[str] = mapped_column(Text, nullable=False, default="")
    approver_id: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(Text, nullable=False)
    justification: Mapped[str] = mapped_column(Text, nullable=False, default="")
    decision_note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[str] = mapped_column(Text, nullable=False, default="")
    decided_at: Mapped[str] = mapped_column(Text, nullable=False, default="")
    granted_at: Mapped[str] = mapped_column(Text, nullable=False, default="")
