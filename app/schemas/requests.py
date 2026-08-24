"""Request/response DTOs for the access request workflow.

Presentation layer: these validate what arrives over HTTP and render what goes
back.  Domain code never imports them.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.domain.models import (
    AccessRequest,
    DecisionVerdict,
    Persona,
    RequesterType,
    RequestStatus,
    SodConflict,
    Subject,
)


class EntitlementRefDTO(BaseModel):
    """Names one entitlement, by id or by exact name."""

    entitlement_id: str | None = None
    entitlement_name: str | None = None
    justification: str | None = None

    @model_validator(mode="after")
    def _one_identifier(self) -> EntitlementRefDTO:
        if not self.entitlement_id and not self.entitlement_name:
            raise ValueError("Provide either 'entitlement_id' or 'entitlement_name'.")
        return self


class SodConflictDTO(BaseModel):
    sod_id: str
    conflicting_entitlement: str
    severity: str

    @classmethod
    def from_domain(cls, conflict: SodConflict) -> SodConflictDTO:
        return cls(
            sod_id=conflict.sod_id,
            conflicting_entitlement=conflict.conflicting_entitlement,
            severity=conflict.severity,
        )


class SubjectDTO(BaseModel):
    employee_id: str
    subject_type: str
    name: str
    department: str
    job_role: str
    job_level: str
    location: str
    manager_id: str
    entitlements: list[str]

    @classmethod
    def from_domain(cls, subject: Subject) -> SubjectDTO:
        return cls(
            employee_id=subject.employee_id,
            subject_type=subject.subject_type.value,
            name=subject.name,
            department=subject.department,
            job_role=subject.job_role,
            job_level=subject.job_level,
            location=subject.location,
            manager_id=subject.manager_id,
            entitlements=list(subject.entitlements),
        )


class AnalyzeRequestDTO(BaseModel):
    """Ask for a verdict without raising anything."""

    subject_id: str = Field(description="Who the access would be for, e.g. EMP002.")
    entitlement_id: str | None = None
    entitlement_name: str | None = None

    @model_validator(mode="after")
    def _one_identifier(self) -> AnalyzeRequestDTO:
        if not self.entitlement_id and not self.entitlement_name:
            raise ValueError("Provide either 'entitlement_id' or 'entitlement_name'.")
        return self


class VerdictDTO(BaseModel):
    """The deterministic answer: may this be granted, and on what basis."""

    subject_id: str
    entitlement_id: str
    entitlement_name: str
    application: str
    risk_score: int | None
    risk_category: str
    approval_required: bool
    policy_basis: str
    sod_conflicts: list[SodConflictDTO]
    already_held: bool
    #: Who would decide it. Empty when no approval is needed, or when approval is
    #: needed but nobody is on record — `approver_missing` separates the two.
    approver_id: str
    approver_missing: bool

    @classmethod
    def from_domain(cls, verdict: DecisionVerdict, approver_id: str) -> VerdictDTO:
        return cls(
            subject_id=verdict.subject_id,
            entitlement_id=verdict.entitlement_id,
            entitlement_name=verdict.entitlement_name,
            application=verdict.application,
            risk_score=verdict.risk_score,
            risk_category=verdict.risk_category,
            approval_required=verdict.approval_required,
            policy_basis=verdict.policy_basis,
            sod_conflicts=[SodConflictDTO.from_domain(c) for c in verdict.sod_conflicts],
            already_held=verdict.already_held,
            approver_id=approver_id,
            approver_missing=verdict.approval_required and not approver_id,
        )


class AnalyzeResponseDTO(BaseModel):
    subject: SubjectDTO
    verdict: VerdictDTO


class RaiseRequestDTO(BaseModel):
    """Raise one or more requests for one subject.

    The list form is what lets HR submit a whole accepted recommendation at once;
    each entitlement is still judged on its own.
    """

    requester_id: str = Field(description="The acting persona, e.g. EMP002 or HR001.")
    requester_type: Literal["EMPLOYEE", "HR"] = "EMPLOYEE"
    subject_id: str = Field(description="Who the access is for.")
    entitlements: list[EntitlementRefDTO] = Field(min_length=1)
    justification: str = ""

    def to_domain_type(self) -> RequesterType:
        return RequesterType(self.requester_type)


class DecisionDTO(BaseModel):
    """A manager approving or rejecting."""

    approver_id: str = Field(description="Must match the request's approver.")
    note: str = Field(default="", description="Shown to the requester as the reason.")


class AccessRequestDTO(BaseModel):
    request_id: str
    requester_id: str
    requester_type: str
    subject_id: str
    subject_type: str
    entitlement_id: str
    entitlement_name: str
    application: str
    status: str
    approval_required: bool
    policy_basis: str
    approver_id: str
    risk_score: int | None
    risk_category: str
    sod_conflicts: list[str]
    justification: str
    decision_note: str
    created_at: str
    decided_at: str
    granted_at: str

    @classmethod
    def from_domain(cls, record: AccessRequest) -> AccessRequestDTO:
        return cls(
            request_id=record.request_id,
            requester_id=record.requester_id,
            requester_type=record.requester_type.value,
            subject_id=record.subject_id,
            subject_type=record.subject_type.value,
            entitlement_id=record.entitlement_id,
            entitlement_name=record.entitlement_name,
            application=record.application,
            status=record.status.value,
            approval_required=record.approval_required,
            policy_basis=record.policy_basis,
            approver_id=record.approver_id,
            risk_score=record.risk_score,
            risk_category=record.risk_category,
            sod_conflicts=[c for c in record.sod_conflicts.split(";") if c],
            justification=record.justification,
            decision_note=record.decision_note,
            created_at=record.created_at,
            decided_at=record.decided_at,
            granted_at=record.granted_at,
        )


class PersonaDTO(BaseModel):
    actor_id: str
    name: str
    mode: str
    department: str
    job_role: str
    manager_id: str
    pending_approvals: int

    @classmethod
    def from_domain(cls, persona: Persona) -> PersonaDTO:
        return cls(
            actor_id=persona.actor_id,
            name=persona.name,
            mode=persona.mode,
            department=persona.department,
            job_role=persona.job_role,
            manager_id=persona.manager_id,
            pending_approvals=persona.pending_approvals,
        )


class CatalogEntryDTO(BaseModel):
    """One catalog entitlement with its risk and its approval verdict."""

    entitlement_id: str
    entitlement_name: str
    application: str
    owner: str = ""
    risk_score: int | None = None
    risk_category: str = ""
    approval_required: bool = False
    policy_basis: str = ""


#: Exposed so a client can render the states without hardcoding them.
REQUEST_STATUSES = [status.value for status in RequestStatus]
