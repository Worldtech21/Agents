"""ASGI entrypoint.

Run with:  uvicorn app.main:app --reload
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import register_exception_handlers
from app.api.v1.router import api_router
from app.core.config import Settings, get_settings
from app.core.container import ApplicationContainer
from app.core.logging import configure_logging, get_logger

logger = get_logger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Application factory — one call per process (or per test)."""
    settings = settings or get_settings()
    configure_logging(settings.log_level, settings.log_json)

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        container = ApplicationContainer(settings)
        application.state.container = container
        application.state.settings = settings
        logger.info("Starting %s (%s)", settings.app_name, settings.environment)
        await container.startup()
        try:
            yield
        finally:
            await container.shutdown()

    application = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        description=(
            "FastAPI service exposing a LangGraph supervisor over three "
            "MCP-connected ReAct agents, streaming every event LangGraph emits."
        ),
        lifespan=lifespan,
        debug=settings.debug,
        root_path=settings.root_path
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(application)
    application.include_router(api_router, prefix=settings.api_prefix)

    @application.get("/", tags=["meta"], summary="Service metadata")
    async def root() -> dict[str, str]:
        return {
            "name": settings.app_name,
            "docs": "/docs",
            "health": f"{settings.api_prefix}/health",
            "capabilities": f"{settings.api_prefix}/chat/capabilities",
        }

    return application


app = create_app()
