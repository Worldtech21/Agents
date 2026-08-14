"""Request/response DTOs for the chat endpoints.

These belong to the presentation layer: they validate what arrives over HTTP and
convert it into domain objects.  Domain code never imports them.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.domain.models import ChatMessage, RunRequest

StreamModeName = Literal[
    "values", "updates", "messages", "custom", "debug", "tasks", "checkpoints"
]


class ChatMessageDTO(BaseModel):
    role: Literal["user", "assistant", "system"] = "user"
    content: str = Field(min_length=1)

    def to_domain(self) -> ChatMessage:
        return ChatMessage(role=self.role, content=self.content)


class ChatRequestDTO(BaseModel):
    """One turn against the supervisor graph.

    Supply either ``message`` (the common case) or a full ``messages`` list.
    """

    message: str | None = Field(default=None, description="Shorthand for a single user turn.")
    messages: list[ChatMessageDTO] | None = Field(
        default=None, description="Full turn list; takes precedence over `message`."
    )
    thread_id: str | None = Field(
        default=None,
        description="Reuse a thread id to continue a prior conversation.",
    )
    recursion_limit: int | None = Field(default=None, ge=1, le=250)
    stream_modes: list[StreamModeName] | None = Field(
        default=None,
        description="Override which LangGraph stream modes to emit. Defaults to all.",
    )
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("messages")
    @classmethod
    def _non_empty(cls, value: list[ChatMessageDTO] | None) -> list[ChatMessageDTO] | None:
        if value is not None and not value:
            raise ValueError("messages must not be empty when provided")
        return value

    def to_domain(self) -> RunRequest:
        if self.messages:
            turns = [m.to_domain() for m in self.messages]
        elif self.message:
            turns = [ChatMessage(role="user", content=self.message)]
        else:
            raise ValueError("Provide either 'message' or a non-empty 'messages' list.")

        request = RunRequest(
            messages=turns,
            recursion_limit=self.recursion_limit,
            stream_modes=list(self.stream_modes) if self.stream_modes else None,
            metadata=self.metadata,
        )
        if self.thread_id:
            request.thread_id = self.thread_id
        return request


class ChatResponseDTO(BaseModel):
    thread_id: str
    answer: str
    messages: list[dict[str, Any]] = Field(default_factory=list)


class ThreadStateDTO(BaseModel):
    thread_id: str
    values: dict[str, Any] | None = None
    next: list[str] = Field(default_factory=list)
    created_at: str | None = None
    metadata: dict[str, Any] | None = None
