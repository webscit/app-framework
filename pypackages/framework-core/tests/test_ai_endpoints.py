from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from framework_core import create_app
from framework_core.ai_layout import mount_ai_routes

# ─── Fixtures and shared test data ────────────────────────────────────────────

_REGISTRY: list[dict[str, Any]] = [
    {"name": "Chart", "description": "A live time-series chart."},
    {"name": "ParameterController", "description": "Controls simulation parameters."},
]

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

_VALID_AI_RESPONSE = json.dumps(
    {"explanation": "A sine wave dashboard.", "layout": _VALID_LAYOUT}
)

_INVALID_WIDGET_RESPONSE = json.dumps(
    {
        "explanation": "Dashboard with a hallucinated widget.",
        "layout": {
            "regions": {
                "header": {"visible": True, "items": []},
                "sidebar-left": {"visible": True, "items": []},
                "main": {
                    "visible": True,
                    "items": [{"id": "w-1", "type": "HallucinatedWidget", "props": {}}],
                },
                "sidebar-right": {"visible": False, "items": []},
                "bottom": {"visible": False, "items": []},
                "status-bar": {"visible": True, "items": []},
            }
        },
    }
)


@pytest.fixture()
def client() -> TestClient:
    """TestClient wired with mount_ai_routes for endpoint integration tests."""
    app = create_app()
    mount_ai_routes(app)
    return TestClient(app)


# ─── Tests ────────────────────────────────────────────────────────────────────


def test_layout_endpoint_returns_layout(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Valid prompt returns 200 with layout and explanation."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    with patch(
        "framework_core.ai_layout.call_openrouter",
        new_callable=AsyncMock,
        return_value=_VALID_AI_RESPONSE,
    ):
        response = client.post(
            "/ai/layout",
            json={
                "prompt": "Build a sine wave dashboard",
                "history": [],
                "registry": _REGISTRY,
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert "layout" in data
    assert "explanation" in data
    assert data["explanation"] == "A sine wave dashboard."
    assert "regions" in data["layout"]


def test_layout_endpoint_rejects_unknown_widget(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """AI returning an unregistered widget type on both attempts yields 422."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    with patch(
        "framework_core.ai_layout.call_openrouter",
        new_callable=AsyncMock,
        return_value=_INVALID_WIDGET_RESPONSE,
    ):
        response = client.post(
            "/ai/layout",
            json={
                "prompt": "Build a dashboard",
                "history": [],
                "registry": _REGISTRY,
            },
        )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert "errors" in detail
    assert any("HallucinatedWidget" in err for err in detail["errors"])


def test_layout_endpoint_missing_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """Missing OPENROUTER_API_KEY causes a 502 with a descriptive error."""
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    app = create_app()
    mount_ai_routes(app)
    with TestClient(app) as c:
        response = c.post(
            "/ai/layout",
            json={
                "prompt": "Build a dashboard",
                "history": [],
                "registry": _REGISTRY,
            },
        )

    assert response.status_code == 502
    assert "OPENROUTER_API_KEY" in response.json()["detail"]["errors"][0]
