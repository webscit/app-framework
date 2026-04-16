from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from framework_core import create_app
from framework_core.default_widgets import LOG_VIEWER, STATUS_INDICATOR
from framework_core.widget_registry import WidgetDefinition, WidgetRegistry


def make_widget(name: str = "TestWidget", stream: str = "data") -> WidgetDefinition:
    """Return a minimal WidgetDefinition for use in tests."""
    return WidgetDefinition(
        name=name,
        description=f"Test widget {name}",
        stream=stream,
        consumes="text/plain",
        capabilities=["test", "scrollable"],
        parameters={"maxItems": {"type": "integer", "default": 50}},
        component="./src/widgets/TestWidget.tsx",
    )


# ─── WidgetRegistry unit tests ────────────────────────────────────────────────


def test_register_then_get_returns_widget() -> None:
    registry = WidgetRegistry()
    widget = make_widget("Alpha")
    registry.register(widget)
    assert registry.get("Alpha") == widget


def test_register_duplicate_name_raises_value_error() -> None:
    registry = WidgetRegistry()
    registry.register(make_widget("Alpha"))
    with pytest.raises(ValueError, match="Alpha"):
        registry.register(make_widget("Alpha"))


def test_unregister_existing_widget_removes_it() -> None:
    registry = WidgetRegistry()
    registry.register(make_widget("Alpha"))
    registry.unregister("Alpha")
    assert registry.get("Alpha") is None


def test_unregister_missing_name_raises_key_error() -> None:
    registry = WidgetRegistry()
    with pytest.raises(KeyError):
        registry.unregister("NonExistent")


def test_list_returns_all_registered_widgets() -> None:
    registry = WidgetRegistry()
    a = make_widget("Alpha")
    b = make_widget("Beta")
    registry.register(a)
    registry.register(b)
    result = registry.list()
    assert len(result) == 2
    assert a in result
    assert b in result


def test_list_returns_empty_when_nothing_registered() -> None:
    registry = WidgetRegistry()
    assert registry.list() == []


def test_find_by_capability_returns_matching_widgets() -> None:
    registry = WidgetRegistry()
    w1 = WidgetDefinition(
        name="W1",
        description="d",
        stream="log",
        consumes="text/plain",
        capabilities=["log-viewer", "scrollable"],
        parameters={},
        component="./W1.tsx",
    )
    w2 = WidgetDefinition(
        name="W2",
        description="d",
        stream="data",
        consumes="application/json",
        capabilities=["chart", "scrollable"],
        parameters={},
        component="./W2.tsx",
    )
    registry.register(w1)
    registry.register(w2)
    result = registry.find_by_capability("scrollable")
    assert w1 in result
    assert w2 in result
    result2 = registry.find_by_capability("log-viewer")
    assert w1 in result2
    assert w2 not in result2


def test_find_by_capability_returns_empty_when_no_match() -> None:
    registry = WidgetRegistry()
    registry.register(make_widget("Alpha"))
    assert registry.find_by_capability("nonexistent-tag") == []


def test_find_by_stream_returns_matching_widgets() -> None:
    registry = WidgetRegistry()
    log_w = make_widget("LogW", stream="log")
    data_w = make_widget("DataW", stream="data")
    registry.register(log_w)
    registry.register(data_w)
    result = registry.find_by_stream("log")
    assert log_w in result
    assert data_w not in result


def test_find_by_stream_returns_empty_when_no_match() -> None:
    registry = WidgetRegistry()
    registry.register(make_widget("Alpha", stream="log"))
    assert registry.find_by_stream("control") == []


def test_find_by_mime_returns_matching_widgets() -> None:
    registry = WidgetRegistry()
    w1 = WidgetDefinition(
        name="W1",
        description="d",
        stream="log",
        consumes="text/plain",
        capabilities=[],
        parameters={},
        component="./W1.tsx",
    )
    w2 = WidgetDefinition(
        name="W2",
        description="d",
        stream="control",
        consumes="application/x-control+json",
        capabilities=[],
        parameters={},
        component="./W2.tsx",
    )
    registry.register(w1)
    registry.register(w2)
    result = registry.find_by_mime("text/plain")
    assert w1 in result
    assert w2 not in result


def test_find_by_mime_returns_empty_when_no_match() -> None:
    registry = WidgetRegistry()
    registry.register(make_widget("Alpha"))
    assert registry.find_by_mime("model/gltf+json") == []


# ─── HTTP endpoint tests ───────────────────────────────────────────────────────


def test_get_widgets_returns_200_with_correct_json_array() -> None:
    """GET /api/widgets returns all registered widgets as a JSON array."""
    app = create_app()

    with TestClient(app) as client:
        response = client.get("/api/widgets")

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    names = {w["name"] for w in data}
    assert "LogViewer" in names
    assert "StatusIndicator" in names
    # Spot-check one field on each
    log_w = next(w for w in data if w["name"] == "LogViewer")
    assert log_w["stream"] == "log"
    assert log_w["consumes"] == "text/plain"


def test_get_widgets_returns_empty_array_when_nothing_registered() -> None:
    """GET /api/widgets returns [] when the registry is empty."""
    from contextlib import asynccontextmanager

    from fastapi import FastAPI

    @asynccontextmanager
    async def clear_registry(app: FastAPI):  # type: ignore[misc]
        # Unregister all defaults so the registry is empty.
        for name in ["LogViewer", "StatusIndicator"]:
            app.state.widget_registry.unregister(name)
        yield

    app = create_app(lifespan=clear_registry)

    with TestClient(app) as client:
        response = client.get("/api/widgets")

    assert response.status_code == 200
    assert response.json() == []


def test_create_app_registers_log_viewer_and_status_indicator() -> None:
    """create_app() pre-populates the registry with the two built-in widgets."""
    marker: dict[str, object] = {}

    from contextlib import asynccontextmanager

    from fastapi import FastAPI

    @asynccontextmanager
    async def inspect(app: FastAPI):  # type: ignore[misc]
        marker["log_viewer"] = app.state.widget_registry.get("LogViewer")
        marker["status_indicator"] = app.state.widget_registry.get("StatusIndicator")
        yield

    app = create_app(lifespan=inspect)
    with TestClient(app):
        pass

    assert marker["log_viewer"] == LOG_VIEWER
    assert marker["status_indicator"] == STATUS_INDICATOR
