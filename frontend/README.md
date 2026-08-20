# Access Advisor — frontend

React + TypeScript client for the FastAPI/LangGraph supervisor service in [`../app`](../app).
The visual design is transcribed from `../Modern UI design request/Access Advisor.dc.html`;
the data is entirely live.

```bash
npm install
cp .env.example .env        # defaults work against a local backend
npm run dev                 # http://localhost:5173, proxying /api to 127.0.0.1:8000
```

Run the backend alongside it:

```bash
uvicorn app.main:app --reload
```

Other scripts: `npm run build`, `npm run preview`, `npx tsc --noEmit`.

---

## Layers

Dependencies point in one direction only: `presentation → application → bff → infrastructure`.
No layer imports from one above it.

```
src/
├─ presentation/     What is on screen. Atoms → molecules → organisms → screens.
├─ application/      React Query hooks, streaming orchestration, client state.
├─ bff/              Wire shapes → view models. Pure functions, no React.
└─ infrastructure/   Axios client, SSE transport, env config, wire types.
```

### `infrastructure/`

| File | Role |
| --- | --- |
| `config/env.ts` | The only reader of `import.meta.env`. |
| `api/client.ts` | Axios instance; normalises every failure into `ApiError`. |
| `api/sse.ts` | SSE over `fetch` — `EventSource` cannot POST, and both stream endpoints take a JSON body. |
| `api/endpoints.ts` | One function per backend route. The only place a URL is built. |
| `types/api.ts` | Transcription of the Pydantic DTOs in `app/schemas/`. |
| `types/supervisor.ts` | The supervisor's JSON output contract from `app/agents/prompts.py`. |

`presentation/` may not import from `types/api.ts`. Components consume view models, so a
field rename in a DTO stops at the BFF.

### `bff/`

Pure transformations. Every one is a plain function over data — no hooks, no React — so they
can be replayed against a captured stream (see *Verification* below).

| File | Transformation |
| --- | --- |
| `parse/supervisorPayload.ts` | `answer: string` → the structured contract, or a typed parse failure. |
| `outcome.ts` | The single entry point for a run: recommendation \| refusal \| unparseable. |
| `mappers/recommendation.mapper.ts` | The supervisor's JSON → the report's view models. |
| `mappers/trace.mapper.ts` | `StreamEnvelope[]` → the agent-trace panel. |
| `mappers/answer.mapper.ts` | Recovers the final answer from a state stream. |
| `mappers/agents.mapper.ts` | `/agents` + `/agents/mcp` → the sidebar mesh. |
| `mappers/health.mapper.ts` | `/health` → the readiness banner and footer. |
| `mappers/chat.mapper.ts` | Console turns, citation chips, suggested questions. |
| `mappers/queue.mapper.ts` | Watchlist + cached outcomes → queue rows and stats. |
| `tone.ts` | Every semantic-colour decision. Components receive a `Tone`, never a hex value. |

### `application/`

| File | Role |
| --- | --- |
| `queryClient.ts` | React Query config and the key registry. |
| `hooks/useSupervisorStream.ts` | One streamed run: abort control, envelope coalescing, teardown. |
| `hooks/useRecommendation.ts` | Runs a recommendation and caches the outcome under a query key. |
| `hooks/useConsole.ts` | Conversation turns and thread continuity. |
| `hooks/useServiceHealth.ts`, `useAgentMesh.ts`, `useCapabilities.ts` | Plain queries. |
| `state/*` | Theme, navigation, and the local queue watchlist. |

### `presentation/`

`styles/tokens.css` is a verbatim transcription of the design's `:root` and
`[data-theme="dark"]` blocks — same hex values, same keyframes. Theming is one attribute on
`<html>`; nothing else reads the theme.

---

## Backend integration

| Screen region | Endpoint |
| --- | --- |
| Sidebar agent mesh | `GET /agents`, `GET /agents/mcp` |
| Readiness banner, model footer | `GET /health` |
| Recommendation report | `POST /chat/stream` (SSE), parsed via the supervisor contract |
| Agent trace panel | `graph.updates` + `graph.custom` envelopes from the same stream |
| Console | `POST /chat/stream`, thread id reused across turns |
| Answer fallback | `GET /chat/threads/{thread_id}` |

### The queue has no endpoint

The service exposes no route that lists new joiners. The supervisor answers about one employee
id at a time and returns `MISSING_EMPLOYEE_ID` for a request that names none
(`app/agents/prompts.py`). So the queue is a **local watchlist**: the ids this operator has
asked about, persisted in `localStorage`. Every other column — name, department, role, start
date, peer-group size, SoD state — is read back out of a completed run, and the stat tiles are
computed from those runs. Nothing in the queue is invented; with no runs yet it shows an empty
state rather than placeholder rows.

If a `GET /joiners` route is added later, `QueueProvider` is the only file that changes.

### Three endings, not one

A run can end three ways and all three are answers, not errors:

1. **A recommendation** — rendered as the report.
2. **A refusal** — `MISSING_EMPLOYEE_ID`, `EMPLOYEE_NOT_FOUND`, `READ_ONLY`, `INCOMPLETE_DATA`.
   Rendered as a stated outcome with the supervisor's own sentence.
3. **A reply that broke the JSON contract** — rendered with the reason and the raw text.

Only transport failures reject the promise and reach an error state.

---

## Verification

The BFF mappers are pure, so they can be replayed against a captured stream:

```bash
curl -sN -X POST localhost:8000/api/v1/chat/stream \
  -H 'Content-Type: application/json' \
  -d '{"message":"Recommend entitlements for employee NJ1004."}' > stream.txt
```

Each `data:` line is a `StreamEnvelope`; feed the parsed array to `toTracePanel`,
`extractFinalAnswer` and `parseSupervisorAnswer` to check the mapping without a browser.

## Read-only

Nothing in this client writes. "Open access request" is deliberately inert — the whole service
is read-only, and wiring that button to anything that mutates would contradict the guarantee
the sidebar states.
