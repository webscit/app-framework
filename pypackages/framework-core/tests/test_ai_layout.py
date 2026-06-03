from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from framework_core.ai_layout import (
    SHELL_LAYOUT_JSON_SCHEMA,
    build_layout_prompt,
    call_openrouter,
    extract_json,
    serialise_catalog,
    validate_layout,
)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


# ─── Helpers ──────────────────────────────────────────────────────────────────


class _MockAsyncTransport(httpx.AsyncBaseTransport):
    """Wraps a sync handler function for use with AsyncClient in tests."""

    def __init__(self, handler: Callable[[httpx.Request], httpx.Response]) -> None:
        self._handler = handler

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        return self._handler(request)


_REGISTERED: set[str] = {"Chart", "ParameterController", "LogViewer", "StatusIndicator"}

_VALID_LAYOUT: dict[str, Any] = {
    "regions": {
        "header": {"visible": True, "items": []},
        "sidebar-left": {
            "visible": True,
            "items": [{"id": "pc-1", "type": "ParameterController", "props": {}}],
        },
        "main": {
            "visible": True,
            "items": [{"id": "chart-1", "type": "Chart", "props": {}}],
        },
        "sidebar-right": {"visible": False, "items": []},
        "bottom": {"visible": False, "items": []},
        "status-bar": {"visible": True, "items": []},
    }
}

# ─── extract_json ──────────────────────────────────────────────────────────────


def test_extract_json_bare() -> None:
    result = extract_json('{"explanation": "test", "layout": {}}')
    assert result == {"explanation": "test", "layout": {}}


def test_extract_json_fenced_with_lang() -> None:
    text = '```json\n{"explanation": "test", "layout": {}}\n```'
    result = extract_json(text)
    assert result == {"explanation": "test", "layout": {}}


def test_extract_json_fenced_no_lang() -> None:
    text = '```\n{"key": "value"}\n```'
    result = extract_json(text)
    assert result == {"key": "value"}


def test_extract_json_invalid_raises() -> None:
    with pytest.raises(ValueError, match="Could not parse AI response as JSON"):
        extract_json("this is not json at all")


# ─── validate_layout ───────────────────────────────────────────────────────────


def test_validate_layout_valid() -> None:
    errors = validate_layout(_VALID_LAYOUT, registered_names=_REGISTERED)
    assert errors == []


def test_validate_layout_missing_region() -> None:
    layout: dict[str, Any] = {
        "regions": {
            "header": {"visible": True, "items": []},
            "sidebar-left": {"visible": True, "items": []},
            "main": {"visible": True, "items": []},
            # sidebar-right, bottom, status-bar omitted
        }
    }
    errors = validate_layout(layout, registered_names=_REGISTERED)
    assert len(errors) == 1
    assert "bottom" in errors[0]
    assert "sidebar-right" in errors[0]
    assert "status-bar" in errors[0]


def test_validate_layout_unknown_widget() -> None:
    layout: dict[str, Any] = {
        "regions": {
            "header": {"visible": True, "items": []},
            "sidebar-left": {"visible": True, "items": []},
            "main": {
                "visible": True,
                "items": [{"id": "w1", "type": "HallucinatedWidget", "props": {}}],
            },
            "sidebar-right": {"visible": False, "items": []},
            "bottom": {"visible": False, "items": []},
            "status-bar": {"visible": True, "items": []},
        }
    }
    errors = validate_layout(layout, registered_names=_REGISTERED)
    assert len(errors) == 1
    assert "HallucinatedWidget" in errors[0]


def test_validate_layout_duplicate_id() -> None:
    layout: dict[str, Any] = {
        "regions": {
            "header": {"visible": True, "items": []},
            "sidebar-left": {
                "visible": True,
                "items": [
                    {"id": "shared-id", "type": "ParameterController", "props": {}}
                ],
            },
            "main": {
                "visible": True,
                "items": [{"id": "shared-id", "type": "Chart", "props": {}}],
            },
            "sidebar-right": {"visible": False, "items": []},
            "bottom": {"visible": False, "items": []},
            "status-bar": {"visible": True, "items": []},
        }
    }
    errors = validate_layout(layout, registered_names=_REGISTERED)
    assert len(errors) == 1
    assert "shared-id" in errors[0]


# ─── build_layout_prompt ───────────────────────────────────────────────────────


def test_build_layout_prompt_structure() -> None:
    catalog = [{"name": "Chart", "description": "A chart."}]
    messages = build_layout_prompt(
        user_message="Build me a dashboard",
        widget_catalog=catalog,
        layout_schema=SHELL_LAYOUT_JSON_SCHEMA,
    )
    assert messages[0]["role"] == "system"
    assert "Chart" in messages[0]["content"]
    assert messages[-1]["role"] == "user"
    assert messages[-1]["content"] == "Build me a dashboard"


def test_build_layout_prompt_with_history() -> None:
    catalog = [{"name": "Chart", "description": "A chart."}]
    history = [
        {"user": "first prompt", "assistant": '{"explanation": "ok", "layout": {}}'}
    ]
    messages = build_layout_prompt(
        user_message="follow-up",
        widget_catalog=catalog,
        layout_schema=SHELL_LAYOUT_JSON_SCHEMA,
        history=history,
    )
    # system + user + assistant + new user = 4
    assert len(messages) == 4
    assert messages[0]["role"] == "system"
    assert messages[1]["role"] == "user"
    assert messages[1]["content"] == "first prompt"
    assert messages[2]["role"] == "assistant"
    assert messages[3]["role"] == "user"
    assert messages[3]["content"] == "follow-up"


def test_build_layout_prompt_catalog_injected() -> None:
    catalog = [{"name": "LogViewer", "description": "Shows logs."}]
    messages = build_layout_prompt(
        user_message="any",
        widget_catalog=catalog,
        layout_schema=SHELL_LAYOUT_JSON_SCHEMA,
    )
    system_text = messages[0]["content"]
    assert "LogViewer" in system_text
    assert "Shows logs." in system_text


# ─── serialise_catalog ─────────────────────────────────────────────────────────


def test_serialise_catalog_strips_extra_fields() -> None:
    registry = [
        {
            "name": "Chart",
            "description": "A chart.",
            "channelPattern": "data/*",
            "consumes": ["application/x-scalar+json"],
            "priority": 10,
            "defaultRegion": "main",
            "parameters": {},
        }
    ]
    result = serialise_catalog(registry)
    assert result == [{"name": "Chart", "description": "A chart."}]


def test_serialise_catalog_multiple_widgets() -> None:
    registry = [
        {"name": "Chart", "description": "A chart.", "priority": 10},
        {"name": "LogViewer", "description": "Shows logs.", "priority": 10},
    ]
    result = serialise_catalog(registry)
    assert len(result) == 2
    assert all(set(entry.keys()) == {"name", "description"} for entry in result)


# ─── SHELL_LAYOUT_JSON_SCHEMA ──────────────────────────────────────────────────


def test_shell_layout_schema_loaded() -> None:
    assert "definitions" in SHELL_LAYOUT_JSON_SCHEMA
    assert "RegionState" in SHELL_LAYOUT_JSON_SCHEMA["definitions"]
    assert "RegionItem" in SHELL_LAYOUT_JSON_SCHEMA["definitions"]
    required_regions = SHELL_LAYOUT_JSON_SCHEMA["properties"]["regions"]["required"]
    assert set(required_regions) == {
        "header",
        "sidebar-left",
        "main",
        "sidebar-right",
        "bottom",
        "status-bar",
    }


# ─── call_openrouter ───────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_call_openrouter_missing_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    with pytest.raises(ValueError, match="OPENROUTER_API_KEY must be set"):
        await call_openrouter(
            messages=[{"role": "user", "content": "hello"}],
            api_key=None,
        )


@pytest.mark.anyio
async def test_call_openrouter_success(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    captured: list[httpx.Request] = []
    response_body = json.dumps(
        {"choices": [{"message": {"content": '{"explanation":"ok","layout":{}}'}}]}
    )

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, content=response_body.encode())

    result = await call_openrouter(
        messages=[{"role": "user", "content": "hello"}],
        _transport=_MockAsyncTransport(handler),
    )

    assert result == '{"explanation":"ok","layout":{}}'
    assert len(captured) == 1
    assert "openrouter.ai" in str(captured[0].url)
    assert captured[0].headers["Authorization"] == "Bearer test-key"
    assert captured[0].headers["HTTP-Referer"] == "https://github.com/app-framework"

    body = json.loads(captured[0].content)
    assert body["model"] == "anthropic/claude-sonnet-4.6"
    assert body["temperature"] == 0.2
    assert body["messages"] == [{"role": "user", "content": "hello"}]


@pytest.mark.anyio
async def test_call_openrouter_http_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, content=b'{"error":"Unauthorized"}')

    with pytest.raises(httpx.HTTPStatusError):
        await call_openrouter(
            messages=[{"role": "user", "content": "hello"}],
            _transport=_MockAsyncTransport(handler),
        )
