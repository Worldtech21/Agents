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
    )

    # ---------------------------------------------------------------- app
    app_name: str = "fastapi-langgraph-mcp"
    environment: Literal["local", "dev", "staging", "prod"] = "local"
    debug: bool = False
    api_prefix: str = "/api/v1"
    log_level: str = "INFO"
    log_json: bool = False
    # NoDecode: pydantic-settings JSON-decodes complex types from .env *before*
    # field validators run, which rejects friendly forms like `CORS_ALLOW_ORIGINS=*`
    # or a comma-separated list. NoDecode hands the raw string to _coerce_list.
    cors_allow_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["*"]
    )

    # ---------------------------------------------------------------- llm
    #: Which registered provider serves models. See app/infrastructure/llm/providers.py.
    llm_provider: str = "anthropic"
    #: Optional different provider for the supervisor (e.g. a cheaper router).
    llm_supervisor_provider: str | None = None

    llm_model: str = "claude-opus-5"
    llm_supervisor_model: str | None = None
    llm_max_tokens: int = 64_000
    llm_timeout_seconds: float = 600.0
    llm_max_retries: int = 2
    llm_base_url: str | None = None

    #: Applied only where the provider supports them — Claude Opus 5 / Sonnet 5
    #: reject both with a 400, so the Anthropic adapter drops them.
    llm_temperature: float | None = None
    llm_top_p: float | None = None

    #: Anthropic-only; ignored by providers without adaptive thinking.
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
    anthropic_api_key: str | None = None
    openai_api_key: str | None = None
    groq_api_key: str | None = None
    mistral_api_key: str | None = None
    google_genai_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("GOOGLE_GENAI_API_KEY", "GOOGLE_API_KEY"),
    )
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

    mcp_research_url: str | None = None
    mcp_research_transport: MCPTransport = "streamable_http"
    mcp_research_headers: Annotated[dict[str, str], NoDecode] = Field(default_factory=dict)

    mcp_knowledge_url: str | None = None
    mcp_knowledge_transport: MCPTransport = "streamable_http"
    mcp_knowledge_headers: Annotated[dict[str, str], NoDecode] = Field(default_factory=dict)

    mcp_automation_url: str | None = None
    mcp_automation_transport: MCPTransport = "streamable_http"
    mcp_automation_headers: Annotated[dict[str, str], NoDecode] = Field(default_factory=dict)

    # Optional escape hatch for servers beyond the three first-class ones.
    # Shape: {"name": {"url": "...", "transport": "streamable_http", "headers": {}}}
    mcp_extra_servers: Annotated[dict[str, Any], NoDecode] = Field(default_factory=dict)

    # ------------------------------------------------------------ parsing
    @field_validator(
        "mcp_research_headers",
        "mcp_knowledge_headers",
        "mcp_automation_headers",
        "mcp_extra_servers",
        "llm_extra_params",
        mode="before",
    )
    @classmethod
    def _coerce_json_mapping(cls, value: Any) -> dict[str, Any]:
        return _parse_json_mapping(value, "MCP JSON setting")

    @field_validator("cors_allow_origins", "graph_stream_modes", mode="before")
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
            ("research", self.mcp_research_url, self.mcp_research_transport, self.mcp_research_headers),
            ("knowledge", self.mcp_knowledge_url, self.mcp_knowledge_transport, self.mcp_knowledge_headers),
            ("automation", self.mcp_automation_url, self.mcp_automation_transport, self.mcp_automation_headers),
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
