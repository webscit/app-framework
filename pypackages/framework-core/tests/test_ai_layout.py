from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from framework_core.ai_layout import (
    _MAX_TOOL_ROUNDS,
    DEFAULT_MODEL,
    GET_WIDGET_DETAILS_TOOL,
    SHELL_LAYOUT_JSON_SCHEMA,
    _resolve_tool_calls,
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


def test_build_layout_prompt_no_simulation_section_by_default() -> None:
    """No snapshot fields supplied — system prompt stays layout-generation only.

    This keeps callers that never send simulation data (e.g. the sine-wave
    example) unaffected: no extra section, no token bloat.
    """
    catalog = [{"name": "Chart", "description": "A chart."}]
    messages = build_layout_prompt(
        user_message="Build a dashboard",
        widget_catalog=catalog,
        layout_schema=SHELL_LAYOUT_JSON_SCHEMA,
    )
    assert "SIMULATION DATA" not in messages[0]["content"]


def test_build_layout_prompt_includes_simulation_section_when_snapshot_present() -> (
    None
):
    """Any one of telemetry/safety/current_params triggers the section."""
    catalog = [{"name": "Chart", "description": "A chart."}]
    messages = build_layout_prompt(
        user_message="What's wrong with this run?",
        widget_catalog=catalog,
        layout_schema=SHELL_LAYOUT_JSON_SCHEMA,
        telemetry_snapshot=[{"step": 0, "roll_deg": 42.0}],
        safety_snapshot=[{"step": 0, "status": "violation", "violated_axes": ["roll"]}],
        current_params={"roll_amplitude_deg": 42.0},
    )
    system_text = messages[0]["content"]
    assert "SIMULATION DATA" in system_text
    assert "42.0" in system_text
    assert "violation" in system_text
    assert "suggested_params" in system_text


def test_build_layout_prompt_simulation_section_omits_domain_specifics() -> None:
    """The framework prompt must stay generic — no example-specific numbers baked in.

    framework_core is shared across examples; hardcoding Reachy Mini's
    safety thresholds here would leak demo-specific knowledge into a
    reusable package. The snapshot data itself (margins/status) carries
    that information instead.
    """
    catalog = [{"name": "Chart", "description": "A chart."}]
    messages = build_layout_prompt(
        user_message="diagnose",
        widget_catalog=catalog,
        layout_schema=SHELL_LAYOUT_JSON_SCHEMA,
        safety_snapshot=[{"step": 0, "status": "ok"}],
    )
    system_text = messages[0]["content"]
    assert "Reachy" not in system_text
    assert "°" not in system_text


def test_build_layout_prompt_simulation_section_triggered_by_telemetry_only() -> None:
    catalog = [{"name": "Chart", "description": "A chart."}]
    messages = build_layout_prompt(
        user_message="any",
        widget_catalog=catalog,
        layout_schema=SHELL_LAYOUT_JSON_SCHEMA,
        telemetry_snapshot=[{"step": 0}],
    )
    assert "SIMULATION DATA" in messages[0]["content"]


def test_build_layout_prompt_simulation_section_triggered_by_current_params_only() -> (
    None
):
    catalog = [{"name": "Chart", "description": "A chart."}]
    messages = build_layout_prompt(
        user_message="any",
        widget_catalog=catalog,
        layout_schema=SHELL_LAYOUT_JSON_SCHEMA,
        current_params={"frequency": 1.0},
    )
    assert "SIMULATION DATA" in messages[0]["content"]


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
    assert body["model"] == DEFAULT_MODEL
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


# ─── GET_WIDGET_DETAILS_TOOL ───────────────────────────────────────────────────


def test_get_widget_details_tool_definition() -> None:
    assert GET_WIDGET_DETAILS_TOOL["type"] == "function"
    fn = GET_WIDGET_DETAILS_TOOL["function"]
    assert fn["name"] == "get_widget_details"
    params = fn["parameters"]
    assert params["type"] == "object"
    assert "widget_name" in params["properties"]
    assert params["required"] == ["widget_name"]


# ─── _resolve_tool_calls ───────────────────────────────────────────────────────

_FULL_REGISTRY: list[dict[str, Any]] = [
    {
        "name": "Chart",
        "description": "A chart.",
        "channelPattern": "data/*",
        "consumes": ["application/x-scalar+json"],
        "priority": 10,
        "defaultRegion": "main",
        "parameters": {"series": {"type": "string"}},
    },
    {
        "name": "LogViewer",
        "description": "Shows logs.",
        "channelPattern": "logs/*",
        "consumes": [],
        "priority": 5,
        "defaultRegion": "bottom",
        "parameters": {},
    },
]


def test_resolve_tool_calls_known_widget() -> None:
    tool_calls = [
        {
            "id": "tc-1",
            "function": {
                "name": "get_widget_details",
                "arguments": json.dumps({"widget_name": "Chart"}),
            },
        }
    ]
    results = _resolve_tool_calls(tool_calls, _FULL_REGISTRY)
    assert len(results) == 1
    assert results[0]["role"] == "tool"
    assert results[0]["tool_call_id"] == "tc-1"
    payload = json.loads(results[0]["content"])
    assert payload["name"] == "Chart"
    assert payload["defaultRegion"] == "main"
    assert "parameters" in payload


def test_resolve_tool_calls_unknown_widget() -> None:
    tool_calls = [
        {
            "id": "tc-2",
            "function": {
                "name": "get_widget_details",
                "arguments": json.dumps({"widget_name": "NonExistent"}),
            },
        }
    ]
    results = _resolve_tool_calls(tool_calls, _FULL_REGISTRY)
    assert len(results) == 1
    payload = json.loads(results[0]["content"])
    assert "error" in payload
    assert "NonExistent" in payload["error"]


def test_resolve_tool_calls_unknown_tool_name() -> None:
    tool_calls = [
        {
            "id": "tc-3",
            "function": {
                "name": "some_other_tool",
                "arguments": "{}",
            },
        }
    ]
    results = _resolve_tool_calls(tool_calls, _FULL_REGISTRY)
    assert len(results) == 1
    payload = json.loads(results[0]["content"])
    assert "error" in payload
    assert "some_other_tool" in payload["error"]


# ─── call_openrouter — tool-call loop ─────────────────────────────────────────


def _tool_call_response(tool_call_id: str, widget_name: str) -> dict[str, Any]:
    """Build an OpenRouter-format response with a get_widget_details tool call."""
    return {
        "choices": [
            {
                "finish_reason": "tool_calls",
                "message": {
                    "content": None,
                    "tool_calls": [
                        {
                            "id": tool_call_id,
                            "type": "function",
                            "function": {
                                "name": "get_widget_details",
                                "arguments": json.dumps({"widget_name": widget_name}),
                            },
                        }
                    ],
                },
            }
        ]
    }


@pytest.mark.anyio
async def test_call_openrouter_handles_tool_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    captured: list[dict[str, Any]] = []
    call_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        captured.append(json.loads(request.content))
        if call_count == 1:
            body = _tool_call_response("tc-loop-1", "Chart")
        else:
            body = {
                "choices": [
                    {"message": {"content": '{"explanation":"done","layout":{}}'}}
                ]
            }
        return httpx.Response(200, content=json.dumps(body).encode())

    result = await call_openrouter(
        messages=[{"role": "user", "content": "build a dashboard"}],
        tools=[GET_WIDGET_DETAILS_TOOL],
        full_registry=_FULL_REGISTRY,
        _transport=_MockAsyncTransport(handler),
    )

    assert result == '{"explanation":"done","layout":{}}'
    assert call_count == 2

    # Both requests must include tools (required by OpenRouter on every round).
    assert "tools" in captured[0]
    assert "tools" in captured[1]

    # Second request must carry the assistant + tool-result messages.
    second_messages = captured[1]["messages"]
    roles = [m["role"] for m in second_messages]
    assert "assistant" in roles
    assert "tool" in roles

    # The tool result message must reference the correct tool_call_id.
    tool_result = next(m for m in second_messages if m["role"] == "tool")
    assert tool_result["tool_call_id"] == "tc-loop-1"
    payload = json.loads(tool_result["content"])
    assert payload["name"] == "Chart"


@pytest.mark.anyio
async def test_call_openrouter_tool_loop_exceeded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    call_count = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        return httpx.Response(
            200,
            content=json.dumps(
                _tool_call_response(f"tc-{call_count}", "Chart")
            ).encode(),
        )

    with pytest.raises(ValueError, match="Tool-call loop exceeded"):
        await call_openrouter(
            messages=[{"role": "user", "content": "build a dashboard"}],
            tools=[GET_WIDGET_DETAILS_TOOL],
            full_registry=_FULL_REGISTRY,
            _transport=_MockAsyncTransport(handler),
        )

    assert call_count == _MAX_TOOL_ROUNDS
