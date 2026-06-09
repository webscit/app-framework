"""OpenRouter client, prompt builder, and layout validator for AI layout generation.

Entry point for consumers: ``mount_ai_routes(app)`` — call once after ``create_app()``
to attach the ``POST /ai/layout`` endpoint to a FastAPI application.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# ─── Constants ────────────────────────────────────────────────────────────────

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# JSON Schema for ShellLayout — loaded from the bundled copy of
# shell_layout_schema.json. The canonical source lives at the repo root;
# the copy here is kept in sync until a CI check enforces it automatically.
_SCHEMA_PATH = Path(__file__).parent / "shell_layout_schema.json"
SHELL_LAYOUT_JSON_SCHEMA: dict[str, Any] = json.loads(_SCHEMA_PATH.read_text())

# Maximum number of tool-call rounds before giving up, to prevent infinite loops.
_MAX_TOOL_ROUNDS = 10

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
6. Use the widget's "defaultRegion" field from the catalog as a guide for placement
   unless the user specifies otherwise.
7. For ParameterController, populate the "parameters" prop from the user's description of
   their simulation inputs. Infer reasonable min/max/default values from context.
8. For Chart, set the "series" prop to subscribe to the channel the backend publishes data on.
   Default to "data/<signal_name>" if the user does not specify a channel.
9. IMPORTANT: When a CURRENT LAYOUT is provided, start from it and apply only the changes the
   user requests. Preserve the "visible" flag and items of regions the user did not mention.
   Never set a region to visible:false unless the user explicitly asks to hide it.

WIDGET CATALOG (full details — use defaultRegion, channelPattern, and parameters schema):
<catalog_json>

LAYOUT SCHEMA:
<schema_json>

CURRENT LAYOUT (start from this and make only the requested changes):
<current_layout_json>
"""

# ─── Tool definition ──────────────────────────────────────────────────────────

GET_WIDGET_DETAILS_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "get_widget_details",
        "description": (
            "Returns full details for a registered widget: channelPattern, "
            "consumes, priority, defaultRegion, and parameters schema."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "widget_name": {
                    "type": "string",
                    "description": (
                        "The exact widget name from the catalog "
                        '(e.g. "Chart", "ParameterController").'
                    ),
                }
            },
            "required": ["widget_name"],
        },
    },
}


def _resolve_tool_calls(
    tool_calls: list[dict[str, Any]],
    full_registry: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Execute tool calls against the widget registry and return tool result messages.

    Currently handles ``get_widget_details`` only. Unknown tool names return an
    error payload so the AI can self-correct rather than silently stalling.

    Args:
        tool_calls: Tool call objects from an OpenRouter assistant response.
        full_registry: Full widget registry list (factory excluded) sent by the frontend.

    Returns:
        List of ``role: "tool"`` messages ready to append to the conversation.
    """
    registry_by_name = {w["name"]: w for w in full_registry}
    results: list[dict[str, Any]] = []

    for tc in tool_calls:
        fn_name = tc.get("function", {}).get("name", "")
        if fn_name == "get_widget_details":
            args: dict[str, Any] = json.loads(tc["function"]["arguments"])
            widget_name = args.get("widget_name", "")
            widget = registry_by_name.get(widget_name)
            content = (
                json.dumps(widget)
                if widget is not None
                else json.dumps(
                    {"error": f"Widget '{widget_name}' not found in registry"}
                )
            )
        else:
            content = json.dumps({"error": f"Unknown tool '{fn_name}'"})

        results.append(
            {
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": content,
            }
        )

    return results


# ─── OpenRouter client ────────────────────────────────────────────────────────


async def call_openrouter(
    messages: list[dict[str, Any]],
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int = 2048,
    api_key: str | None = None,
    tools: list[dict[str, Any]] | None = None,
    full_registry: list[dict[str, Any]] | None = None,
    _transport: httpx.AsyncBaseTransport | None = None,
) -> str:
    """Send a chat completion request to OpenRouter and return the response text.

    When ``tools`` are provided the function runs a tool-call loop: if the model
    responds with ``finish_reason: "tool_calls"``, each call is executed via
    :func:`_resolve_tool_calls`, the results are appended to the conversation,
    and a new request is sent. The loop repeats until the model returns a plain
    content response or :data:`_MAX_TOOL_ROUNDS` is exceeded.

    Args:
        messages: OpenAI-format messages array.
        model: OpenRouter model identifier. Must be set here or via the
               ``OPENROUTER_DEFAULT_MODEL`` env var — see https://openrouter.ai/models.
        temperature: Sampling temperature (0.0–1.0). Default 0.2 for structured output.
        max_tokens: Maximum tokens in the response.
        api_key: OpenRouter API key. Defaults to ``OPENROUTER_API_KEY`` env var.
        tools: OpenAI-format tool definitions to include in the request.
        full_registry: Full widget registry used to resolve ``get_widget_details``
                       tool calls. Required when ``tools`` is non-empty.
        _transport: Optional async transport — used in tests to inject a mock.

    Returns:
        Response content string from the AI.

    Raises:
        ValueError: If no API key is available, or the tool-call loop is exceeded.
        httpx.HTTPStatusError: If OpenRouter returns a non-2xx status.
    """
    resolved_key = api_key or os.environ.get("OPENROUTER_API_KEY")
    if not resolved_key:
        raise ValueError("OPENROUTER_API_KEY must be set")

    resolved_model = model or os.environ.get("OPENROUTER_DEFAULT_MODEL")
    if not resolved_model:
        raise ValueError(
            "OPENROUTER_DEFAULT_MODEL must be set. "
            "Browse current models at https://openrouter.ai/models"
        )

    headers = {
        "Authorization": f"Bearer {resolved_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/app-framework",
        "X-Title": "app-framework AI Layout",
    }

    client_kwargs: dict[str, Any] = {}
    if _transport is not None:
        client_kwargs["transport"] = _transport

    loop_messages: list[dict[str, Any]] = list(messages)

    async with httpx.AsyncClient(**client_kwargs) as client:
        for _ in range(_MAX_TOOL_ROUNDS):
            payload: dict[str, Any] = {
                "model": resolved_model,
                "messages": loop_messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
            if tools:
                payload["tools"] = tools

            response = await client.post(
                f"{OPENROUTER_BASE_URL}/chat/completions",
                headers=headers,
                json=payload,
                timeout=30.0,
            )
            response.raise_for_status()
            data = response.json()
            choice = data["choices"][0]
            message = choice["message"]

            if choice.get("finish_reason") != "tool_calls":
                content = message.get("content")
                if content:
                    return str(content)
                # Claude sometimes returns finish_reason="stop" with null content
                # after tool calls. Nudge once more for the final JSON output.
                loop_messages.append({"role": "assistant", "content": None})
                loop_messages.append(
                    {
                        "role": "user",
                        "content": (
                            "Provide the final JSON object with 'layout' and 'explanation' keys."
                        ),
                    }
                )
                continue

            # AI wants to call tools — execute them and continue the loop.
            tool_calls: list[dict[str, Any]] = message.get("tool_calls", [])
            loop_messages.append(
                {
                    "role": "assistant",
                    "content": message.get("content"),
                    "tool_calls": tool_calls,
                }
            )
            loop_messages.extend(_resolve_tool_calls(tool_calls, full_registry or []))

    raise ValueError(
        f"Tool-call loop exceeded {_MAX_TOOL_ROUNDS} iterations without a final response"
    )


# ─── JSON extraction ──────────────────────────────────────────────────────────


def extract_json(text: str) -> dict[str, Any]:
    """Extract a JSON object from an AI response string.

    Handles bare JSON, JSON wrapped in markdown code fences, and JSON
    embedded anywhere inside a larger text response.

    Args:
        text: Raw AI response text.

    Returns:
        Parsed JSON as a dict.

    Raises:
        ValueError: If no valid JSON object can be extracted.
    """
    text = text.strip()
    if not text:
        raise ValueError("AI returned an empty response")

    # Strip markdown code fences (```json ... ``` or ``` ... ```)
    if text.startswith("```"):
        lines = text.splitlines()
        inner = lines[1:-1] if lines[-1].strip() == "```" else lines[1:]
        text = "\n".join(inner).strip()

    # Try direct parse first (fast path for well-behaved models)
    try:
        return dict(json.loads(text))
    except json.JSONDecodeError:
        pass

    # Fall back: find the first {...} block anywhere in the response.
    # Some models wrap their JSON in prose before/after it.
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return dict(json.loads(match.group()))
        except json.JSONDecodeError:
            pass

    raise ValueError(
        f"Could not parse AI response as JSON. Response preview: {text[:300]!r}"
    )


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
    current_layout: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Assemble the messages array for a layout generation request.

    Args:
        user_message: Current user prompt.
        widget_catalog: Full widget registry (factory excluded) — includes
            ``defaultRegion``, ``channelPattern``, and ``parameters`` schema
            so the model can configure widget props without tool calls.
        layout_schema: JSON Schema for ShellLayout.
        history: Prior approved conversation turns as
            ``[{"user": ..., "assistant": ...}]``. Rejected turns must be
            excluded by the caller so they do not pollute the AI context.
        current_layout: The live ShellLayout currently displayed. When
            provided, the AI starts from it and applies only the requested
            changes instead of generating from scratch.

    Returns:
        Messages array ready to pass to :func:`call_openrouter`.
    """
    current_layout_text = (
        json.dumps(current_layout, indent=2)
        if current_layout is not None
        else "None provided — generate a sensible default layout."
    )
    system_content = (
        _LAYOUT_SYSTEM_PROMPT.replace(
            "<catalog_json>", json.dumps(widget_catalog, indent=2)
        )
        .replace("<schema_json>", json.dumps(layout_schema, indent=2))
        .replace("<current_layout_json>", current_layout_text)
    )

    messages: list[dict[str, Any]] = [{"role": "system", "content": system_content}]

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


# ─── FastAPI models ───────────────────────────────────────────────────────────


class LayoutRequest(BaseModel):
    """Request body for ``POST /ai/layout``.

    Attributes:
        prompt: Natural-language description of the desired dashboard.
        history: Prior approved conversation turns as
            ``[{"user": ..., "assistant": ...}]``. Rejected turns must be
            excluded by the caller so they do not pollute the AI context.
        registry: Full widget registry list sent by the frontend (factory
            field excluded).
        current_layout: The live ShellLayout currently displayed. The AI uses
            this to preserve existing regions when making partial changes.
    """

    prompt: str
    history: list[dict[str, str]] = []
    registry: list[dict[str, Any]]
    current_layout: dict[str, Any] | None = None


class LayoutResponse(BaseModel):
    """Response body for ``POST /ai/layout``.

    Attributes:
        layout: Validated ``ShellLayout`` dict generated by the AI.
        explanation: Short human-readable summary of what was built and why.
    """

    layout: dict[str, Any]
    explanation: str


# ─── Route mounting ───────────────────────────────────────────────────────────


def mount_ai_routes(app: FastAPI) -> None:
    """Mount AI layout generation endpoints onto the given FastAPI app.

    Call once after
    ``create_app()``:

    .. code-block:: python

        app = create_app(lifespan=lifespan)
        mount_ai_routes(app)

    On the first validation failure (unregistered widget type), the endpoint
    automatically retries once by appending a correction hint to the
    conversation.  If the retry also fails validation, a ``422`` response is
    returned with the validation errors and the AI's explanation.

    Args:
        app: FastAPI application instance to attach routes to.
    """

    @app.post("/ai/layout", response_model=LayoutResponse)
    async def generate_layout(request: LayoutRequest) -> LayoutResponse:
        """Generate a validated ShellLayout from a natural-language prompt.

        Args:
            request: ``LayoutRequest`` containing the prompt, conversation
                history, and widget registry snapshot from the frontend.

        Returns:
            ``LayoutResponse`` with the validated layout and an explanation.

        Raises:
            HTTPException: 422 if layout validation still fails after one
                automatic retry with a correction hint.
        """
        registered_names = {w["name"] for w in request.registry}
        messages = build_layout_prompt(
            user_message=request.prompt,
            widget_catalog=request.registry,
            layout_schema=SHELL_LAYOUT_JSON_SCHEMA,
            history=request.history,
            current_layout=request.current_layout,
        )

        try:
            raw = await call_openrouter(messages=messages)
            data = extract_json(raw)
        except (ValueError, httpx.HTTPStatusError) as exc:
            raise HTTPException(status_code=502, detail={"errors": [str(exc)]}) from exc

        layout: dict[str, Any] = data.get("layout", {})
        explanation: str = data.get("explanation", "")

        errors = validate_layout(layout, registered_names=registered_names)

        if errors:
            correction = (
                f"Your previous response used widget types that are not in the catalog. "
                f"Errors: {errors}. "
                f"Use only types from the catalog: {sorted(registered_names)}."
            )
            retry_messages: list[dict[str, Any]] = list(messages) + [
                {"role": "assistant", "content": raw},
                {"role": "user", "content": correction},
            ]
            try:
                raw = await call_openrouter(messages=retry_messages)
                data = extract_json(raw)
            except (ValueError, httpx.HTTPStatusError) as exc:
                raise HTTPException(
                    status_code=502, detail={"errors": [str(exc)]}
                ) from exc

            layout = data.get("layout", {})
            explanation = data.get("explanation", "")
            errors = validate_layout(layout, registered_names=registered_names)

            if errors:
                raise HTTPException(
                    status_code=422,
                    detail={"errors": errors, "explanation": explanation},
                )

        return LayoutResponse(layout=layout, explanation=explanation)
