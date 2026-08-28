"""Application configuration.

Cross-cutting layer: every other layer reads configuration from here and
nothing here imports from another layer.  Settings are sourced from the
environment (and an optional ``.env`` file) via pydantic-settings.
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Annotated, Any, Literal

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

MCPTransport = Literal["streamable_http", "sse", "websocket", "stdio"]

# URLs still holding one of these markers are treated as "not configured".
PLACEHOLDER_MARKERS = ("<", "changeme", "your-", "example.invalid", "REPLACE_ME")


def is_placeholder(url: str | None) -> bool:
    """True when *url* is empty or still contains a placeholder marker."""
    if not url or not url.strip():
        return True
    lowered = url.lower()
    return any(marker.lower() in lowered for marker in PLACEHOLDER_MARKERS)


def _parse_json_mapping(value: Any, field: str) -> dict[str, Any]:
    """Accept either a JSON string or an already-parsed mapping."""
    if value is None or value == "":
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError as exc:  # pragma: no cover - config error path
            raise ValueError(f"{field} must be valid JSON: {exc}") from exc
        if not isinstance(parsed, dict):
            raise ValueError(f"{field} must decode to a JSON object")
        return parsed
    raise ValueError(f"{field} must be a JSON object or mapping")


class Settings(BaseSettings):
    """Typed view over the process environment."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        # Fields carrying a validation_alias (GOOGLE_API_KEY, AWS_REGION) are
        # otherwise settable *only* by that alias — direct construction in tests
        # would silently drop the field-name spelling.
        populate_by_name=True,
    )

    # ---------------------------------------------------------------- app
    app_name: str = "fastapi-langgraph-mcp"
    environment: Literal["local", "dev", "staging", "prod"] = "local"
    debug: bool = False
    api_prefix: str = "/api/v1"
    log_level: str = "INFO"
    log_json: bool = False
    root_path: str = ""
    # NoDecode: pydantic-settings JSON-decodes complex types from .env *before*
    # field validators run, which rejects friendly forms like `CORS_ALLOW_ORIGINS=*`
    # or a comma-separated list. NoDecode hands the raw string to _coerce_list.
    cors_allow_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["*"]
    )

    # ---------------------------------------------------------------- llm
    #: Which registered provider serves models. See app/infrastructure/llm/providers.py.
    llm_provider: str = "google_genai"
    #: Optional different provider for the supervisor (e.g. a cheaper router).
    llm_supervisor_provider: str | None = None

    llm_model: str = "gemini-3.7-flash"
    llm_supervisor_model: str | None = None
    llm_max_tokens: int = 64_000
    llm_timeout_seconds: float = 600.0
    llm_max_retries: int = 2
    llm_base_url: str | None = None

    #: Applied only where the provider supports them. Gemini honours both;
    #: adapters for models that reject them (Claude Opus 5 / Sonnet 5) drop them.
    llm_temperature: float | None = None
    llm_top_p: float | None = None

    #: Reasoning controls, spelled Anthropic-style and translated per provider.
    #: `llm_effort` is how hard the model thinks before answering — Anthropic
    #: takes it as `output_config.effort`, Gemini 3 as `thinking_level` (its
    #: scale stops at `high`, so `xhigh`/`max` clamp there).
    #: The two thinking settings decide whether that reasoning is *returned*:
    #: `summarized` puts it on the stream, where the console and the assistant
    #: render it live; `omitted` keeps it off the wire. The Gemini adapter maps
    #: them onto `include_thoughts`.
    llm_effort: Literal["low", "medium", "high", "xhigh", "max"] = "high"
    llm_thinking: Literal["adaptive", "disabled"] = "adaptive"
    llm_thinking_display: Literal["summarized", "omitted"] = "summarized"

    #: Generic key, tried before the provider-specific ones below.
    llm_api_key: str | None = None

    # Provider-specific credentials. The field name must be
    # `<provider>_api_key` so LLMFactory._resolve_api_key can find it.
    # Explicit aliases matter: pydantic-settings loads `.env` into this object
    # but NOT into os.environ, so a conventional name like GOOGLE_API_KEY would
    # otherwise never be seen.
    #: The default provider's credential: GOOGLE_API_KEY or GOOGLE_GENAI_API_KEY.
    google_genai_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("GOOGLE_GENAI_API_KEY", "GOOGLE_API_KEY"),
    )
    anthropic_api_key: str | None = None
    openai_api_key: str | None = None
    groq_api_key: str | None = None
    mistral_api_key: str | None = None
    azure_openai_api_key: str | None = None
    openai_compatible_api_key: str | None = None

    # Azure OpenAI addresses a deployment, not a bare model name.
    azure_openai_endpoint: str | None = None
    azure_openai_api_version: str | None = "2024-10-21"
    azure_openai_deployment: str | None = None

    # Bedrock uses the standard AWS credential chain; only the region is ours.
    aws_region: str | None = Field(
        default=None, validation_alias=AliasChoices("AWS_REGION", "AWS_DEFAULT_REGION")
    )

    #: Vendor-specific escape hatch merged into the constructor kwargs.
    llm_extra_params: Annotated[dict[str, Any], NoDecode] = Field(default_factory=dict)

    # -------------------------------------------------------------- graph
    graph_recursion_limit: int = 40
    graph_checkpointer: Literal["memory", "none"] = "memory"
    graph_supervisor_output_mode: Literal["full_history", "last_message"] = "last_message"
    graph_stream_subgraphs: bool = True
    graph_stream_modes: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: [
            "values",
            "updates",
            "messages",
            "custom",
            "tasks",
            "checkpoints",
            "debug",
        ]
    )

    # ---------------------------------------------------------------- mcp
    mcp_required: bool = False
    mcp_connect_timeout_seconds: float = 30.0
    #: How long a server that failed to connect stays written off before the
    #: next call retries it. Without this a server that was down at boot stays
    #: dead for the process lifetime, so bringing it back needs a restart.
    mcp_retry_after_seconds: float = 30.0

    mcp_new_joiners_url: str | None = None
    mcp_new_joiners_transport: MCPTransport = "streamable_http"
    mcp_new_joiners_headers: Annotated[dict[str, str], NoDecode] = Field(default_factory=dict)

    mcp_peer_affinity_url: str | None = None
    mcp_peer_affinity_transport: MCPTransport = "streamable_http"
    mcp_peer_affinity_headers: Annotated[dict[str, str], NoDecode] = Field(default_factory=dict)

    mcp_identities_url: str | None = None
    mcp_identities_transport: MCPTransport = "streamable_http"
    mcp_identities_headers: Annotated[dict[str, str], NoDecode] = Field(default_factory=dict)

    mcp_entitlements_url: str | None = None
    mcp_entitlements_transport: MCPTransport = "streamable_http"
    mcp_entitlements_headers: Annotated[dict[str, str], NoDecode] = Field(default_factory=dict)
    
    mcp_sod_test_url: str | None = None
    mcp_sod_test_transport: MCPTransport = "streamable_http"
    mcp_sod_test_headers: Annotated[dict[str, str], NoDecode] = Field(default_factory=dict)
    
    mcp_policy_url: str | None = None
    mcp_policy_transport: MCPTransport = "streamable_http"
    mcp_policy_headers: Annotated[dict[str, str], NoDecode] = Field(default_factory=dict)

    #: The request tracker. Deliberately bound to no AgentSpec — its write tools
    #: are driven from `app/services`, never from an LLM.
    mcp_requests_url: str | None = None
    mcp_requests_transport: MCPTransport = "streamable_http"
    mcp_requests_headers: Annotated[dict[str, str], NoDecode] = Field(default_factory=dict)


    # ------------------------------------------------------------- workflow
    #: The two identities that Employee mode can act as. No login: the client
    #: names its actor, and /personas is the list of actors it may name.
    demo_employee_ids: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["EMP001", "EMP002"]
    )
    #: The single HR persona. Not an identity record — HR acts on others' behalf.
    demo_hr_actor_id: str = "HR001"
    demo_hr_actor_name: str = "HR Operations"

    #: False runs the whole approval workflow without touching identity data —
    #: requests still move through their states, nothing is actually granted.
    provisioning_enabled: bool = True
    #: Whether an SoD conflict escalates an otherwise auto-grantable entitlement
    #: to manager approval. Policy has no clause on this; it is our choice.
    sod_conflict_requires_approval: bool = True

    # Optional escape hatch for servers beyond the three first-class ones.
    # Shape: {"name": {"url": "...", "transport": "streamable_http", "headers": {}}}
    mcp_extra_servers: Annotated[dict[str, Any], NoDecode] = Field(default_factory=dict)

    # ------------------------------------------------------------ parsing
    @field_validator(
        "mcp_new_joiners_headers",
        "mcp_peer_affinity_headers",
        "mcp_identities_headers",
        "mcp_policy_headers",
        "mcp_sod_test_headers",
        "mcp_entitlements_headers",
        "mcp_requests_headers",
        "mcp_extra_servers",
        "llm_extra_params",
        mode="before",
    )
    @classmethod
    def _coerce_json_mapping(cls, value: Any) -> dict[str, Any]:
        return _parse_json_mapping(value, "MCP JSON setting")

    @field_validator(
        "cors_allow_origins", "graph_stream_modes", "demo_employee_ids", mode="before"
    )
    @classmethod
    def _coerce_list(cls, value: Any) -> Any:
        if isinstance(value, str):
            stripped = value.strip()
            if stripped.startswith("["):
                return json.loads(stripped)
            return [item.strip() for item in stripped.split(",") if item.strip()]
        return value

    # ----------------------------------------------------------- derived
    @property
    def supervisor_model(self) -> str:
        return self.llm_supervisor_model or self.llm_model

    @property
    def supervisor_provider(self) -> str:
        return self.llm_supervisor_provider or self.llm_provider

    def mcp_server_settings(self) -> dict[str, dict[str, Any]]:
        """Collapse the flat MCP env vars into a name -> connection mapping.

        Servers whose URL is missing or still a placeholder are omitted, which
        lets the whole application boot and serve traffic before any MCP
        endpoint exists.
        """
        servers: dict[str, dict[str, Any]] = {}
        first_class = (
            ("new_joiners_mcp", self.mcp_new_joiners_url, self.mcp_new_joiners_transport, self.mcp_new_joiners_headers),
            ("peer_affinity_mcp", self.mcp_peer_affinity_url, self.mcp_peer_affinity_transport, self.mcp_peer_affinity_headers),
            ("identities_mcp", self.mcp_identities_url, self.mcp_identities_transport, self.mcp_identities_headers),
            ("sod_test_mcp", self.mcp_sod_test_url, self.mcp_sod_test_transport, self.mcp_sod_test_headers),
            ("policy_mcp", self.mcp_policy_url, self.mcp_policy_transport, self.mcp_policy_headers),
            ("entitlements_mcp", self.mcp_entitlements_url, self.mcp_entitlements_transport, self.mcp_entitlements_headers),
            ("requests_mcp", self.mcp_requests_url, self.mcp_requests_transport, self.mcp_requests_headers),
        )
        for name, url, transport, headers in first_class:
            if is_placeholder(url):
                continue
            servers[name] = {
                "url": url,
                "transport": transport,
                "headers": headers or {},
            }

        for name, raw in self.mcp_extra_servers.items():
            if not isinstance(raw, dict):
                continue
            if raw.get("transport") != "stdio" and is_placeholder(raw.get("url")):
                continue
            servers[name] = dict(raw)

        return servers


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Process-wide settings singleton."""
    return Settings()
