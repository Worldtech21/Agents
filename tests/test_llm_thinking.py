"""Whether the model's reasoning reaches the stream at all.

The conversation surfaces render thinking live, but they can only render what
the provider was asked to return. Gemini reasons either way and returns the
thought summaries *only* when `include_thoughts` is set, so this is the setting
the whole feature hangs on — and it is silent when wrong: the answer still
arrives, just with no visible working.
"""

from __future__ import annotations

import pytest

from app.core.config import Settings
from app.infrastructure.llm.base import ModelRequest, get_adapter
from app.infrastructure.llm.factory import LLMFactory


def build_request(**overrides):
    """The request the factory would build for the configured provider."""
    settings = Settings(**overrides)
    adapter = get_adapter(settings.llm_provider)
    return adapter, LLMFactory(settings)._build_request(adapter, model=None, overrides={})


@pytest.mark.parametrize(
    ("thinking", "display", "expected"),
    [
        ("adaptive", "summarized", True),
        # Reason, but keep the working off the wire.
        ("adaptive", "omitted", False),
        ("disabled", "summarized", False),
    ],
)
def test_gemini_asks_for_thoughts_only_when_they_are_meant_to_be_shown(
    thinking, display, expected
):
    adapter, request = build_request(
        llm_provider="google_genai", llm_thinking=thinking, llm_thinking_display=display
    )
    assert request.include_thoughts is expected
    assert adapter.build_kwargs(request)["include_thoughts"] is expected


def test_the_flag_reaches_the_gemini_client():
    """The kwarg is a real field, not one `extra="ignore"` silently drops."""
    settings = Settings(
        llm_provider="google_genai",
        llm_thinking="adaptive",
        llm_thinking_display="summarized",
        llm_api_key="test-key-not-used",
    )
    model = LLMFactory(settings).get_model()
    assert model.include_thoughts is True


@pytest.mark.parametrize(
    ("effort", "expected"),
    [
        ("low", "low"),
        ("medium", "medium"),
        ("high", "high"),
        # Anthropic's upper levels have no Gemini equivalent; clamp, don't send
        # a value the API rejects.
        ("xhigh", "high"),
        ("max", "high"),
    ],
)
def test_effort_maps_onto_geminis_own_scale(effort, expected):
    adapter, request = build_request(llm_provider="google_genai", llm_effort=effort)
    assert adapter.build_kwargs(request)["reasoning_effort"] == expected


def test_effort_reaches_the_gemini_client():
    """How hard it reasons decides how much there is to summarise."""
    settings = Settings(
        llm_provider="google_genai", llm_effort="high", llm_api_key="test-key-not-used"
    )
    model = LLMFactory(settings).get_model()
    assert model.thinking_level == "high"


def test_thinking_level_is_withheld_from_older_gemini():
    """`thinking_level` is a Gemini 3 control; a 2.5 model rejects it."""
    adapter = get_adapter("google_genai")
    request = ModelRequest(model="gemini-2.5-flash", effort="high")
    assert "reasoning_effort" not in adapter.build_kwargs(request)


def test_anthropic_is_unaffected_and_keeps_its_own_spelling():
    """Claude carries thinking in `thinking`; it has no `include_thoughts`."""
    adapter = get_adapter("anthropic")
    request = ModelRequest(model="claude-opus-5", thinking={"type": "adaptive"})
    kwargs = adapter.build_kwargs(request)
    assert kwargs["thinking"] == {"type": "adaptive"}
    assert "include_thoughts" not in kwargs


def test_thinking_settings_change_the_cache_key():
    """Two differently-configured models must not collide in the factory cache."""
    _, shown = build_request(llm_provider="google_genai", llm_thinking_display="summarized")
    _, hidden = build_request(llm_provider="google_genai", llm_thinking_display="omitted")

    from app.infrastructure.llm.factory import _hashable

    assert _hashable(shown) != _hashable(hidden)
