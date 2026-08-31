# Deployment notes

## The 30-second stream truncation

**Symptom.** A supervisor run streams normally in local dev and through
`docker compose`, but on GKE the trace panel stops partway and the SPA renders
"The run could not be completed — network error". DevTools shows:

```
Failed to load resource: net::ERR_INCOMPLETE_CHUNKED_ENCODING
  .../access-advisor-middleware/api/v1/chat/stream
```

**Cause.** The stack is fronted by the `kalchemy-gateway` Gateway
(`gke-l7-global-external-managed`, 34.120.8.80). For each Service an HTTPRoute
targets, the GKE Gateway controller generates a Compute Engine backend service;
without a policy it gets GCP's default `timeoutSec: 30`.

That 30s is a **wall-clock budget for the entire response**, not an idle
timeout. `POST /api/v1/chat/stream` holds one SSE response open for the whole
run, and the runs measured here take 40-90s — so the load balancer destroys the
connection mid-chunk every time. Two consequences that make this confusing to
diagnose:

- The `ping=15` keep-alive in [chat.py](../app/api/v1/endpoints/chat.py) cannot
  help. Traffic on the connection does not extend a wall-clock budget; only an
  idle timeout would be reset by it.
- It cannot reproduce locally, because no load balancer sits in front of
  `uvicorn` there. The same is true under `docker compose`, where nginx has
  `proxy_read_timeout 1d` and is the only hop.

The failure is a truncated `Transfer-Encoding: chunked` body, so every layer
reports it differently: the browser says `ERR_INCOMPLETE_CHUNKED_ENCODING`,
curl says `(18) transfer closed with outstanding read data remaining`, and the
SPA's fetch reader rejects and lands in the generic `stream_failed` branch.

**Fix.** [`gcp-backend-policy.yaml`](gcp-backend-policy.yaml) — a
`GCPBackendPolicy` raising `timeoutSec` to 3600 on
`access-advisor-middleware-svc`.

```bash
kubectl apply -f k8s/gcp-backend-policy.yaml
```

On a Gateway, `GCPBackendPolicy` is the mechanism. Two things that look like
fixes but are not:

- **`BackendConfig`** is the *Ingress* mechanism. This cluster has no Ingress —
  the CRD is installed, so a manifest applies cleanly and then does nothing.
- **`gcloud compute backend-services update --timeout`** works until the Gateway
  controller next reconciles, which silently reverts it.

### Verifying

The policy attaches, and the generated backend service picks the value up:

```bash
kubectl -n kalchemy get gcpbackendpolicy access-advisor-middleware-timeout \
  -o jsonpath='{.status.conditions}'      # -> reason: Attached

gcloud compute backend-services describe \
  gkegw1-jgyx-kalchem-access-advisor-middleware-8000-78qnvyiusmha \
  --global --format='value(timeoutSec)'   # -> 3600
```

The API reports the new value within seconds, but it takes a few minutes to
reach the load-balancer data plane — a stream started immediately after applying
is still cut at 30s. End-to-end check, which should run to completion and emit
a `control.stream.end` frame:

```bash
curl -sS -N -H 'Content-Type: application/json' -H 'Accept: text/event-stream' \
  -d '{"message":"Recommend entitlements for employee NJ1002.","thread_id":"verify"}' \
  http://34.120.8.80/access-advisor-middleware/api/v1/chat/stream
```

### Reproducing it without a cluster

[`mocks/repro.sh`](../mocks/repro.sh) puts the missing load-balancer hop back in
front of a mock stream, so the failure and the fix can both be seen locally with
no API key, MCP server or cluster access:

```bash
./mocks/repro.sh
```

Case A (30s, as deployed) truncates with curl exit 18; case B (3600s, with the
policy) completes.

### Rolling back

```bash
kubectl delete -f k8s/gcp-backend-policy.yaml
```

The backend service returns to the 30s default, and the bug with it.

## Related: the checkpointer is in-memory

`graph_checkpointer` defaults to `memory`, so thread state lives in one pod's
heap. The `access-advisor-middleware` Deployment currently runs
`replicas: 1`, which is what makes the SPA's fallback path — `GET
/chat/threads/{id}`, used when the final answer did not arrive on the stream —
work at all.

This is not currently broken, but it is load-bearing in a way that is easy to
disturb: scaling to two replicas, or a pod restart mid-run, makes that lookup
hit a pod with no memory of the thread and return an empty answer. Moving to a
persistent checkpointer is the durable answer if this ever needs more than one
replica.
