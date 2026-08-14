"""HTTP-level tests against the real ASGI app (fake model + fake MCP)."""

from __future__ import annotations

import json

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.container import ApplicationContainer
from app.main import create_app
from tests.conftest import FakeModelProvider, FakeToolProvider


@pytest.fixture
async def client(settings, specs, monkeypatch):
    """Boot the app with fakes substituted at the composition root."""
    original_init = ApplicationContainer.__init__

    def patched_init(self, s, sp=None, **kwargs):
        original_init(
            self,
            s,
            specs,
            model_provider=FakeModelProvider(reply="All done."),
            tool_provider=FakeToolProvider(),
        )

    monkeypatch.setattr(ApplicationContainer, "__init__", patched_init)

    app = create_app(settings)
    transport = ASGITransport(app=app)
    async with (
        AsyncClient(transport=transport, base_url="http://test") as http,
        app.router.lifespan_context(app),
    ):
        yield http


async def test_health_reports_ready_and_lists_agents(client):
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["graph_ready"] is True
    assert body["agents"] == ["alpha_agent", "beta_agent"]
    assert body["error"] is None


async def test_capabilities_advertises_all_seven_modes(client):
    body = (await client.get("/api/v1/chat/capabilities")).json()
    assert set(body["graph_stream_modes"]) == {
        "values",
        "updates",
        "messages",
        "custom",
        "debug",
        "tasks",
        "checkpoints",
    }
    assert body["event_stream_version"] == "v2"
    assert "on_tool_start" in body["event_types"]


async def test_agents_endpoint_exposes_mcp_binding(client):
    agents = (await client.get("/api/v1/agents")).json()
    assert [a["name"] for a in agents] == ["alpha_agent", "beta_agent"]
    assert agents[0]["mcp_servers"] == ["research"]

    one = (await client.get("/api/v1/agents/alpha_agent")).json()
    assert one["title"] == "Alpha"


async def test_unknown_agent_returns_a_structured_404(client):
    response = await client.get("/api/v1/agents/nope")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "agent_not_found"


async def test_complete_returns_the_final_answer(client):
    response = await client.post("/api/v1/chat", json={"message": "hello"})
    assert response.status_code == 200
    body = response.json()
    assert body["answer"] == "All done."
    assert body["thread_id"]


async def test_chat_requires_a_message(client):
    response = await client.post("/api/v1/chat", json={})
    assert response.status_code == 422


async def test_sse_stream_is_well_formed_and_covers_all_modes(client):
    payload = {"message": "hello", "thread_id": "t-sse"}
    seen_events: list[str] = []
    modes: set[str] = set()

    async with client.stream("POST", "/api/v1/chat/stream", json=payload) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        current_event = None
        async for line in response.aiter_lines():
            if line.startswith("event:"):
                current_event = line.split(":", 1)[1].strip()
                seen_events.append(current_event)
            elif line.startswith("data:") and current_event:
                body = json.loads(line.split(":", 1)[1].strip())
                assert body["thread_id"] == "t-sse"
                assert "seq" in body and "channel" in body
                if body["channel"] == "graph":
                    modes.add(body["event"])

    assert "control.stream.start" in seen_events
    assert "control.stream.end" in seen_events
    assert modes == {
        "values",
        "updates",
        "messages",
        "custom",
        "debug",
        "tasks",
        "checkpoints",
    }, f"missing modes: {modes}"


async def test_event_stream_emits_the_v2_taxonomy_over_sse(client):
    events: set[str] = set()
    async with client.stream(
        "POST", "/api/v1/chat/events", json={"message": "hello"}
    ) as response:
        assert response.status_code == 200
        async for line in response.aiter_lines():
            if line.startswith("event: events."):
                events.add(line.split("events.", 1)[1].strip())

    assert "on_chain_start" in events
    assert "on_chain_end" in events
    assert any(e.startswith("on_chat_model") for e in events)


async def test_ndjson_stream_is_line_delimited_json(client):
    lines = 0
    async with client.stream(
        "POST", "/api/v1/chat/stream/ndjson", json={"message": "hello"}
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/x-ndjson")
        async for line in response.aiter_lines():
            if line.strip():
                json.loads(line)
                lines += 1
    assert lines > 0


async def test_thread_state_persists_across_requests(client):
    await client.post("/api/v1/chat", json={"message": "hello", "thread_id": "t-mem"})
    body = (await client.get("/api/v1/chat/threads/t-mem")).json()
    assert body["thread_id"] == "t-mem"
    assert body["values"] is not None


async def test_unknown_thread_returns_empty_state_not_an_error(client):
    body = (await client.get("/api/v1/chat/threads/never-seen")).json()
    assert body["thread_id"] == "never-seen"
    assert body["values"] is None
