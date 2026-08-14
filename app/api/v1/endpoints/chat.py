"""Chat endpoints — the two streaming surfaces plus a blocking one."""

from __future__ import annotations

from fastapi import APIRouter, Path, status
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse

from app.api.deps import ChatServiceDep, SettingsDep
from app.infrastructure.streaming.normalizer import KNOWN_STREAM_MODES
from app.infrastructure.streaming.sse import to_ndjson, to_sse
from app.schemas.chat import ChatRequestDTO, ChatResponseDTO, ThreadStateDTO
from app.schemas.common import StreamCapabilitiesDTO

router = APIRouter(prefix="/chat", tags=["chat"])

#: Headers that keep SSE alive through nginx and similar proxies.
SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}

#: The astream_events v2 taxonomy, advertised by /chat/capabilities.
EVENT_TYPES = [
    "on_chain_start",
    "on_chain_stream",
    "on_chain_end",
    "on_chat_model_start",
    "on_chat_model_stream",
    "on_chat_model_end",
    "on_llm_start",
    "on_llm_stream",
    "on_llm_end",
    "on_tool_start",
    "on_tool_end",
    "on_tool_error",
    "on_retriever_start",
    "on_retriever_end",
    "on_prompt_start",
    "on_prompt_end",
    "on_custom_event",
]


@router.post(
    "/stream",
    summary="Stream every LangGraph state-stream mode (SSE)",
    response_class=EventSourceResponse,
)
async def stream_graph(payload: ChatRequestDTO, service: ChatServiceDep):
    """Run the supervisor and stream `graph.astream(...)` across all modes.

    Emits `values`, `updates`, `messages`, `custom`, `debug`, `tasks` and
    `checkpoints` together, with `subgraphs=True` so worker-internal steps are
    labelled by the namespace that produced them.

    SSE event names are `graph.<mode>` and `control.<lifecycle>`.
    """
    request = payload.to_domain()
    return EventSourceResponse(
        to_sse(service.stream_graph(request)),
        headers=SSE_HEADERS,
        ping=15,
    )


@router.post(
    "/events",
    summary="Stream the full astream_events v2 taxonomy (SSE)",
    response_class=EventSourceResponse,
)
async def stream_events(payload: ChatRequestDTO, service: ChatServiceDep):
    """Run the supervisor and stream `graph.astream_events(version="v2")`.

    The finest-grained surface available: per-token model deltas, tool
    start/end/error, and chain spans for every node and subgraph.

    SSE event names are `events.<event_type>` (e.g. `events.on_tool_start`).
    """
    request = payload.to_domain()
    return EventSourceResponse(
        to_sse(service.stream_events(request)),
        headers=SSE_HEADERS,
        ping=15,
    )


@router.post(
    "/stream/ndjson",
    summary="Stream every state-stream mode as newline-delimited JSON",
)
async def stream_graph_ndjson(payload: ChatRequestDTO, service: ChatServiceDep):
    """Same payload as `/chat/stream`, framed as NDJSON for non-browser clients."""
    request = payload.to_domain()
    return StreamingResponse(
        to_ndjson(service.stream_graph(request)),
        media_type="application/x-ndjson",
        headers=SSE_HEADERS,
    )


@router.post(
    "/events/ndjson",
    summary="Stream the astream_events taxonomy as newline-delimited JSON",
)
async def stream_events_ndjson(payload: ChatRequestDTO, service: ChatServiceDep):
    """Same payload as `/chat/events`, framed as NDJSON."""
    request = payload.to_domain()
    return StreamingResponse(
        to_ndjson(service.stream_events(request)),
        media_type="application/x-ndjson",
        headers=SSE_HEADERS,
    )


@router.post(
    "",
    response_model=ChatResponseDTO,
    summary="Run to completion and return the final answer",
)
async def complete(payload: ChatRequestDTO, service: ChatServiceDep) -> ChatResponseDTO:
    """Blocking variant — useful for tests and non-interactive callers."""
    result = await service.complete(payload.to_domain())
    return ChatResponseDTO(**result)


@router.get(
    "/threads/{thread_id}",
    response_model=ThreadStateDTO,
    summary="Read the checkpointed state for a thread",
    responses={status.HTTP_200_OK: {"description": "Empty values when unknown."}},
)
async def get_thread(
    service: ChatServiceDep,
    thread_id: str = Path(description="Thread id used on a prior request."),
) -> ThreadStateDTO:
    state = await service.get_thread_state(thread_id)
    if state is None:
        return ThreadStateDTO(thread_id=thread_id)
    return ThreadStateDTO(
        thread_id=thread_id,
        values=state.get("values"),
        next=state.get("next", []),
        created_at=state.get("created_at"),
        metadata=state.get("metadata"),
    )


@router.get(
    "/capabilities",
    response_model=StreamCapabilitiesDTO,
    summary="Describe what the streaming endpoints emit",
)
async def capabilities(settings: SettingsDep) -> StreamCapabilitiesDTO:
    return StreamCapabilitiesDTO(
        graph_stream_modes=sorted(KNOWN_STREAM_MODES),
        subgraphs=settings.graph_stream_subgraphs,
        event_stream_version="v2",
        event_types=EVENT_TYPES,
        channels=["graph", "events", "control"],
    )
