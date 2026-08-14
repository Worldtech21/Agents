"""Agent topology endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Path

from app.api.deps import AgentServiceDep
from app.schemas.common import AgentInfoDTO, MCPServerStatusDTO

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("", response_model=list[AgentInfoDTO], summary="List the worker agents")
async def list_agents(service: AgentServiceDep) -> list[AgentInfoDTO]:
    """Each worker, the MCP servers it is bound to, and the tools it resolved."""
    return [AgentInfoDTO.from_domain(info) for info in service.list_agents()]


@router.get("/mcp", response_model=list[MCPServerStatusDTO], summary="MCP server status")
async def mcp_status(service: AgentServiceDep) -> list[MCPServerStatusDTO]:
    """Per-server connectivity — the first place to look when tools are missing."""
    return [MCPServerStatusDTO.from_domain(status) for status in service.mcp_status()]


@router.get("/{name}", response_model=AgentInfoDTO, summary="Describe one agent")
async def get_agent(
    service: AgentServiceDep,
    name: str = Path(description="Agent name, e.g. `research_agent`."),
) -> AgentInfoDTO:
    return AgentInfoDTO.from_domain(service.get_agent(name))
