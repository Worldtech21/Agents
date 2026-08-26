"""Provider-adapter contract and registry for the LLM factory.

Each supported vendor gets one small :class:`ProviderAdapter` that knows three
things: which package/class to import, which of the normalised parameters it
accepts, and how to spell them.

Two details make the capability declaration load-bearing rather than cosmetic:

* LangChain chat models **accept unknown kwargs silently** — they emit a warning
  and drop the value. Passing ``stream_usage`` to Gemini is not an error, it is
  a no-op. Filtering keeps behaviour honest instead of quietly ignored.
* Providers spell the same concept differently. Ollama's output cap is
  ``num_predict``; passing ``max_tokens`` there is accepted and has no effect.

Adapters are registered by name, so adding a vendor is one class plus one
``register()`` call — no changes to the factory, container, or API.
"""

from __future__ import annotations

import importlib
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from app.core.exceptions import ConfigurationError


@dataclass(frozen=True, slots=True)
class ProviderCapabilities:
    """Which normalised parameters a provider actually honours."""

    temperature: bool = True
    top_p: bool = True
    max_tokens: bool = True
    timeout: bool = True
    max_retries: bool = True
    stream_usage: bool = False
    #: Anthropic-style adaptive thinking + effort.
    thinking: bool = False
    effort: bool = False
    #: Gemini-style opt-in for visible thought summaries. Separate from
    #: `thinking` because Gemini reasons whether or not the thoughts are
    #: returned — this flag only decides whether the client gets to see them.
    include_thoughts: bool = True
    #: False for providers authenticated by other means (Bedrock IAM, local Ollama).
    requires_api_key: bool = True


@dataclass(slots=True)
class ModelRequest:
    """Normalised, vendor-neutral description of the model to build."""

    model: str
    api_key: str | None = None
    base_url: str | None = None
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None
    timeout: float | None = None
    max_retries: int | None = None
    thinking: dict[str, Any] | None = None
    effort: str | None = None
    include_thoughts: bool | None = None
    #: Vendor-specific escape hatch (LLM_EXTRA_PARAMS + per-call overrides).
    extra: dict[str, Any] = field(default_factory=dict)


class ProviderAdapter(ABC):
    """Builds a LangChain chat model for one vendor."""

    #: Value used in `LLM_PROVIDER`.
    name: str
    #: Distribution to install when the import fails.
    package: str
    #: Module and class to import lazily.
    import_path: str
    class_name: str
    #: Native environment variable the vendor SDK reads on its own.
    env_key: str | None = None
    #: Shown in errors and `/agents` when no model is configured.
    default_model: str = ""
    capabilities: ProviderCapabilities = ProviderCapabilities()

    # ------------------------------------------------------------------ build
    def create(self, request: ModelRequest) -> Any:
        """Import the vendor class and instantiate it from *request*."""
        model_cls = self._load_class()
        kwargs = self.build_kwargs(request)
        kwargs.update(request.extra)
        try:
            return model_cls(**kwargs)
        except Exception as exc:  # noqa: BLE001 - surfaced as a typed app error
            raise ConfigurationError(
                f"Provider '{self.name}' could not build model "
                f"'{request.model}': {type(exc).__name__}: {exc}",
                details={"provider": self.name, "model": request.model},
            ) from exc

    @abstractmethod
    def build_kwargs(self, request: ModelRequest) -> dict[str, Any]:
        """Translate the normalised request into vendor constructor kwargs."""

    # --------------------------------------------------------------- helpers
    def _load_class(self) -> type:
        try:
            module = importlib.import_module(self.import_path)
        except ImportError as exc:
            raise ConfigurationError(
                f"LLM_PROVIDER='{self.name}' needs the '{self.package}' package, "
                f"which is not installed. Install it with:  "
                f"pip install '{self.package}'   (or: pip install -e '.[{self.name}]')",
                details={"provider": self.name, "package": self.package},
            ) from exc
        try:
            return getattr(module, self.class_name)
        except AttributeError as exc:  # pragma: no cover - version skew
            raise ConfigurationError(
                f"'{self.import_path}' has no '{self.class_name}'. "
                f"Your '{self.package}' version may be incompatible.",
                details={"provider": self.name},
            ) from exc

    def common_kwargs(self, request: ModelRequest) -> dict[str, Any]:
        """The subset of standard kwargs this provider actually supports.

        Every vendor probed accepts these spellings (`model`, `api_key`,
        `temperature`, `top_p`, `max_tokens`, `timeout`, `max_retries`), so
        adapters normally only override to add or rename.
        """
        caps = self.capabilities
        kwargs: dict[str, Any] = {"model": request.model}

        if request.api_key:
            kwargs["api_key"] = request.api_key
        if caps.temperature and request.temperature is not None:
            kwargs["temperature"] = request.temperature
        if caps.top_p and request.top_p is not None:
            kwargs["top_p"] = request.top_p
        if caps.max_tokens and request.max_tokens is not None:
            kwargs["max_tokens"] = request.max_tokens
        if caps.timeout and request.timeout is not None:
            kwargs["timeout"] = request.timeout
        if caps.max_retries and request.max_retries is not None:
            kwargs["max_retries"] = request.max_retries
        if caps.stream_usage:
            kwargs["stream_usage"] = True
        return kwargs


# --------------------------------------------------------------------- registry
_REGISTRY: dict[str, ProviderAdapter] = {}


def register(adapter: ProviderAdapter) -> ProviderAdapter:
    """Add an adapter to the registry. Safe to call for custom providers."""
    _REGISTRY[adapter.name] = adapter
    return adapter


def get_adapter(name: str) -> ProviderAdapter:
    """Look up an adapter, with an actionable error listing what is available."""
    key = (name or "").strip().lower()
    adapter = _REGISTRY.get(key)
    if adapter is None:
        raise ConfigurationError(
            f"Unknown LLM provider '{name}'. Available: {', '.join(available_providers())}.",
            details={"requested": name, "available": available_providers()},
        )
    return adapter


def available_providers() -> list[str]:
    return sorted(_REGISTRY)
