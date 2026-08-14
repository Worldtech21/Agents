"""Multi-provider chat-model factory.

Implements the :class:`ChatModelProvider` port. Callers ask for a model by role;
the factory decides which vendor serves it, resolves credentials, filters the
parameters that vendor actually honours, and caches the result.

Selection order for a given call:

1. explicit ``provider=`` argument (per-agent override from its ``AgentSpec``)
2. ``LLM_PROVIDER`` from configuration

The rest of the application never learns which vendor answered.
"""

from __future__ import annotations

import os
from typing import Any

from app.core.config import Settings
from app.core.exceptions import ConfigurationError
from app.core.logging import get_logger
from app.infrastructure.llm.base import (
    ModelRequest,
    ProviderAdapter,
    available_providers,
    get_adapter,
)
from app.infrastructure.llm.providers import register_builtin_providers

logger = get_logger(__name__)

register_builtin_providers()


class LLMFactory:
    """Builds chat models for any registered provider."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._cache: dict[tuple[Any, ...], Any] = {}

    # ------------------------------------------------------------------ public
    def get_model(
        self, *, model: str | None = None, provider: str | None = None, **overrides: Any
    ) -> Any:
        """Return a LangChain chat model ready to bind tools to."""
        adapter = get_adapter(provider or self._settings.llm_provider)
        request = self._build_request(adapter, model=model, overrides=overrides)

        key = (adapter.name, _hashable(request))
        cached = self._cache.get(key)
        if cached is not None:
            return cached

        instance = adapter.create(request)
        self._cache[key] = instance

        logger.info(
            "Built chat model",
            extra={
                "provider": adapter.name,
                "model": request.model,
                "thinking": (request.thinking or {}).get("type"),
                "effort": request.effort,
                "max_tokens": request.max_tokens,
            },
        )
        return instance

    def describe(self) -> dict[str, Any]:
        """Provider metadata for health/diagnostics endpoints."""
        adapter = get_adapter(self._settings.llm_provider)
        return {
            "provider": adapter.name,
            "package": adapter.package,
            "installed": self.is_installed(adapter),
            "model": self._settings.llm_model or adapter.default_model,
            "supervisor_provider": self._settings.supervisor_provider,
            "supervisor_model": self._settings.supervisor_model,
            "available_providers": available_providers(),
        }

    @staticmethod
    def is_installed(adapter: ProviderAdapter) -> bool:
        try:
            adapter._load_class()
        except ConfigurationError:
            return False
        return True

    def clear_cache(self) -> None:
        self._cache.clear()

    # ----------------------------------------------------------------- internal
    def _build_request(
        self, adapter: ProviderAdapter, *, model: str | None, overrides: dict[str, Any]
    ) -> ModelRequest:
        settings = self._settings
        caps = adapter.capabilities

        resolved_model = model or settings.llm_model or adapter.default_model
        if not resolved_model:
            raise ConfigurationError(
                f"No model configured for provider '{adapter.name}'. Set LLM_MODEL.",
                details={"provider": adapter.name},
            )

        request = ModelRequest(
            model=resolved_model,
            api_key=self._resolve_api_key(adapter),
            base_url=settings.llm_base_url,
            temperature=settings.llm_temperature,
            top_p=settings.llm_top_p,
            max_tokens=settings.llm_max_tokens,
            timeout=settings.llm_timeout_seconds,
            max_retries=settings.llm_max_retries,
            extra={**settings.llm_extra_params, **self._provider_extras(adapter)},
        )

        # Thinking/effort are Anthropic-shaped; other providers ignore them.
        if caps.thinking:
            request.thinking = (
                {"type": "adaptive", "display": settings.llm_thinking_display}
                if settings.llm_thinking == "adaptive"
                else {"type": "disabled"}
            )
        if caps.effort:
            request.effort = settings.llm_effort

        request.extra.update(overrides)
        return request

    def _provider_extras(self, adapter: ProviderAdapter) -> dict[str, Any]:
        """Settings that only make sense for one provider."""
        settings = self._settings
        if adapter.name == "azure_openai":
            return {
                key: value
                for key, value in {
                    "azure_endpoint": settings.azure_openai_endpoint,
                    "api_version": settings.azure_openai_api_version,
                    "azure_deployment": settings.azure_openai_deployment,
                }.items()
                if value
            }
        if adapter.name == "bedrock" and settings.aws_region:
            return {"region_name": settings.aws_region}
        return {}

    def _resolve_api_key(self, adapter: ProviderAdapter) -> str | None:
        """Find a credential, or explain precisely what to set.

        Order: the generic ``LLM_API_KEY``, then the provider-specific setting,
        then the vendor's own environment variable (which its SDK would read
        anyway). Providers authenticated by other means are skipped.
        """
        settings = self._settings
        candidates = [
            settings.llm_api_key,
            getattr(settings, f"{adapter.name}_api_key", None),
        ]
        if adapter.env_key:
            candidates.append(os.environ.get(adapter.env_key))

        for candidate in candidates:
            if candidate:
                return candidate

        if adapter.capabilities.requires_api_key:
            raise ConfigurationError(
                f"No API key for provider '{adapter.name}'. Set {adapter.env_key} "
                f"(or LLM_API_KEY) in your environment or .env file.",
                details={"provider": adapter.name, "env_key": adapter.env_key},
            )
        return None


def _hashable(request: ModelRequest) -> tuple[Any, ...]:
    """Stable cache key for a request, including nested dicts."""
    return (
        request.model,
        request.api_key,
        request.base_url,
        request.temperature,
        request.top_p,
        request.max_tokens,
        request.timeout,
        request.max_retries,
        repr(request.thinking),
        request.effort,
        repr(sorted(request.extra.items(), key=lambda kv: kv[0])),
    )
