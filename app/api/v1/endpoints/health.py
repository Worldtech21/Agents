"""Liveness and readiness endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.api.deps import ContainerDep, SettingsDep
from app.schemas.common import HealthDTO, LLMProviderDTO, MCPServerStatusDTO

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthDTO, summary="Liveness + dependency status")
async def health(
    container: ContainerDep, settings: SettingsDep, response: Response
) -> HealthDTO:
    """Always answers, even when the graph failed to build.

    A failed build reports `status="degraded"` with the reason in `error`,
    rather than crash-looping the process and hiding the cause.
    """
    ready = container.is_ready
    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    mcp = [MCPServerStatusDTO.from_domain(s) for s in container.tool_provider.status()]

    # `describe` is specific to LLMFactory; a substituted provider need not have it.
    describe = getattr(container.model_provider, "describe", None)
    llm = LLMProviderDTO(**describe()) if callable(describe) else None

    return HealthDTO(
        status="ok" if ready else "degraded",
        app=settings.app_name,
        environment=settings.environment,
        graph_ready=ready,
        model=settings.llm_model,
        supervisor_model=settings.supervisor_model,
        llm=llm,
        agents=[spec.name for spec in container.specs],
        mcp_servers=mcp,
        stream_modes=settings.graph_stream_modes,
        error=container.startup_error,
    )


@router.get("/health/live", summary="Process liveness only")
async def live() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/ready", summary="Readiness — graph compiled and serving")
async def ready(container: ContainerDep, response: Response) -> dict[str, object]:
    if not container.is_ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "not_ready", "error": container.startup_error}
    return {"status": "ready"}
