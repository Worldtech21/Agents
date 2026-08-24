"""Application exception hierarchy (cross-cutting).

Every layer raises these; only the API layer knows how to turn them into HTTP
responses (see ``app.api.errors``).
"""

from __future__ import annotations

from typing import Any


class AppError(Exception):
    """Base class for all deliberate application failures."""

    status_code: int = 500
    code: str = "internal_error"

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "details": self.details}


class ConfigurationError(AppError):
    status_code = 500
    code = "configuration_error"


class LLMProviderError(AppError):
    status_code = 502
    code = "llm_provider_error"


class MCPConnectionError(AppError):
    status_code = 503
    code = "mcp_connection_error"


class MCPToolError(AppError):
    """A directly-invoked MCP tool refused or failed.

    Distinct from :class:`MCPConnectionError`: the server answered, the call did
    not succeed.  ``details['tool']`` names it.
    """

    status_code = 502
    code = "mcp_tool_error"


class AgentNotFoundError(AppError):
    status_code = 404
    code = "agent_not_found"


class RecordNotFoundError(AppError):
    """A record the workflow needs does not exist upstream."""

    status_code = 404
    code = "record_not_found"


class WorkflowError(AppError):
    """The request is well-formed but the workflow cannot honour it."""

    status_code = 409
    code = "workflow_error"


class NotApproverError(AppError):
    """Someone other than the named approver tried to decide a request."""

    status_code = 403
    code = "not_approver"


class GraphNotReadyError(AppError):
    status_code = 503
    code = "graph_not_ready"


class GraphExecutionError(AppError):
    status_code = 500
    code = "graph_execution_error"


class RecursionLimitError(GraphExecutionError):
    status_code = 422
    code = "recursion_limit_exceeded"
