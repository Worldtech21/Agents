"""Shared DTOs: health, agents, MCP status, errors."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.domain.models import AgentInfo, MCPServerStatus


class ErrorDTO(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class MCPServerStatusDTO(BaseModel):
    name: str
    configured: bool
    connected: bool
    transport: str
    tool_count: int = 0
    error: str | None = None

    @classmethod
    def from_domain(cls, status: MCPServerStatus) -> MCPServerStatusDTO:
        return cls(
            name=status.name,
            configured=status.configured,
            connected=status.connected,
            transport=status.transport,
            tool_count=status.tool_count,
            error=status.error,
        )


class AgentInfoDTO(BaseModel):
    name: str
    title: str
    description: str
    model: str
    mcp_servers: list[str] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list)

    @classmethod
    def from_domain(cls, info: AgentInfo) -> AgentInfoDTO:
        return cls(
            name=info.name,
            title=info.title,
            description=info.description,
            model=info.model,
            mcp_servers=list(info.mcp_servers),
            tools=list(info.tools),
        )


class HealthDTO(BaseModel):
    status: str
    app: str
    environment: str
    graph_ready: bool
    model: str
    supervisor_model: str
    agents: list[str] = Field(default_factory=list)
    mcp_servers: list[MCPServerStatusDTO] = Field(default_factory=list)
    stream_modes: list[str] = Field(default_factory=list)
    error: str | None = None


class StreamCapabilitiesDTO(BaseModel):
    """Advertises exactly what the two streaming endpoints can emit."""

    graph_stream_modes: list[str]
    subgraphs: bool
    event_stream_version: str
    event_types: list[str]
    channels: list[str]
