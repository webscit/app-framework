"""OpenRouter client, prompt builder, and layout validator for AI layout generation.

Entry point for consumers: ``mount_ai_routes(app)`` — call once after ``create_app()``
to attach the ``POST /ai/layout`` endpoint to a FastAPI application.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import httpx

# ─── Constants ────────────────────────────────────────────────────────────────

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "anthropic/claude-sonnet-4.6"

# JSON Schema for ShellLayout — loaded from the bundled copy of
# shell_layout_schema.json. The canonical source lives at the repo root;
# the copy here is kept in sync until a CI check enforces it automatically.
_SCHEMA_PATH = Path(__file__).parent / "shell_layout_schema.json"
SHELL_LAYOUT_JSON_SCHEMA: dict[str, Any] = json.loads(_SCHEMA_PATH.read_text())

_LAYOUT_SYSTEM_PROMPT = """\
You are a dashboard layout generator for a simulation framework.
Your ONLY job is to produce a valid ShellLayout JSON object.

RULES — you must follow all of them:
1. You may ONLY use widget types from the WIDGET CATALOG below.
   Never invent new widget type names. If no widget fits, leave that region empty.
2. Your entire response must be a single JSON object with two keys:
   - "explanation": a short human-readable summary (1-3 sentences) of what you built and why.
   - "layout": a complete ShellLayout object matching the LAYOUT SCHEMA below.
3. Do not wrap the JSON in markdown code fences.
4. Do not add any text outside the JSON object.
5. Every RegionItem must have a unique "id" string.
6. Call get_widget_details(widget_name) BEFORE setting any props on a widget — the catalog
   only provides names and descriptions. Full parameter schemas are only available via the tool.
7. Use the widget's "defaultRegion" (returned by get_widget_details) as a guide for placement
   unless the user specifies otherwise.
8. For ParameterController, populate the "parameters" prop from the user's description of
   their simulation inputs. Infer reasonable min/max/default values from context.
9. For Chart, set the "series" prop to subscribe to the channel the backend publishes data on.
   Default to "data/<signal_name>" if the user does not specify a channel.

WIDGET CATALOG (name and description only — call get_widget_details for full schema):
<catalog_json>

LAYOUT SCHEMA:
<schema_json>
"""

# ─── OpenRouter client ────────────────────────────────────────────────────────


async def call_openrouter(
    messages: list[dict[str, str]],
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int = 2048,
    api_key: str | None = None,
    _transport: httpx.AsyncBaseTransport | None = None,
) -> str:
    """Send a chat completion request to OpenRouter and return the response text.

    Args:
        messages: OpenAI-format messages array.
        model: OpenRouter model identifier. Defaults to ``OPENROUTER_DEFAULT_MODEL``
               env var or ``"anthropic/claude-sonnet-4.6"``.
        temperature: Sampling temperature (0.0–1.0). Default 0.2 for structured output.
        max_tokens: Maximum tokens in the response.
        api_key: OpenRouter API key. Defaults to ``OPENROUTER_API_KEY`` env var.
        _transport: Optional async transport — used in tests to inject a mock.

    Returns:
        Response content string from the AI.

    Raises:
        ValueError: If no API key is available.
        httpx.HTTPStatusError: If OpenRouter returns a non-2xx status.
    """
    resolved_key = api_key or os.environ.get("OPENROUTER_API_KEY")
    if not resolved_key:
        raise ValueError("OPENROUTER_API_KEY must be set")

    resolved_model = model or os.environ.get("OPENROUTER_DEFAULT_MODEL", DEFAULT_MODEL)

    payload: dict[str, Any] = {
        "model": resolved_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    client_kwargs: dict[str, Any] = {}
    if _transport is not None:
        client_kwargs["transport"] = _transport

    async with httpx.AsyncClient(**client_kwargs) as client:
        response = await client.post(
            f"{OPENROUTER_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {resolved_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://github.com/app-framework",
                "X-Title": "app-framework AI Layout",
            },
            json=payload,
            timeout=30.0,
        )
        response.raise_for_status()
        data = response.json()
        return str(data["choices"][0]["message"]["content"])


# ─── JSON extraction ──────────────────────────────────────────────────────────


def extract_json(text: str) -> dict[str, Any]:
    """Extract a JSON object from an AI response string.

    Handles both bare JSON and JSON wrapped in markdown code fences.

    Args:
        text: Raw AI response text.

    Returns:
        Parsed JSON as a dict.

    Raises:
        ValueError: If no valid JSON object can be extracted.
    """
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        # Drop opening fence line; drop closing fence if present.
        inner = lines[1:-1] if lines[-1].strip() == "```" else lines[1:]
        text = "\n".join(inner)
    try:
        return dict(json.loads(text))
    except json.JSONDecodeError as e:
        raise ValueError(f"Could not parse AI response as JSON: {e}") from e


# ─── Catalog serialisation ────────────────────────────────────────────────────


def serialise_catalog(registry: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Extract lightweight catalog (name + description only) for the initial prompt.

    The full registry is kept in the request body for ``get_widget_details`` tool-call
    lookups; only the lightweight form is injected into the system prompt.

    Args:
        registry: Full widget registry list from the frontend (factory excluded).

    Returns:
        List of dicts containing only ``"name"`` and ``"description"`` keys.
    """
    return [{"name": w["name"], "description": w["description"]} for w in registry]


# ─── Prompt assembly ──────────────────────────────────────────────────────────


def build_layout_prompt(
    user_message: str,
    widget_catalog: list[dict[str, Any]],
    layout_schema: dict[str, Any],
    history: list[dict[str, str]] | None = None,
) -> list[dict[str, str]]:
    """Assemble the messages array for a layout generation request.

    Args:
        user_message: Current user prompt.
        widget_catalog: Lightweight catalog (name + description only) from
            :func:`serialise_catalog`.
        layout_schema: JSON Schema for ShellLayout.
        history: Prior approved conversation turns as
            ``[{"user": ..., "assistant": ...}]``. Rejected turns must be
            excluded by the caller so they do not pollute the AI context.

    Returns:
        Messages array ready to pass to :func:`call_openrouter`.
    """
    system_content = _LAYOUT_SYSTEM_PROMPT.replace(
        "<catalog_json>", json.dumps(widget_catalog, indent=2)
    ).replace("<schema_json>", json.dumps(layout_schema, indent=2))

    messages: list[dict[str, str]] = [{"role": "system", "content": system_content}]

    for turn in history or []:
        messages.append({"role": "user", "content": turn["user"]})
        messages.append({"role": "assistant", "content": turn["assistant"]})

    messages.append({"role": "user", "content": user_message})
    return messages


# ─── Layout validation ────────────────────────────────────────────────────────


def validate_layout(
    layout: dict[str, Any],
    registered_names: set[str],
) -> list[str]:
    """Validate a ShellLayout dict against structural and registry constraints.

    Args:
        layout: Parsed layout object from AI response.
        registered_names: Set of valid widget type names from the registry.

    Returns:
        List of error strings. An empty list means the layout is valid.
    """
    errors: list[str] = []
    required_regions = {
        "header",
        "sidebar-left",
        "main",
        "sidebar-right",
        "bottom",
        "status-bar",
    }
    regions: dict[str, Any] = layout.get("regions", {})

    missing = required_regions - set(regions.keys())
    if missing:
        errors.append(f"Missing regions: {sorted(missing)}")

    seen_ids: set[str] = set()
    for region_id, region in regions.items():
        for item in region.get("items", []):
            widget_type = item.get("type")
            if widget_type not in registered_names:
                errors.append(
                    f"Region '{region_id}': widget type '{widget_type}' is not "
                    f"registered. Valid types: {sorted(registered_names)}"
                )
            item_id = item.get("id")
            if item_id in seen_ids:
                errors.append(f"Duplicate item id '{item_id}'")
            if item_id is not None:
                seen_ids.add(item_id)

    return errors
