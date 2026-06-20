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


def test_layout_endpoint_returns_suggested_params_with_snapshot(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A diagnosis response with suggested_params and no layout is accepted."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    diagnosis_response = json.dumps(
        {
            "explanation": "Roll exceeded the violation threshold on step 0.",
            "suggested_params": {"roll_amplitude_deg": 18.0},
        }
    )

    with patch(
        "framework_core.ai_layout.call_openrouter",
        new_callable=AsyncMock,
        return_value=diagnosis_response,
    ) as mock_call:
        response = client.post(
            "/ai/layout",
            json={
                "prompt": "What's wrong with this run?",
                "history": [],
                "registry": _REGISTRY,
                "telemetry_snapshot": [{"step": 0, "roll_deg": 42.0}],
                "safety_snapshot": [
                    {"step": 0, "status": "violation", "violated_axes": ["roll"]}
                ],
                "current_params": {"roll_amplitude_deg": 42.0},
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert data["suggested_params"] == {"roll_amplitude_deg": 18.0}
    assert data["layout"] == {}
    assert "Roll exceeded" in data["explanation"]

    # The prompt actually sent to the AI must carry the simulation section.
    sent_messages = mock_call.call_args.kwargs["messages"]
    system_text = sent_messages[0]["content"]
    assert "SIMULATION DATA" in system_text
    assert "42.0" in system_text


def test_layout_endpoint_without_snapshot_has_no_suggested_params(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Backward compatibility: callers that never send a snapshot are unaffected."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    with patch(
        "framework_core.ai_layout.call_openrouter",
        new_callable=AsyncMock,
        return_value=_VALID_AI_RESPONSE,
    ) as mock_call:
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
    assert data["suggested_params"] is None
    assert "regions" in data["layout"]

    sent_messages = mock_call.call_args.kwargs["messages"]
    assert "SIMULATION DATA" not in sent_messages[0]["content"]


def test_layout_endpoint_combined_diagnosis_and_layout_change(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A response with explanation + suggested_params + layout all together."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    combined_response = json.dumps(
        {
            "explanation": "Added a gauge to visualise the roll margin.",
            "suggested_params": {"roll_amplitude_deg": 18.0},
            "layout": _VALID_LAYOUT,
        }
    )

    with patch(
        "framework_core.ai_layout.call_openrouter",
        new_callable=AsyncMock,
        return_value=combined_response,
    ):
        response = client.post(
            "/ai/layout",
            json={
                "prompt": "Fix it and show me the margin",
                "history": [],
                "registry": _REGISTRY,
                "safety_snapshot": [{"step": 0, "status": "violation"}],
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert data["suggested_params"] == {"roll_amplitude_deg": 18.0}
    assert "regions" in data["layout"]


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
