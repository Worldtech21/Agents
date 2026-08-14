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


SettingsDep = Annotated[Settings, Depends(get_settings)]
ContainerDep = Annotated[ApplicationContainer, Depends(get_container)]
ChatServiceDep = Annotated[ChatService, Depends(get_chat_service)]
AgentServiceDep = Annotated[AgentService, Depends(get_agent_service)]
