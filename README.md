# fastapi-langgraph-mcp

FastAPI service exposing a **LangGraph supervisor** over **three MCP-connected ReAct agents**,
streaming **every event LangGraph emits**.

- **1 supervisor** — routes work, then writes the final answer.
- **3 ReAct workers** — `research_agent`, `knowledge_agent`, `automation_agent`, each bound to its own MCP server.
- **Two streaming surfaces**, covering LangGraph's full output: all 7 `astream` modes *and* the `astream_events` v2 taxonomy.
- **N-layered architecture** with dependency inversion — the domain layer imports no framework.

---

## Quick start

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

cp .env.example .env          # then set GOOGLE_API_KEY and your MCP URLs
uvicorn app.main:app --reload
```

Open <http://localhost:8000/docs>.

The service **boots without any MCP server configured** — placeholder URLs are detected and
skipped, and those agents simply start with no MCP tools. `GET /api/v1/health` tells you exactly
what connected and what didn't.

```bash
curl -N -X POST localhost:8000/api/v1/chat/stream \
  -H 'content-type: application/json' \
  -d '{"message":"Summarise our Q3 churn drivers and open a follow-up ticket."}'
```

---

## Layers

Dependencies point **inward only**. `domain/` imports nothing from the project; `api/` imports
everything. Swapping Gemini for another provider, or MCP for a local tool registry, is a
configuration change because the inner layers depend on Protocols in `domain/ports.py`, not on
adapters.

```
app/
├── main.py                     Composition root: app factory + lifespan
│
├── core/                       Cross-cutting (config, logging, errors, DI container)
│   ├── config.py               pydantic-settings; MCP placeholder detection
│   ├── container.py            ApplicationContainer — the ONLY place adapters are chosen
│   ├── exceptions.py           AppError hierarchy carrying HTTP status + code
│   └── logging.py
│
├── domain/                     ← innermost. Pure dataclasses + Protocols. No framework imports.
│   ├── models.py               AgentSpec, RunRequest, StreamEnvelope, MCPServerSpec, ...
│   └── ports.py                ChatModelProvider, ToolProvider, AgentBuilder, CheckpointerFactory
│
├── infrastructure/             Adapters implementing the ports
│   ├── llm/factory.py               Multi-provider model construction + caching
│   ├── llm/providers.py             One adapter per vendor (Gemini is the default)
│   ├── mcp/client.py                MultiServerMCPClient wrapper, graceful degradation
│   ├── checkpoint/factory.py        Thread persistence
│   └── streaming/
│       ├── serialization.py         Makes any LangGraph payload JSON-safe
│       ├── normalizer.py            Raw chunks → StreamEnvelope
│       └── sse.py                   SSE / NDJSON encoding
│
├── agents/                     Reusable agent building blocks
│   ├── specs.py                The roster, as data
│   ├── prompts.py              Prompt text only
│   ├── factory.py              ReactAgentFactory — one factory for every worker
│   ├── supervisor.py           SupervisorFactory
│   └── hooks.py                Custom-event emission (`emit`)
│
├── graph/
│   ├── builder.py              Compiles workers + supervisor into one graph
│   └── runner.py               invoke / stream_graph / stream_events
│
├── services/                   Application layer — use cases, no HTTP
│   ├── chat_service.py
│   └── agent_service.py
│
├── schemas/                    DTOs (HTTP request/response validation)
└── api/                        Presentation layer
    ├── deps.py                 FastAPI dependency providers
    ├── errors.py               AppError → HTTP response
    └── v1/endpoints/           chat.py, agents.py, health.py
```

---

## Streaming: what "all events" actually means

LangGraph exposes two independent surfaces. This service exposes **both**, normalised into one
envelope shape so a client writes a single parser.

### 1. `POST /api/v1/chat/stream` — state stream (`graph.astream`)

Runs with **all seven** stream modes at once and `subgraphs=True`:

| Mode | Carries |
|---|---|
| `values` | Full graph state after each step |
| `updates` | Per-node state deltas |
| `messages` | Token-by-token LLM output + metadata |
| `custom` | Whatever graph code writes via `emit()` |
| `tasks` | Task start/finish with inputs, results, errors |
| `checkpoints` | Checkpoint writes (thread persistence) |
| `debug` | Verbose per-step trace |

`subgraphs=True` means worker-internal steps arrive labelled with the namespace that produced
them, rather than collapsed into the supervisor's stream.

> **`custom` only carries what you write.** LangGraph never populates it on its own. This project
> wires a `pre_model_hook` on the supervisor and every worker (`app/agents/hooks.py`) so the
> channel is live out of the box — and `emit("my.event", **fields)` is safe to call from any node
> or tool.

### 2. `POST /api/v1/chat/events` — event stream (`astream_events`, v2)

The finest-grained surface: `on_chat_model_stream` token deltas, `on_tool_start` / `on_tool_end` /
`on_tool_error`, and `on_chain_*` spans for every node and subgraph, each with `run_id`,
`parent_ids`, `tags` and `metadata`.

`GET /api/v1/chat/capabilities` returns the live list of both.

### Envelope shape

Every chunk on every endpoint:

```jsonc
{
  "seq": 12,                       // gapless — detect drops
  "channel": "graph",              // graph | events | control
  "event": "updates",              // stream mode, or event type
  "namespace": ["research_agent"], // which subgraph produced it
  "thread_id": "…",
  "ts": 1731000000.123,
  "payload": { }
}
```

SSE event names are `<channel>.<event>` (`graph.updates`, `events.on_tool_start`,
`control.stream.start`), so a browser can subscribe selectively:

```js
const es = new EventSource(url);
es.addEventListener("graph.messages", e => render(JSON.parse(e.data).payload.chunk));
es.addEventListener("events.on_tool_start", e => showSpinner(JSON.parse(e.data)));
```

**Errors are reported in-band**, not as a mid-stream HTTP failure: the run ends with
`control.stream.error` carrying a code, then closes. Streams always terminate with
`control.stream.end` or `control.stream.error`.

NDJSON variants (`/chat/stream/ndjson`, `/chat/events/ndjson`) serve non-browser clients.

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/chat/stream` | All 7 state-stream modes (SSE) |
| `POST` | `/api/v1/chat/events` | Full `astream_events` v2 taxonomy (SSE) |
| `POST` | `/api/v1/chat/stream/ndjson` | Same as `/chat/stream`, NDJSON |
| `POST` | `/api/v1/chat/events/ndjson` | Same as `/chat/events`, NDJSON |
| `POST` | `/api/v1/chat` | Run to completion, return final answer |
| `GET` | `/api/v1/chat/threads/{id}` | Checkpointed state for a thread |
| `GET` | `/api/v1/chat/capabilities` | What the streams can emit |
| `GET` | `/api/v1/agents` | Workers, their MCP servers, resolved tools |
| `GET` | `/api/v1/agents/mcp` | Per-server MCP connectivity |
| `GET` | `/api/v1/health` | Liveness + dependency status |

Pass the same `thread_id` on a later request to continue a conversation.

---

## MCP configuration

Each agent binds to MCP servers by **name**; names come from `.env`:

```bash
MCP_RESEARCH_URL=https://your-research-mcp.example.com/mcp
MCP_RESEARCH_TRANSPORT=streamable_http
MCP_RESEARCH_HEADERS={"Authorization": "Bearer …"}
```

`.env.example` ships all three as placeholders. Any URL left blank or still containing `<…>` is
treated as unconfigured: that agent starts with no MCP tools and the service still boots. Set
`MCP_REQUIRED=true` to make connection failures fatal instead.

Additional servers beyond the three go in `MCP_EXTRA_SERVERS` as JSON, then get referenced from an
`AgentSpec`.

### Adding a fourth agent

1. Add its URL to `.env`, and to `Settings` + `mcp_server_settings()` if it's a first-class server
   (or drop it into `MCP_EXTRA_SERVERS`).
2. Append an `AgentSpec` to `DEFAULT_AGENT_SPECS` in `app/agents/specs.py`.

The factory, supervisor, graph builder and API need no changes — the roster is data.

---

## Model configuration

Defaults target **Google Gemini 3.7 Flash** through `langchain-google-genai`:

| Setting | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `google_genai` | Any name registered in `app/infrastructure/llm/providers.py` |
| `LLM_MODEL` | `gemini-3.7-flash` | `LLM_SUPERVISOR_MODEL` can point routing at a cheaper model |
| `GOOGLE_API_KEY` | — | Required. `GOOGLE_GENAI_API_KEY` and `LLM_API_KEY` also work |
| `LLM_MAX_TOKENS` | `64000` | Sent as Gemini's `max_output_tokens` |
| `LLM_TEMPERATURE` / `LLM_TOP_P` | unset | Honoured by Gemini; left to the model's own defaults |

`LLM_EFFORT` / `LLM_THINKING` / `LLM_THINKING_DISPLAY` are Anthropic-shaped and are ignored while
`LLM_PROVIDER=google_genai`. Gemini's reasoning controls are model-dependent, so pass them
explicitly when your model supports them:

```bash
LLM_EXTRA_PARAMS={"thinking_budget": 8192, "include_thoughts": true}
```

### Other providers

`LLM_PROVIDER` selects the vendor and each one ships as an optional extra:

```bash
pip install -e ".[openai]"     # then LLM_PROVIDER=openai, LLM_MODEL=gpt-4o
pip install -e ".[anthropic]"  # then LLM_PROVIDER=anthropic, LLM_MODEL=claude-opus-5
```

Registered names: `google_genai`, `anthropic`, `openai`, `openai_compatible`, `azure_openai`,
`bedrock`, `ollama`, `groq`, `mistral`. Each adapter declares which parameters its vendor actually
honours, so unsupported ones are dropped rather than silently ignored by the SDK.
`LLM_SUPERVISOR_PROVIDER` can route the supervisor at a different vendor than the workers.

---

## Tests

```bash
pytest          # 39 tests, no API key and no MCP server required
ruff check app tests
```

A fake chat model (`tests/conftest.py`) exercises the real graph, so the suite verifies genuine
behaviour rather than mocks: that **all seven stream modes actually emit**, that the event stream
carries the v2 taxonomy, that every payload survives a real `json.loads` round-trip, that subgraph
namespaces are preserved, and that threads persist.

`examples/client.py` is a runnable consumer for both streaming endpoints.

---

## Production notes

- **Checkpointer.** `InMemorySaver` is per-process — threads do not survive a restart and are not
  shared between replicas. For multi-replica deploys install
  `pip install ".[postgres]"` and swap the factory in `app/infrastructure/checkpoint/factory.py`.
- **Proxies.** SSE needs buffering disabled. The endpoints already send
  `X-Accel-Buffering: no` and `Cache-Control: no-transform`; make sure your proxy honours them,
  and set a read timeout longer than your longest run.
- **Auth/CORS.** `CORS_ALLOW_ORIGINS` defaults to `*`. Restrict it, and add auth in
  `app/api/deps.py`, before exposing this publicly.
- **`debug` stream mode is verbose.** Trim `GRAPH_STREAM_MODES` for high-traffic clients.
- **Deprecation.** LangGraph 1.x emits a warning that `create_react_agent` has moved to
  `langchain.agents.create_agent` (removal in 2.0). It's kept here because `langgraph-supervisor`
  still calls the same function internally, so migrating only our call site would not silence it
  and would add a `langchain` dependency. Revisit when `langgraph-supervisor` moves.
# Agents
# Agents
