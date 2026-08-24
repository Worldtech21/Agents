"""FastAPI dependency providers.

Endpoints depend on these, not on the container directly, so the container can
be swapped wholesale in tests via ``app.dependency_overrides``.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from app.core.config import Settings, get_settings
from app.core.container import ApplicationContainer
from app.services.agent_service import AgentService
from app.services.chat_service import ChatService
from app.services.decision_service import DecisionService
from app.services.directory_service import DirectoryService
from app.services.persona_service import PersonaService
from app.services.request_service import RequestService


def get_container(request: Request) -> ApplicationContainer:
    """The container stashed on ``app.state`` during lifespan startup."""
    return request.app.state.container


def get_chat_service(
    container: Annotated[ApplicationContainer, Depends(get_container)],
) -> ChatService:
    return container.chat_service


def get_agent_service(
    container: Annotated[ApplicationContainer, Depends(get_container)],
) -> AgentService:
    return container.agent_service


def get_request_service(
    container: Annotated[ApplicationContainer, Depends(get_container)],
) -> RequestService:
    """Available even when the graph failed to build — it needs only MCP."""
    return container.request_service


def get_persona_service(
    container: Annotated[ApplicationContainer, Depends(get_container)],
) -> PersonaService:
    return container.persona_service


def get_decision_service(
    container: Annotated[ApplicationContainer, Depends(get_container)],
) -> DecisionService:
    return container.decision_service


def get_directory_service(
    container: Annotated[ApplicationContainer, Depends(get_container)],
) -> DirectoryService:
    return container.directory_service


SettingsDep = Annotated[Settings, Depends(get_settings)]
ContainerDep = Annotated[ApplicationContainer, Depends(get_container)]
ChatServiceDep = Annotated[ChatService, Depends(get_chat_service)]
AgentServiceDep = Annotated[AgentService, Depends(get_agent_service)]
RequestServiceDep = Annotated[RequestService, Depends(get_request_service)]
PersonaServiceDep = Annotated[PersonaService, Depends(get_persona_service)]
DecisionServiceDep = Annotated[DecisionService, Depends(get_decision_service)]
DirectoryServiceDep = Annotated[DirectoryService, Depends(get_directory_service)]
