"""Whether an entitlement may be granted, decided from policy data.

This is the one place the product's central question is answered, and it is
answered deterministically: same subject, same entitlement, same verdict, every
time.  No model is consulted.  The conversational bot may *describe* what it
expects the verdict to be, but the request it proposes is re-evaluated here
before anything is written, and this verdict wins.

The approval threshold is read out of the policy rows, never hardcoded.  The
policy agent's prompt already tells the model that policy is the source of truth
for thresholds (``app/agents/prompts.py``); the deterministic path holds itself
to the same standard, so editing ``POL005`` changes behaviour without a release.
"""

from __future__ import annotations

import re
from typing import Any

from app.core.config import Settings
from app.core.exceptions import MCPToolError, RecordNotFoundError
from app.core.logging import get_logger
from app.domain.models import DecisionVerdict, SodConflict, Subject
from app.domain.ports import ToolProvider

logger = get_logger(__name__)

ENTITLEMENTS_MCP = "entitlements_mcp"
POLICY_MCP = "policy_mcp"
SOD_TEST_MCP = "sod_test_mcp"

#: The policy `type` that means "a human has to say yes".
HUMAN_APPROVAL = "HUMAN_APPROVAL"

#: Matches the rule text those policies carry, e.g. `risk_score >= 70`.
RISK_RULE = re.compile(r"risk_score\s*(>=|>)\s*(\d+)", re.IGNORECASE)

AUTO_GRANT_BASIS = "No HUMAN_APPROVAL policy applies at this risk score"
UNSCORED_BASIS = (
    "No risk score on record — treated as requiring approval, because an "
    "unscored entitlement has not been assessed rather than assessed as safe"
)


class DecisionService:
    """Evaluates one (subject, entitlement) pair against policy and SoD rules."""

    def __init__(self, *, settings: Settings, tools: ToolProvider) -> None:
        self._settings = settings
        self._tools = tools

    async def evaluate(
        self,
        subject: Subject,
        *,
        entitlement_id: str | None = None,
        entitlement_name: str | None = None,
    ) -> DecisionVerdict:
        """Decide whether *subject* may hold the named entitlement.

        Either identifier will do; the id wins when both are given.
        """
        entitlement = await self._resolve_entitlement(entitlement_id, entitlement_name)
        name = str(entitlement.get("entitlement_name", ""))

        risk_score, risk_category = await self._risk(name)
        approval_required, policy_basis = await self._approval(risk_score)
        conflicts = await self._sod_conflicts(name, subject.entitlements)

        if conflicts and self._settings.sod_conflict_requires_approval:
            reason = ", ".join(c.render() for c in conflicts)
            approval_required = True
            policy_basis = (
                f"{policy_basis}; separation of duties conflict ({reason}) "
                "requires approval"
            )

        return DecisionVerdict(
            subject_id=subject.employee_id,
            entitlement_id=str(entitlement.get("entitlement_id", "")),
            entitlement_name=name,
            application=str(entitlement.get("application", "")),
            risk_score=risk_score,
            risk_category=risk_category,
            approval_required=approval_required,
            policy_basis=policy_basis,
            sod_conflicts=conflicts,
            already_held=name in subject.entitlements,
        )

    async def catalog(self) -> list[dict[str, Any]]:
        """The entitlement catalog joined with risk and the approval verdict.

        Lets a client label an entitlement before anyone requests it, without a
        round trip per row.
        """
        entitlements = await self._tools.call_tool(
            ENTITLEMENTS_MCP, "list_entitlements", {"limit": 200}
        )
        scores = await self._tools.call_tool(
            ENTITLEMENTS_MCP, "list_risk_scores", {"limit": 200}
        )
        by_name = {
            str(s.get("entitlement_name")): s for s in _as_list(scores) if isinstance(s, dict)
        }
        thresholds = await self._approval_thresholds()

        rows: list[dict[str, Any]] = []
        for record in _as_list(entitlements):
            if not isinstance(record, dict):
                continue
            name = str(record.get("entitlement_name", ""))
            score = by_name.get(name, {})
            risk_score = _as_int(score.get("risk_score"))
            required, basis = _match_thresholds(thresholds, risk_score)
            rows.append(
                {
                    **record,
                    "risk_score": risk_score,
                    "risk_category": str(score.get("risk_category") or ""),
                    "approval_required": required,
                    "policy_basis": basis,
                }
            )
        return rows

    # -------------------------------------------------------------- internals
    async def _resolve_entitlement(
        self, entitlement_id: str | None, entitlement_name: str | None
    ) -> dict[str, Any]:
        """Find the catalog row, by id if we have one, else by exact name."""
        if entitlement_id:
            try:
                record = await self._tools.call_tool(
                    ENTITLEMENTS_MCP,
                    "get_entitlement",
                    {"entitlement_id": entitlement_id.strip().upper()},
                )
            except MCPToolError:
                record = None
            if isinstance(record, dict) and record.get("entitlement_id"):
                return record

        if entitlement_name:
            matches = await self._tools.call_tool(
                ENTITLEMENTS_MCP,
                "list_entitlements",
                {"entitlement_name": entitlement_name.strip(), "limit": 5},
            )
            rows = [r for r in _as_list(matches) if isinstance(r, dict)]
            if len(rows) == 1:
                return rows[0]
            if len(rows) > 1:
                raise RecordNotFoundError(
                    f"'{entitlement_name}' matches {len(rows)} entitlements; "
                    "name the entitlement id instead.",
                    details={"candidates": [r.get("entitlement_id") for r in rows]},
                )

        raise RecordNotFoundError(
            "No catalog entitlement matches that identifier.",
            details={
                "entitlement_id": entitlement_id,
                "entitlement_name": entitlement_name,
            },
        )

    async def _risk(self, entitlement_name: str) -> tuple[int | None, str]:
        """The stored risk score and category, or (None, "") when unscored."""
        try:
            record = await self._tools.call_tool(
                ENTITLEMENTS_MCP, "get_risk_score", {"entitlement_name": entitlement_name}
            )
        except MCPToolError:
            logger.info("No risk score on record for %s", entitlement_name)
            return None, ""
        if not isinstance(record, dict):
            return None, ""
        return _as_int(record.get("risk_score")), str(record.get("risk_category") or "")

    async def _approval_thresholds(self) -> list[tuple[int, str]]:
        """Every HUMAN_APPROVAL policy as (threshold, human-readable basis).

        A policy whose rule this cannot parse is skipped with a warning rather
        than silently dropped — it means policy has grown a clause the code does
        not understand, which somebody needs to see.
        """
        policies = await self._tools.call_tool(
            POLICY_MCP, "list_policies", {"type": HUMAN_APPROVAL, "limit": 100}
        )
        thresholds: list[tuple[int, str]] = []
        for policy in _as_list(policies):
            if not isinstance(policy, dict):
                continue
            rule = str(policy.get("rule", ""))
            match = RISK_RULE.search(rule)
            if not match:
                logger.warning(
                    "HUMAN_APPROVAL policy %s has a rule this service cannot "
                    "evaluate and was skipped: %r",
                    policy.get("policy_id"),
                    rule,
                )
                continue
            threshold = int(match.group(2))
            # `>` and `>=` differ by one on integer scores.
            if match.group(1) == ">":
                threshold += 1
            basis = f"{policy.get('policy_id')} ({policy.get('policy_name')} — {rule})"
            thresholds.append((threshold, basis))
        return sorted(thresholds)

    async def _approval(self, risk_score: int | None) -> tuple[bool, str]:
        thresholds = await self._approval_thresholds()
        return _match_thresholds(thresholds, risk_score)

    async def _sod_conflicts(
        self, entitlement_name: str, held: tuple[str, ...]
    ) -> tuple[SodConflict, ...]:
        """Rules that pair *entitlement_name* with something the subject holds."""
        if not held:
            return ()
        rules = await self._tools.call_tool(
            SOD_TEST_MCP, "list_sod_rules", {"entitlement": entitlement_name, "limit": 100}
        )
        holdings = {h.upper() for h in held}
        conflicts: list[SodConflict] = []
        for rule in _as_list(rules):
            if not isinstance(rule, dict):
                continue
            first = str(rule.get("entitlement_1", ""))
            second = str(rule.get("entitlement_2", ""))
            # The filtered listing can only match on one side; the other side is
            # the entitlement that would collide with what they already hold.
            counterpart = second if first.upper() == entitlement_name.upper() else first
            if counterpart.upper() in holdings:
                conflicts.append(
                    SodConflict(
                        sod_id=str(rule.get("sod_id", "")),
                        conflicting_entitlement=counterpart,
                        severity=str(rule.get("severity") or ""),
                    )
                )
        return tuple(conflicts)


def _match_thresholds(
    thresholds: list[tuple[int, str]], risk_score: int | None
) -> tuple[bool, str]:
    """Apply the parsed policy thresholds to one risk score.

    An unscored entitlement requires approval.  Absence of an assessment is not
    an assessment of safety, and the alternative would auto-grant anything
    missing from the risk data.
    """
    if risk_score is None:
        return True, UNSCORED_BASIS

    matched = [basis for threshold, basis in thresholds if risk_score >= threshold]
    if not matched:
        return False, f"{AUTO_GRANT_BASIS} (risk score {risk_score})"
    # Thresholds are sorted ascending, so the last match is the strictest policy
    # the score trips — the one worth quoting to an approver.
    return True, matched[-1]


def _as_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        for key in ("items", "results", "data"):
            if isinstance(value.get(key), list):
                return value[key]
    return []


def _as_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
