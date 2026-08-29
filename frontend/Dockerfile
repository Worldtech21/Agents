# syntax=docker/dockerfile:1
#
# The Access Advisor web client.  Two stages: Vite compiles the SPA, then an
# unprivileged nginx serves the static bundle and proxies /api to the FastAPI
# service.  That proxy is the same arrangement the Vite dev server gives locally
# (see vite.config.ts) — the browser only ever talks to one origin, so SSE is
# never buffered by a CORS preflight and VITE_API_BASE_URL stays empty.

FROM node:20-alpine AS builder

WORKDIR /app

# Dependencies install from the lockfile in their own layer, so editing src/
# does not reinstall react and friends on every build.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src

# Baked into the bundle at build time.  The defaults mirror .env.example; the
# empty base URL is what keeps requests same-origin for the nginx stage below.
# Override with --build-arg only when the API is reached on its own hostname.
ARG VITE_API_BASE_URL="http://access-advisor-middleware-svc.kalchemy.svc.cluster.local:8000/access-advisor-middleware"
ARG VITE_API_PREFIX=/api/v1
ARG VITE_API_TIMEOUT_MS=30000
ARG VITE_STREAM_MODES=updates,messages,custom
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_API_PREFIX=$VITE_API_PREFIX \
    VITE_API_TIMEOUT_MS=$VITE_API_TIMEOUT_MS \
    VITE_STREAM_MODES=$VITE_STREAM_MODES

# Where the bundle expects to be served from. Vite writes absolute asset URLs
# into index.html, so this has to be decided at build time — "/" is right for
# compose and for any host that serves this app at its root, but on a shared
# ingress that already has something at "/" the app needs its own prefix or its
# /assets requests land on the other app (k8s: --build-arg VITE_BASE=/access-advisor/,
# paired with VITE_API_BASE_URL=/access-advisor). Trailing slash is required.
ARG VITE_BASE=/access-advisor-front-end/

RUN npm run build -- --base="$VITE_BASE"
# CMD ["npm", "run", "dev"]
# -- --base="$VITE_BASE"

FROM nginxinc/nginx-unprivileged:1.27-alpine

# GKE's baseline pod security wants a non-root container on an unprivileged
# port; this image already runs as uid 101 and listens on 8080.
USER 101

# The base image's entrypoint renders templates/ with envsubst at container
# start, so the backend address is a Deployment env var rather than a rebuild.
# It must have no trailing slash or nginx would rewrite the proxied path.
# NGINX_ENTRYPOINT_LOCAL_RESOLVERS makes the entrypoint publish the pod's own
# nameservers as $NGINX_LOCAL_RESOLVERS, which the /api block needs; the filter
# limits substitution to those two names so nginx's own $variables survive.
ENV BACKEND_ORIGIN=http://access-advisor-middleware-svc.kalchemy.svc.cluster.local:8000 \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 \
    NGINX_ENVSUBST_FILTER=^(BACKEND_ORIGIN|NGINX_LOCAL_RESOLVERS)
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 8080

# Liveness only: nginx serving its own bundle says nothing about the API, which
# is probed on its own pods.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
