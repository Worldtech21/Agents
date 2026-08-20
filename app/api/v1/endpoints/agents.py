"""Agent topology endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Path

from app.api.deps import AgentServiceDep, ContainerDep
from app.infrastructure.llm.base import available_providers, get_adapter
from app.infrastructure.llm.factory import LLMFactory
from app.schemas.common import AgentInfoDTO, LLMProviderInfoDTO, MCPServerStatusDTO

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("", response_model=list[AgentInfoDTO], summary="List the worker agents")
async def list_agents(service: AgentServiceDep) -> list[AgentInfoDTO]:
    """Each worker, the MCP servers it is bound to, and the tools it resolved."""
    return [AgentInfoDTO.from_domain(info) for info in service.list_agents()]


@router.get("/mcp", response_model=list[MCPServerStatusDTO], summary="MCP server status")
async def mcp_status(service: AgentServiceDep) -> list[MCPServerStatusDTO]:
    """Per-server connectivity — the first place to look when tools are missing."""
    return [MCPServerStatusDTO.from_domain(status) for status in service.mcp_status()]


@router.get(
    "/providers",
    response_model=list[LLMProviderInfoDTO],
    summary="LLM providers and whether their packages are installed",
)
async def providers(container: ContainerDep) -> list[LLMProviderInfoDTO]:
    """Every registered provider, so you can see what `LLM_PROVIDER` accepts.

    `installed` reflects whether the vendor package can actually be imported —
    providers ship as optional extras.
    """
    active = container.settings.llm_provider
    return [
        LLMProviderInfoDTO(
            name=adapter.name,
            package=adapter.package,
            installed=LLMFactory.is_installed(adapter),
            default_model=adapter.default_model,
            requires_api_key=adapter.capabilities.requires_api_key,
            env_key=adapter.env_key,
            active=adapter.name == active,
        )
        for adapter in (get_adapter(name) for name in available_providers())
    ]


# Declared after /mcp and /providers so those literal paths win over the wildcard.
@router.get("/{name}", response_model=AgentInfoDTO, summary="Describe one agent")
async def get_agent(
    service: AgentServiceDep,
    name: str = Path(description="Agent name, e.g. `research_agent`."),
) -> AgentInfoDTO:
    return AgentInfoDTO.from_domain(service.get_agent(name))
