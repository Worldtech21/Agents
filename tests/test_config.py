"""Configuration parsing and MCP placeholder handling."""

from __future__ import annotations

import pytest

from app.core.config import Settings, is_placeholder


@pytest.mark.parametrize(
    "url",
    [
        None,
        "",
        "   ",
        "<https://your-research-mcp-server.example.com/mcp>",
        "https://changeme.local/mcp",
        "https://your-server/mcp",
        "https://REPLACE_ME/mcp",
    ],
)
def test_placeholder_urls_are_detected(url):
    assert is_placeholder(url)


@pytest.mark.parametrize(
    "url",
    ["https://mcp.acme.com/mcp", "http://localhost:8931/mcp", "https://api.githubcopilot.com/mcp/"],
)
def test_real_urls_are_not_placeholders(url):
    assert not is_placeholder(url)


def test_unconfigured_servers_are_omitted_so_the_app_still_boots():
    settings = Settings(
        mcp_research_url="<https://your-research-mcp-server.example.com/mcp>",
        mcp_knowledge_url="https://mcp.acme.com/knowledge",
        mcp_automation_url=None,
    )
    servers = settings.mcp_server_settings()
    assert set(servers) == {"knowledge"}
    assert servers["knowledge"]["url"] == "https://mcp.acme.com/knowledge"
    assert servers["knowledge"]["transport"] == "streamable_http"


def test_headers_accept_a_json_string_from_env():
    settings = Settings(
        mcp_research_url="https://mcp.acme.com/research",
        mcp_research_headers='{"Authorization": "Bearer abc"}',
    )
    servers = settings.mcp_server_settings()
    assert servers["research"]["headers"] == {"Authorization": "Bearer abc"}


def test_extra_servers_merge_in_from_json():
    settings = Settings(
        mcp_extra_servers='{"github": {"url": "https://api.githubcopilot.com/mcp/", '
        '"transport": "streamable_http"}}'
    )
    servers = settings.mcp_server_settings()
    assert "github" in servers


def test_extra_servers_with_placeholder_urls_are_skipped():
    settings = Settings(mcp_extra_servers='{"x": {"url": "<fill-me-in>"}}')
    assert settings.mcp_server_settings() == {}


def test_stdio_extra_servers_do_not_require_a_url():
    settings = Settings(
        mcp_extra_servers='{"local": {"transport": "stdio", "command": "python", '
        '"args": ["server.py"]}}'
    )
    assert "local" in settings.mcp_server_settings()


def test_comma_separated_lists_parse_from_env_style_strings():
    settings = Settings(
        graph_stream_modes="values,updates,messages",
        cors_allow_origins="http://a.test,http://b.test",
    )
    assert settings.graph_stream_modes == ["values", "updates", "messages"]
    assert settings.cors_allow_origins == ["http://a.test", "http://b.test"]


def test_supervisor_model_falls_back_to_the_default_model():
    assert Settings(llm_model="gemini-3.7-flash").supervisor_model == "gemini-3.7-flash"
    assert (
        Settings(
            llm_model="gemini-3.7-flash", llm_supervisor_model="gemini-2.5-flash"
        ).supervisor_model
        == "gemini-2.5-flash"
    )


def test_invalid_json_in_an_mcp_setting_is_rejected_loudly():
    with pytest.raises(Exception, match="valid JSON"):
        Settings(mcp_research_headers="{not json")
