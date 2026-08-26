"""Concrete provider adapters.

Every class name, module path and kwarg spelling here was verified against the
installed packages rather than recalled. Importing this module registers all
built-in providers; the vendor packages themselves are imported lazily, so an
uninstalled provider costs nothing until it is selected.
"""

from __future__ import annotations

from typing import Any

from app.infrastructure.llm.base import (
    ModelRequest,
    ProviderAdapter,
    ProviderCapabilities,
    register,
)


class AnthropicAdapter(ProviderAdapter):
    """Claude via ``langchain-anthropic`` (optional: ``pip install -e '.[anthropic]'``)."""

    name = "anthropic"
    package = "langchain-anthropic"
    import_path = "langchain_anthropic"
    class_name = "ChatAnthropic"
    env_key = "ANTHROPIC_API_KEY"
    default_model = "claude-opus-5"
    capabilities = ProviderCapabilities(
        # Claude Opus 5 / Sonnet 5 / Opus 4.7+ reject temperature, top_p and
        # top_k with a 400. Steer these models through prompting instead; if you
        # target an older Claude that accepts them, use LLM_EXTRA_PARAMS.
        temperature=False,
        top_p=False,
        stream_usage=True,
        thinking=True,
        effort=True,
    )

    def build_kwargs(self, request: ModelRequest) -> dict[str, Any]:
        kwargs = self.common_kwargs(request)
        if request.thinking:
            kwargs["thinking"] = request.thinking
        if request.effort:
            # `effort` is nested inside output_config, not a top-level param.
            kwargs["output_config"] = {"effort": request.effort}
        return kwargs


class OpenAIAdapter(ProviderAdapter):
    """OpenAI via ``langchain-openai``."""

    name = "openai"
    package = "langchain-openai"
    import_path = "langchain_openai"
    class_name = "ChatOpenAI"
    env_key = "OPENAI_API_KEY"
    default_model = "gpt-4o"
    capabilities = ProviderCapabilities(stream_usage=True)

    def build_kwargs(self, request: ModelRequest) -> dict[str, Any]:
        kwargs = self.common_kwargs(request)
        if request.base_url:
            kwargs["base_url"] = request.base_url
        return kwargs


class OpenAICompatibleAdapter(OpenAIAdapter):
    """Any OpenAI-compatible endpoint: vLLM, LiteLLM, OpenRouter, Together, …

    Same client as :class:`OpenAIAdapter`, but ``LLM_BASE_URL`` is required and
    the API key is optional (local servers usually need none).
    """

    name = "openai_compatible"
    env_key = None
    default_model = ""
    capabilities = ProviderCapabilities(stream_usage=True, requires_api_key=False)

    def build_kwargs(self, request: ModelRequest) -> dict[str, Any]:
        kwargs = super().build_kwargs(request)
        # The OpenAI client rejects an empty key; local servers ignore its value.
        kwargs.setdefault("api_key", "not-needed")
        return kwargs


class AzureOpenAIAdapter(ProviderAdapter):
    """Azure OpenAI via ``langchain-openai``.

    Azure addresses a *deployment*, not a model name, and needs an endpoint and
    API version. Supply them via ``AZURE_OPENAI_*`` settings.
    """

    name = "azure_openai"
    package = "langchain-openai"
    import_path = "langchain_openai"
    class_name = "AzureChatOpenAI"
    env_key = "AZURE_OPENAI_API_KEY"
    default_model = "gpt-4o"
    capabilities = ProviderCapabilities(stream_usage=True)

    def build_kwargs(self, request: ModelRequest) -> dict[str, Any]:
        kwargs = self.common_kwargs(request)
        for key in ("azure_endpoint", "api_version", "azure_deployment"):
            value = request.extra.pop(key, None)
            if value:
                kwargs[key] = value
        return kwargs


class GoogleGenAIAdapter(ProviderAdapter):
    """Gemini via ``langchain-google-genai`` — the default provider.

    ``ChatGoogleGenerativeAI`` names its fields ``google_api_key`` /
    ``max_output_tokens``, but both carry the aliases this adapter passes
    (``api_key`` / ``max_tokens``) and the class sets ``populate_by_name``, so
    the normalised spellings land on the right fields.

    ``include_thoughts`` decides whether Gemini returns its thought summaries as
    ``thinking`` content blocks; without it the model still reasons, but the
    stream carries only the answer. ``LLM_THINKING`` drives it (see
    :class:`~app.infrastructure.llm.factory.LLMFactory`).

    ``LLM_EFFORT`` maps onto ``thinking_level`` — how hard the model reasons
    before answering, and therefore how much there is to summarise. It is a
    Gemini 3 control; on an older Gemini the equivalent is ``thinking_budget``,
    which is model-dependent and so is left to ``LLM_EXTRA_PARAMS``.
    """

    name = "google_genai"
    package = "langchain-google-genai"
    import_path = "langchain_google_genai"
    class_name = "ChatGoogleGenerativeAI"
    env_key = "GOOGLE_API_KEY"
    default_model = "gemini-3.7-flash"
    # No stream_usage: ChatGoogleGenerativeAI declares `extra="ignore"`, so the
    # kwarg is silently dropped rather than honoured. `include_thoughts` and
    # `reasoning_effort` are real fields on the class, so they are honoured.
    capabilities = ProviderCapabilities(include_thoughts=True, effort=True)

    #: `LLM_EFFORT` spans Anthropic's scale; Gemini's tops out at `high`.
    EFFORT_LEVELS = {
        "low": "low",
        "medium": "medium",
        "high": "high",
        "xhigh": "high",
        "max": "high",
    }

    def build_kwargs(self, request: ModelRequest) -> dict[str, Any]:
        kwargs = self.common_kwargs(request)
        if request.include_thoughts is not None:
            kwargs["include_thoughts"] = request.include_thoughts
        # `thinking_level` is a Gemini 3 control. Sending it to a 2.5 model is
        # rejected, so an older deployment simply keeps the model's default.
        if request.effort and "gemini-3" in request.model.lower():
            kwargs["reasoning_effort"] = self.EFFORT_LEVELS.get(request.effort, "high")
        return kwargs


class BedrockAdapter(ProviderAdapter):
    """Claude (and others) on Amazon Bedrock via ``langchain-aws``.

    Authenticated by the standard AWS credential chain, not an API key. Model
    ids carry a provider prefix, e.g. ``anthropic.claude-opus-5``.
    """

    name = "bedrock"
    package = "langchain-aws"
    import_path = "langchain_aws"
    class_name = "ChatBedrockConverse"
    env_key = None
    default_model = "anthropic.claude-opus-5"
    capabilities = ProviderCapabilities(requires_api_key=False)

    def build_kwargs(self, request: ModelRequest) -> dict[str, Any]:
        kwargs = self.common_kwargs(request)
        kwargs.pop("api_key", None)  # AWS uses its own credential chain.
        region = request.extra.pop("region_name", None)
        if region:
            kwargs["region_name"] = region
        return kwargs


class OllamaAdapter(ProviderAdapter):
    """Local models via ``langchain-ollama``."""

    name = "ollama"
    package = "langchain-ollama"
    import_path = "langchain_ollama"
    class_name = "ChatOllama"
    env_key = None
    default_model = "llama3.1"
    # ChatOllama has no api_key/timeout/max_retries fields, and its output cap
    # is `num_predict` — passing `max_tokens` is accepted but silently ignored.
    capabilities = ProviderCapabilities(
        max_tokens=False,
        timeout=False,
        max_retries=False,
        requires_api_key=False,
    )

    def build_kwargs(self, request: ModelRequest) -> dict[str, Any]:
        kwargs = self.common_kwargs(request)
        kwargs.pop("api_key", None)
        kwargs["base_url"] = request.base_url or "http://localhost:11434"
        if request.max_tokens is not None:
            kwargs["num_predict"] = request.max_tokens
        return kwargs


class GroqAdapter(ProviderAdapter):
    """Groq via ``langchain-groq``."""

    name = "groq"
    package = "langchain-groq"
    import_path = "langchain_groq"
    class_name = "ChatGroq"
    env_key = "GROQ_API_KEY"
    default_model = "llama-3.3-70b-versatile"
    capabilities = ProviderCapabilities(top_p=False)

    def build_kwargs(self, request: ModelRequest) -> dict[str, Any]:
        return self.common_kwargs(request)


class MistralAdapter(ProviderAdapter):
    """Mistral via ``langchain-mistralai``."""

    name = "mistral"
    package = "langchain-mistralai"
    import_path = "langchain_mistralai"
    class_name = "ChatMistralAI"
    env_key = "MISTRAL_API_KEY"
    default_model = "mistral-large-latest"
    capabilities = ProviderCapabilities()

    def build_kwargs(self, request: ModelRequest) -> dict[str, Any]:
        return self.common_kwargs(request)


def register_builtin_providers() -> None:
    """Register every built-in adapter. Idempotent."""
    for adapter in (
        AnthropicAdapter(),
        OpenAIAdapter(),
        OpenAICompatibleAdapter(),
        AzureOpenAIAdapter(),
        GoogleGenAIAdapter(),
        BedrockAdapter(),
        OllamaAdapter(),
        GroqAdapter(),
        MistralAdapter(),
    ):
        register(adapter)


register_builtin_providers()
