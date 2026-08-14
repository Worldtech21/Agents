"""Anthropic chat-model adapter implementing :class:`ChatModelProvider`.

This is the only module in the project that knows the LLM vendor.  Agents ask
the provider for a model; they never construct one.
"""

from __future__ import annotations

from typing import Any

from langchain_anthropic import ChatAnthropic

from app.core.config import Settings
from app.core.exceptions import ConfigurationError, LLMProviderError
from app.core.logging import get_logger

logger = get_logger(__name__)


class AnthropicChatModelProvider:
    """Builds and caches ``ChatAnthropic`` instances.

    Models are cached by their full parameter set, so repeated agent builds
    share one client (and therefore one connection pool).
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._cache: dict[tuple[Any, ...], ChatAnthropic] = {}

    def get_model(self, *, model: str | None = None, **overrides: Any) -> ChatAnthropic:
        settings = self._settings
        if not settings.anthropic_api_key:
            raise ConfigurationError(
                "ANTHROPIC_API_KEY is not set — the graph cannot build a chat model."
            )

        params: dict[str, Any] = {
            "model": model or settings.llm_model,
            "max_tokens": settings.llm_max_tokens,
            "timeout": settings.llm_timeout_seconds,
            "max_retries": settings.llm_max_retries,
            "api_key": settings.anthropic_api_key,
            # Streaming token usage is what makes per-chunk cost reporting work.
            "stream_usage": True,
        }

        # Adaptive thinking is the recommended mode on Claude 4.6+ models: the
        # model decides how much to think per request. `display="summarized"`
        # keeps reasoning visible in the stream instead of showing a long pause.
        if settings.llm_thinking == "adaptive":
            params["thinking"] = {
                "type": "adaptive",
                "display": settings.llm_thinking_display,
            }
        else:
            params["thinking"] = {"type": "disabled"}

        # `effort` controls depth and overall token spend. It lives inside
        # output_config, not at the top level.
        params["output_config"] = {"effort": settings.llm_effort}

        # NOTE: temperature / top_p / top_k are deliberately never set. Claude
        # Opus 5 rejects them with a 400; steer behaviour through prompts.
        params.update(overrides)

        key = _cache_key(params)
        cached = self._cache.get(key)
        if cached is not None:
            return cached

        try:
            instance = ChatAnthropic(**params)
        except Exception as exc:  # noqa: BLE001 - surfaced as a typed app error
            raise LLMProviderError(
                f"Failed to construct chat model '{params['model']}': {exc}"
            ) from exc

        logger.info(
            "Built chat model",
            extra={
                "model": params["model"],
                "effort": settings.llm_effort,
                "thinking": params["thinking"]["type"],
                "max_tokens": params["max_tokens"],
            },
        )
        self._cache[key] = instance
        return instance

    def clear_cache(self) -> None:
        self._cache.clear()


def _cache_key(params: dict[str, Any]) -> tuple[Any, ...]:
    """Hashable key from a params dict containing nested dicts."""
    return tuple(sorted((k, repr(v)) for k, v in params.items()))
