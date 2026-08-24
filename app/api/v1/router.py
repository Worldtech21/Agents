"""v1 router aggregation."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.endpoints import agents, chat, health, personas, requests

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(chat.router)
api_router.include_router(agents.router)
api_router.include_router(personas.router)
api_router.include_router(requests.router)
