"""Test fixtures — a fake chat model lets the whole graph run without an API key."""

from __future__ import annotations

import os
from collections.abc import Sequence
from typing import Any

import pytest
from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.runnables import Runnable
from langchain_core.utils.function_calling import convert_to_openai_tool

from app.core.config import Settings
from app.domain.models import AgentSpec

os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-used")


class FakeChatModel(BaseChatModel):
    """Deterministic stand-in for ChatAnthropic.

    Replies with a canned answer and records bound tools, which is enough to
    exercise agent construction, supervisor routing and every stream mode.
    """

    reply: str = "Done."
    bound_tools: list[Any] = []

    @property
    def _llm_type(self) -> str:
        return "fake-chat-model"

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        return ChatResult(
            generations=[ChatGeneration(message=AIMessage(content=self.reply))]
        )

    def bind_tools(self, tools: Sequence[Any], **kwargs: Any) -> Runnable:
        # Must return a RunnableBinding carrying `tools` in kwargs — that is how
        # LangGraph's `_should_bind_tools` detects tools are already bound.
        formatted = [convert_to_openai_tool(tool) for tool in tools]
        return self.bind(tools=formatted, **kwargs)


class FakeModelProvider:
    """ChatModelProvider stand-in."""

    def __init__(self, reply: str = "Done.") -> None:
        self.reply = reply
        self.calls: list[str | None] = []

    def get_model(self, *, model: str | None = None, **overrides: Any) -> FakeChatModel:
        self.calls.append(model)
        return FakeChatModel(reply=self.reply)


class FakeToolProvider:
    """ToolProvider stand-in that hands out no tools."""

    def __init__(self) -> None:
        self.started = False
        self.requested: list[tuple[str, ...]] = []

    async def startup(self) -> None:
        self.started = True

    async def shutdown(self) -> None:
        self.started = False

    async def get_tools(self, server_names: tuple[str, ...]) -> list[Any]:
        self.requested.append(server_names)
        return []

    def status(self) -> list[Any]:
        return []


@pytest.fixture
def settings() -> Settings:
    return Settings(
        anthropic_api_key="test-key",
        environment="local",
        graph_checkpointer="memory",
        mcp_research_url=None,
        mcp_knowledge_url=None,
        mcp_automation_url=None,
    )


@pytest.fixture
def specs() -> tuple[AgentSpec, ...]:
    return (
        AgentSpec(
            name="alpha_agent",
            title="Alpha",
            description="First specialist.",
            prompt="You are alpha.",
            mcp_servers=("research",),
        ),
        AgentSpec(
            name="beta_agent",
            title="Beta",
            description="Second specialist.",
            prompt="You are beta.",
            mcp_servers=("knowledge",),
        ),
    )
