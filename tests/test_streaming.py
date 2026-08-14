"""End-to-end streaming tests: the graph really runs, every mode really emits."""

from __future__ import annotations

import json

import pytest
from langchain_core.messages import AIMessageChunk, HumanMessage

from app.agents.factory import ReactAgentFactory
from app.agents.supervisor import SupervisorFactory
from app.domain.models import RunRequest, StreamChannel
from app.graph.builder import GraphBuilder
from app.graph.runner import GraphRunner
from app.infrastructure.checkpoint.factory import CheckpointerFactoryImpl
from app.infrastructure.streaming.normalizer import (
    KNOWN_STREAM_MODES,
    StreamNormalizer,
)
from app.infrastructure.streaming.serialization import to_jsonable
from app.infrastructure.streaming.sse import encode_envelope
from tests.conftest import FakeModelProvider, FakeToolProvider


@pytest.fixture
async def runner(settings, specs) -> GraphRunner:
    tool_provider = FakeToolProvider()
    await tool_provider.startup()
    builder = GraphBuilder(
        settings=settings,
        agent_factory=ReactAgentFactory(
            settings=settings,
            model_provider=FakeModelProvider(),
            tool_provider=tool_provider,
        ),
        supervisor_factory=SupervisorFactory(
            settings=settings, model_provider=FakeModelProvider()
        ),
        checkpointer_factory=CheckpointerFactoryImpl(settings),
        specs=specs,
    )
    graph, _ = await builder.build()
    return GraphRunner(settings=settings, graph=graph)


async def test_graph_stream_emits_every_configured_mode(runner):
    """All seven LangGraph stream modes must actually appear on the wire."""
    from app.domain.models import ChatMessage

    request = RunRequest(
        messages=[ChatMessage(role="user", content="hi")],
        stream_modes=sorted(KNOWN_STREAM_MODES),
    )

    envelopes = [e async for e in runner.stream_graph(request)]

    assert envelopes, "stream produced nothing"
    assert envelopes[0].channel is StreamChannel.CONTROL
    assert envelopes[0].event == "stream.start"
    assert envelopes[-1].event == "stream.end", (
        f"stream ended with {envelopes[-1].event}: {envelopes[-1].payload}"
    )

    seen = {e.event for e in envelopes if e.channel is StreamChannel.GRAPH}
    missing = KNOWN_STREAM_MODES - seen
    assert not missing, f"stream modes never emitted: {sorted(missing)}"

    # Sequence numbers must be gapless so clients can detect drops.
    assert [e.seq for e in envelopes] == list(range(len(envelopes)))


async def test_graph_stream_payloads_are_json_serialisable(runner):
    from app.domain.models import ChatMessage

    request = RunRequest(messages=[ChatMessage(role="user", content="hi")])
    async for envelope in runner.stream_graph(request):
        chunk = encode_envelope(envelope)
        # Must survive a real json round-trip, not just repr().
        json.loads(chunk["data"])
        assert chunk["event"].startswith(("graph.", "events.", "control."))


async def test_event_stream_covers_the_v2_taxonomy(runner):
    from app.domain.models import ChatMessage

    request = RunRequest(messages=[ChatMessage(role="user", content="hi")])
    envelopes = [e async for e in runner.stream_events(request)]

    assert envelopes[-1].event == "stream.end", (
        f"event stream ended with {envelopes[-1].event}: {envelopes[-1].payload}"
    )
    events = {e.event for e in envelopes if e.channel is StreamChannel.EVENTS}
    # A run must produce chain spans and model calls at minimum.
    assert "on_chain_start" in events
    assert "on_chain_end" in events
    assert any(name.startswith("on_chat_model") for name in events), events

    for envelope in envelopes:
        json.loads(encode_envelope(envelope)["data"])


async def test_subgraph_namespaces_are_preserved(runner):
    """Worker-internal steps must be labelled, not collapsed into the parent."""
    from app.domain.models import ChatMessage

    request = RunRequest(
        messages=[ChatMessage(role="user", content="hi")], stream_modes=["updates"]
    )
    envelopes = [e async for e in runner.stream_graph(request)]
    assert any(e.namespace for e in envelopes), "no namespaced chunk was emitted"


async def test_invoke_returns_final_state(runner):
    from app.domain.models import ChatMessage

    state = await runner.invoke(RunRequest(messages=[ChatMessage(role="user", content="hi")]))
    assert "messages" in state
    assert state["messages"]


async def test_thread_state_round_trips(runner):
    from app.domain.models import ChatMessage

    request = RunRequest(messages=[ChatMessage(role="user", content="hi")])
    await runner.invoke(request)
    state = await runner.get_state(request.thread_id)
    assert state is not None
    assert state["values"]["messages"]


# --------------------------------------------------------------------- units
def test_normalizer_handles_every_astream_shape():
    n = StreamNormalizer("t1")

    three = n.normalize_graph_chunk((("agent:1",), "updates", {"a": 1}))
    assert three.event == "updates" and three.namespace == ("agent:1",)

    two_mode = n.normalize_graph_chunk(("values", {"b": 2}))
    assert two_mode.event == "values" and two_mode.namespace == ()

    two_ns = n.normalize_graph_chunk((("sub",), {"c": 3}), default_mode="values")
    assert two_ns.namespace == ("sub",) and two_ns.event == "values"

    bare = n.normalize_graph_chunk({"d": 4}, default_mode="values")
    assert bare.event == "values" and bare.payload == {"d": 4}


def test_messages_mode_is_split_into_chunk_and_metadata():
    n = StreamNormalizer("t1")
    envelope = n.normalize_graph_chunk(
        ((), "messages", (AIMessageChunk(content="hello"), {"langgraph_node": "agent"}))
    )
    assert envelope.payload["chunk"]["content"] == "hello"
    assert envelope.payload["metadata"]["langgraph_node"] == "agent"


def test_serializer_flattens_messages_and_survives_odd_objects():
    class Opaque:
        def __init__(self) -> None:
            self.visible = 1
            self._hidden = 2

    payload = to_jsonable(
        {
            "msg": HumanMessage(content="hi", id="m1"),
            "set": {1, 2},
            "err": ValueError("boom"),
            "obj": Opaque(),
        }
    )
    json.dumps(payload)  # must not raise
    assert payload["msg"]["content"] == "hi"
    assert sorted(payload["set"]) == [1, 2]
    assert payload["err"]["error_type"] == "ValueError"
    assert payload["obj"]["visible"] == 1
    assert "_hidden" not in payload["obj"]


def test_serializer_stops_at_max_depth():
    node: dict = {}
    cursor = node
    for _ in range(40):
        cursor["next"] = {}
        cursor = cursor["next"]
    json.dumps(to_jsonable(node))  # must terminate, not recurse forever
