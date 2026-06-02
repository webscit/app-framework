# AI Layout Generation — Implementation Plan

**Goal:** Enable engineers to describe their simulation in natural language and receive a ready-made dashboard layout — using only widgets already registered in the `WidgetRegistry` — without writing any frontend code.

**Architecture:** A chat panel is added to the application shell. User messages are sent to the Python backend which constructs a structured prompt (user message + widget registry catalog + JSON layout schema) and forwards the request to an AI provider via **OpenRouter**. The backend returns a validated `ShellLayout` JSON. The frontend shows a diff of the proposed layout and waits for the user to approve before applying it.

**Tech Stack:**

- Frontend — TypeScript, React, **shadcn/ui** (not the custom toolkit). New components: `AIChatPanel`, `LayoutDiffViewer`.
- Backend — Python, FastAPI, `httpx` for OpenRouter HTTP calls. New module: `pypackages/framework-core/src/framework_core/ai.py`.
- AI provider abstraction — **OpenRouter** (`https://openrouter.ai/api/v1`), OpenAI-compatible API, model-switchable via config.

---

## 1. Problem Statement

### 1.1 Simulation engineer persona

A simulation engineer knows their model — its inputs, outputs, and tunable parameters — but has limited frontend experience. Today, wiring the `ParameterController`, `Chart`, and `LogViewer` widgets into a layout requires hand-editing JSON, understanding the `ShellLayout` schema, and knowing which widget types exist in the registry. This is a barrier that takes minutes at best and breaks flow.

**What they need:** Describe the simulation in plain English and get a working dashboard in seconds. Then refine it iteratively: "make the chart line blue", "add a second chart for residual", "move the sliders to the right sidebar".

### 1.3 What this solves

- Zero-code layout generation from a plain-English description
- AI constrained to the registered widget catalog — no hallucinated widget types
- Iterative refinement over a conversation history
- Model-agnostic infrastructure — test Claude, GPT-4o, Gemini, xAI, etc. via a single OpenRouter integration

### 1.4 What this does not solve (out of scope for v1)

- Streaming widget output directly into AI context (AI cannot see live data values)
- Saving or sharing chat histories
- Layout import/export from file (covered by JSON persistence spec)
- Authentication / multi-user sessions

---

## 2. Scope

**In scope for v1:**

- Mode 1 — Visual layout generation via natural language chat
- Chat panel component integrated into the application shell
- Layout diff viewer (show proposed changes, approve / reject)
- Python `ai.py` helper module in `framework-core` for OpenRouter calls
- New FastAPI endpoint: `POST /ai/layout`
- OpenRouter model selection via server config / environment variable
- Widget registry serialisation into the AI prompt context
- System prompt that enforces the widget registry constraint

**Out of scope for v1:**

- Streaming responses (SSE / WebSocket streaming from AI)
- Chat history persistence across page reloads
- Fine-tuned or locally-hosted models
- Image / screenshot input to the AI
- Automatic layout application without user approval
- Layout undo/redo (separate feature)

---

## 3. Architecture

### 3.1 System diagram

```
Browser (React)                        Backend (FastAPI / framework-core)
┌──────────────────────────────┐       ┌────────────────────────────────────────┐
│  ApplicationShell            │       │  POST /ai/layout                       │
│  ┌────────────────────────┐  │       │  ┌──────────────────────────────────┐  │
│  │  AIChatPanel           │──┼──────►│  │  ai.py                           │  │
│  │  - message history     │  │ HTTP  │  │  build_layout_prompt()           │  │
│  │  - text input          │  │       │  │  call_openrouter()               │  │
│  │  - Approve/Reject      │◄─┼───────│  │  validate_layout_response()      │  │
│  └────────────────────────┘  │       │  └────────────────┬─────────────────┘  │
│  ┌────────────────────────┐  │       │                   │                    │
│  │  LayoutDiffViewer      │  │       │                   ▼                    │
│  │  - before/after JSON   │  │       │  OpenRouter API                        │
│  │  - human-readable diff │  │       │  (Claude / GPT-4o / Gemini / xAI)     │
│  └────────────────────────┘  │       └────────────────────────────────────────┘
└──────────────────────────────┘
```

### 3.2 Data flow summary

```
1. User types prompt in AIChatPanel
2. Frontend POST /ai/layout { prompt, history }
3. Backend builds prompt: system_prompt + registry_catalog + user_message
4. Backend calls OpenRouter → AI returns ShellLayout JSON
5. Backend validates JSON against ShellLayout schema
6. Backend returns { layout: ShellLayout, explanation: string }
7. Frontend renders LayoutDiffViewer (before vs proposed)
8. User clicks Approve → ApplicationShell applies new layout
   User clicks Reject → discard, continue conversation
```

### 3.4 Prerequisites before implementation

The following one-time setup steps must be completed before any implementation task begins:

1. **Extend the Vite dev proxy** — `examples/frontend/vite.config.ts` currently only proxies `/ws` to the backend. Add `/ai` so that `fetch("/ai/layout")` from the browser is forwarded to `http://127.0.0.1:8000`:

```ts
proxy: {
  "/ws": { target: "http://127.0.0.1:8000", ws: true, changeOrigin: true },
  "/ai": { target: "http://127.0.0.1:8000", changeOrigin: true },
},
```

2. **Scaffold missing shadcn components** — `Sheet`, `ScrollArea`, and `Textarea` are not yet present in `packages/framework-core-ui/src/components/ui/`. Run:

```bash
cd packages/framework-core-ui
npx shadcn@latest add sheet scroll-area textarea
```

These must exist before `AIChatPanel.tsx` can be implemented.

---

## 4. Mode 1 — Visual Layout Generation (Detailed Flow)

### 4.1 Step-by-step

**Step 1 — User opens chat panel**

The `AIChatPanel` is mounted in the application shell. It slides in from the right edge (or renders as a bottom panel — see open question). An initial assistant message reads:

> "Describe your simulation — its inputs, outputs, and parameters — and I'll build a dashboard for you using the available widgets."

**Step 2 — User sends a prompt**

Example:

> "I have a sinusoid model with frequency (0.1–10 Hz) and amplitude (0.1–2.0) parameters. I want sliders to control them and a live chart showing the output."

The frontend sends:

```json
POST /ai/layout
{
  "prompt": "I have a sinusoid model with...",
  "history": []
}
```

**Step 3 — Backend builds the prompt**

The backend assembles the full prompt (see Section 8 for the exact system prompt). It includes:

1. System prompt — role, constraints, output format rules
2. Widget registry catalog — all registered widgets serialised as JSON (see Section 6)
3. JSON layout schema — the `ShellLayout` shape (see Section 7)
4. Conversation history — prior turns (for iterative refinement)
5. User message — the current prompt

**Step 4 — AI generates layout**

The AI responds with a JSON object containing a `ShellLayout` and a short human-readable explanation. Example response:

```json
{
  "explanation": "I placed a ParameterController in the left sidebar with frequency and amplitude sliders, and a Chart in the main area subscribed to data/sine.",
  "layout": {
    "regions": {
      "header": { "visible": true, "items": [] },
      "sidebar-left": {
        "visible": true,
        "items": [
          {
            "id": "sim-params",
            "type": "ParameterController",
            "props": {
              "channel": "params/control",
              "debounceMs": 300,
              "parameters": {
                "frequency": {
                  "title": "Frequency (Hz)",
                  "type": "number",
                  "minimum": 0.1,
                  "maximum": 10.0,
                  "multipleOf": 0.1,
                  "default": 1.0,
                  "x-options": { "widget": "slider" }
                },
                "amplitude": {
                  "title": "Amplitude",
                  "type": "number",
                  "minimum": 0.1,
                  "maximum": 2.0,
                  "multipleOf": 0.1,
                  "default": 1.0,
                  "x-options": { "widget": "slider" }
                }
              }
            },
            "order": 0
          }
        ]
      },
      "main": {
        "visible": true,
        "items": [
          {
            "id": "sine-chart",
            "type": "Chart",
            "props": {
              "title": "Sine Wave Output",
              "maxPoints": 200,
              "yDomain": [-2.1, 2.1],
              "yLabel": "Amplitude",
              "xLabel": "Elapsed time (s)",
              "series": [
                {
                  "channel": "data/sine",
                  "field": "value",
                  "label": "sin(t)"
                }
              ]
            },
            "order": 0
          }
        ]
      },
      "sidebar-right": { "visible": false, "items": [] },
      "bottom": { "visible": false, "items": [] },
      "status-bar": { "visible": true, "items": [] }
    }
  }
}
```

**Step 5 — Backend validates**

Before returning the response, the backend:

- Checks that all `type` values in `items` exist in the registered widget catalog
- Checks that the `regions` object has all six required region keys
- Rejects any response that references an unregistered widget type with a `400` error and retries once (see Section 9.3)

**Step 6 — Frontend shows diff**

`LayoutDiffViewer` renders a side-by-side (or before/after) view of the current layout vs the proposed layout. The AI's explanation is shown above the diff.

**Step 7 — User approves or rejects**

- **Approve** → `useShellLayoutStore.setState({ layout: proposed })` — the shell re-renders immediately.
- **Reject** → proposed layout is discarded; user can type a follow-up prompt.

**Step 8 — Iterative refinement**

The approved layout is stored in chat history. Follow-up prompts are sent with the full history so the AI has context:

> "Make the chart line blue and add an amplitude readout in the status bar."

The backend appends the new prompt to the existing history and generates a revised layout.

---

## 6. Widget Registry Catalog Format

The initial prompt includes only widget names and descriptions — a lightweight catalog that keeps the prompt short and focused. Full widget details (channelPattern, consumes, priority, defaultRegion, parameters) are made available via a `get_widget_details` tool that the AI can call on demand.

### 6.1 Catalog schema

Lightweight catalog sent in every prompt:

```typescript
interface WidgetCatalogEntry {
  name: string;
  description: string;
}

type WidgetCatalog = WidgetCatalogEntry[];
```

Full widget details are available through the `get_widget_details` tool (see Section 6.3).

### 6.2 Example serialised catalog (sent in prompt)

```json
[
  {
    "name": "Chart",
    "description": "Live time-series line chart. Subscribes to one or more EventBus channels and plots incoming scalar values in a scrolling window."
  },
  {
    "name": "ParameterController",
    "description": "Interactive control panel for tuning simulation parameters at runtime. Publishes parameter updates to a configurable EventBus channel."
  },
  {
    "name": "LogViewer",
    "description": "Displays live log stream from simulation stdout/stderr. Suitable for real-time monitoring of text-based output with a scrollable, searchable interface."
  },
  {
    "name": "StatusIndicator",
    "description": "Displays heartbeat and run status from the control channel. Shows connection status, last heartbeat time, and simulation run state."
  }
]
```

### 6.3 `get_widget_details` tool

When the AI needs full schema information for a widget (to correctly populate props), it calls `get_widget_details`:

```typescript
// Tool definition sent to the AI alongside the catalog
{
  "type": "function",
  "function": {
    "name": "get_widget_details",
    "description": "Returns full details for a registered widget: channelPattern, consumes, priority, defaultRegion, and parameters schema.",
    "parameters": {
      "type": "object",
      "properties": {
        "widget_name": {
          "type": "string",
          "description": "The exact widget name from the catalog (e.g. \"Chart\", \"ParameterController\")."
        }
      },
      "required": ["widget_name"]
    }
  }
}
```

The backend handles this tool call by looking up the widget in `request.registry` (the full `WidgetDefinition` list the frontend sends, minus the `factory` function) and returning the entry for that widget name.

### 6.4 How the catalog is built and sent

The backend has no Python registry — `WidgetRegistry` is a frontend-only TypeScript class. The frontend **must** send its registry snapshot in the `/ai/layout` request body. This is the only valid approach for v1.

The frontend sends the full registry (factory excluded) in the request body. The backend extracts only name + description for the initial prompt, and serves full details on demand for tool calls:

```typescript
// Full registry sent in request body for tool-call lookups
const registry = widgetRegistry.list().map(({ factory: _factory, ...rest }) => rest);
// POST /ai/layout body includes `registry`
```

The backend serialises only name + description into the system prompt:

```python
def serialise_catalog(registry: list[dict]) -> list[dict]:
    """Extract lightweight catalog (name + description only) for the initial prompt."""
    return [{"name": w["name"], "description": w["description"]} for w in registry]
```

Full widget details are served on demand when the AI calls `get_widget_details`, by looking up the widget name in the full `request.registry` list.

---

## 7. JSON Layout Schema (Output Contract)

The AI must output a complete `ShellLayout` object. The backend validates the response against this shape before returning it to the frontend.

### 7.1 ShellLayout schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ShellLayout",
  "type": "object",
  "required": ["regions"],
  "properties": {
    "regions": {
      "type": "object",
      "required": [
        "header",
        "sidebar-left",
        "main",
        "sidebar-right",
        "bottom",
        "status-bar"
      ],
      "properties": {
        "header": { "$ref": "#/definitions/RegionState" },
        "sidebar-left": { "$ref": "#/definitions/RegionState" },
        "main": { "$ref": "#/definitions/RegionState" },
        "sidebar-right": { "$ref": "#/definitions/RegionState" },
        "bottom": { "$ref": "#/definitions/RegionState" },
        "status-bar": { "$ref": "#/definitions/RegionState" }
      }
    }
  },
  "definitions": {
    "RegionState": {
      "type": "object",
      "required": ["visible", "items"],
      "properties": {
        "visible": { "type": "boolean" },
        "items": { "type": "array", "items": { "$ref": "#/definitions/RegionItem" } }
      }
    },
    "RegionItem": {
      "type": "object",
      "required": ["id", "type", "props"],
      "properties": {
        "id": { "type": "string" },
        "type": {
          "type": "string",
          "description": "Must match a registered widget name."
        },
        "props": { "type": "object" },
        "order": { "type": "integer", "default": 0 }
      }
    }
  }
}
```

### 7.2 Validation rules enforced server-side

| Rule                                       | Check                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| All six region keys present                | `regions` has `header`, `sidebar-left`, `main`, `sidebar-right`, `bottom`, `status-bar` |
| `header`, `main`, `status-bar` are visible | `visible: true` forced if false (mirrors `applyNonTogglableCorrection`)                 |
| Widget type exists                         | Every `item.type` must be in the server-side registry list                              |
| Item IDs are unique                        | No two items in the entire layout share the same `id`                                   |
| Props are an object                        | `item.props` is a non-null object (not an array or primitive)                           |

---

## 8. Prompt Engineering Strategy

### 8.1 Layout generation system prompt

```
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
8. For ParameterController, populate the "parameters" prop from the user's description of their
   simulation inputs. Infer reasonable min/max/default values from context.
9. For Chart, set the "series" prop to subscribe to the channel the backend publishes data on.
   Default to "data/<signal_name>" if the user does not specify a channel.

WIDGET CATALOG (name and description only — call get_widget_details for full schema):
<catalog_json>

LAYOUT SCHEMA:
<schema_json>
```

### 8.2 Conversation structure (messages array sent to OpenRouter)

```python
messages = [
    {"role": "system",    "content": system_prompt},
    # prior turns from history
    {"role": "user",      "content": history[0]["user"]},
    {"role": "assistant", "content": history[0]["assistant"]},
    # ... more history pairs ...
    # current turn
    {"role": "user",      "content": current_prompt},
]
```

The `history` field in the request body is a list of `{ "user": str, "assistant": str }` objects representing prior approved turns. Rejected turns are excluded — the user's intent was not realised so they should not pollute the context.

### 8.3 Anti-hallucination enforcement

The AI is told explicitly in the system prompt that it may only use widget names from the catalog. Additionally, the backend validates every `item.type` against the live registry after parsing the response. If an unregistered type is found, the backend:

1. Adds an error message to the response: `"Widget type 'XYZ' is not registered. Retrying with a correction hint."`
2. Makes one automatic retry with an appended user message: `"Your previous response used widget type 'XYZ' which does not exist. Use only types from the catalog: [list of valid names]."`
3. If the retry also fails validation, returns a `422` error to the frontend with the explanation and asks the user to rephrase.

### 8.5 Temperature and model settings

| Setting           | Value                       | Rationale                                                  |
| ----------------- | --------------------------- | ---------------------------------------------------------- |
| `temperature`     | `0.2`                       | Deterministic JSON output, minimal creative drift          |
| `max_tokens`      | `2048`                      | Enough for a full ShellLayout with several widgets         |
| `response_format` | `{ "type": "json_object" }` | Enforced where the model supports it (OpenAI, some others) |

> ⚠️ **Decision needed:** Not all models on OpenRouter support `response_format: json_object`. For models that don't, the backend should use a regex or `json.loads` with error recovery to extract the JSON from a markdown-fenced response. A utility `extract_json(text: str) -> dict` should handle both cases.

---

## 9. Python Backend API Design

### 9.1 New module: `framework_core/ai.py`

This module lives in the `framework-core` package and is imported by the example backend (or any consumer app).

**`SHELL_LAYOUT_JSON_SCHEMA` note:** This constant does not exist yet anywhere in the Python codebase — it must be written from scratch. To avoid two sources of truth diverging (the TypeScript `shellTypes.ts` and a Python dict), create a `shell_layout_schema.json` file at the repo root that both sides reference. `ai.py` imports it at module load time; a CI check validates that it matches the TypeScript type. Until that CI check exists, treat the schema in Section 7.1 as the authoritative source and copy it verbatim into `ai.py` as `SHELL_LAYOUT_JSON_SCHEMA`.

````python
# pypackages/framework-core/src/framework_core/ai.py

import json
import os
from typing import Any

import httpx

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "anthropic/claude-3.5-sonnet"


async def call_openrouter(
    messages: list[dict[str, str]],
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int = 2048,
    api_key: str | None = None,
) -> str:
    """Send a chat completion request to OpenRouter and return the response text.

    Args:
        messages: OpenAI-format messages array.
        model: OpenRouter model identifier. Defaults to OPENROUTER_DEFAULT_MODEL env var
               or "anthropic/claude-sonnet-4.6".
        temperature: Sampling temperature (0.0–1.0). Default 0.2 for structured output.
        max_tokens: Maximum tokens in the response.
        api_key: OpenRouter API key. Defaults to OPENROUTER_API_KEY env var.

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

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{OPENROUTER_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {resolved_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://github.com/app-framework",
            },
            json=payload,
            timeout=30.0,
        )
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


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
    # Strip markdown fences if present
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"Could not parse AI response as JSON: {e}") from e


def serialise_catalog(registry: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Extract lightweight catalog (name + description only) for the initial prompt.

    Args:
        registry: Full widget registry list from the frontend (factory excluded).

    Returns:
        List of dicts with only "name" and "description" keys.
    """
    return [{"name": w["name"], "description": w["description"]} for w in registry]


def build_layout_prompt(
    user_message: str,
    widget_catalog: list[dict[str, Any]],
    layout_schema: dict[str, Any],
    history: list[dict[str, str]] | None = None,
) -> list[dict[str, str]]:
    """Assemble the messages array for a layout generation request.

    Args:
        user_message: Current user prompt.
        widget_catalog: Lightweight catalog (name + description only) from serialise_catalog().
        layout_schema: JSON Schema for ShellLayout.
        history: Prior conversation turns as [{"user": ..., "assistant": ...}].

    Returns:
        Messages array ready to pass to call_openrouter().
    """
    system_content = _LAYOUT_SYSTEM_PROMPT.replace(
        "<catalog_json>", json.dumps(widget_catalog, indent=2)
    ).replace(
        "<schema_json>", json.dumps(layout_schema, indent=2)
    )

    messages: list[dict[str, str]] = [{"role": "system", "content": system_content}]

    for turn in history or []:
        messages.append({"role": "user",      "content": turn["user"]})
        messages.append({"role": "assistant", "content": turn["assistant"]})

    messages.append({"role": "user", "content": user_message})
    return messages
````

### 9.2 Framework helper: `mount_ai_routes(app)`

Following the `_mount_ws_bridge(app, bus)` pattern from `ws_bridge.py`, the framework provides `mount_ai_routes(app)` that hooks the AI endpoints onto any FastAPI app. The example backend calls it in one line after `create_app()` — no endpoint code lives in `main.py`.

**`httpx` dependency note:** `httpx` must be added to `pypackages/framework-core/pyproject.toml` under `[project].dependencies` — NOT dev dependencies — because `ai.py` is a runtime module shipped with the package. Currently `httpx>=0.27` is only in the root `pyproject.toml` dev group, which is not installed in production environments.

```python
# pypackages/framework-core/src/framework_core/ai.py (additions)

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


class LayoutRequest(BaseModel):
    prompt: str
    history: list[dict[str, str]] = []
    registry: list[dict]  # full WidgetDefinition list (factory excluded) from the frontend


class LayoutResponse(BaseModel):
    layout: dict
    explanation: str


def mount_ai_routes(app: FastAPI) -> None:
    """Mount AI layout generation endpoints onto the given FastAPI app.

    Follows the same pattern as _mount_ws_bridge. Call after create_app():

        app = create_app(lifespan=lifespan)
        mount_ai_routes(app)

    Args:
        app: FastAPI application instance to attach routes to.
    """

    @app.post("/ai/layout", response_model=LayoutResponse)
    async def generate_layout(request: LayoutRequest) -> LayoutResponse:
        catalog = serialise_catalog(request.registry)
        messages = build_layout_prompt(
            user_message=request.prompt,
            widget_catalog=catalog,
            layout_schema=SHELL_LAYOUT_JSON_SCHEMA,
            history=request.history,
        )
        raw = await call_openrouter(messages)
        data = extract_json(raw)

        layout = data.get("layout")
        explanation = data.get("explanation", "")

        errors = validate_layout(layout, registered_names={w["name"] for w in request.registry})
        if errors:
            raise HTTPException(status_code=422, detail={"errors": errors, "raw": raw})

        return LayoutResponse(layout=layout, explanation=explanation)
```

The example backend wires it in with a single call:

```python
# examples/backend/main.py (additions)
from framework_core.ai import mount_ai_routes

app = create_app(lifespan=lifespan)
mount_ai_routes(app)
```

No endpoint code lives in `main.py` — all route logic is encapsulated in the framework helper.

### 9.3 Layout validation helper

```python
def validate_layout(
    layout: dict,
    registered_names: set[str],
) -> list[str]:
    """Validate a ShellLayout dict against structural and registry constraints.

    Args:
        layout: Parsed layout object from AI response.
        registered_names: Set of valid widget type names from the registry.

    Returns:
        List of error strings. Empty list means valid.
    """
    errors: list[str] = []
    required_regions = {"header", "sidebar-left", "main", "sidebar-right", "bottom", "status-bar"}
    regions = layout.get("regions", {})

    missing = required_regions - set(regions.keys())
    if missing:
        errors.append(f"Missing regions: {missing}")

    seen_ids: set[str] = set()
    for region_id, region in regions.items():
        for item in region.get("items", []):
            widget_type = item.get("type")
            if widget_type not in registered_names:
                errors.append(
                    f"Region '{region_id}': widget type '{widget_type}' is not registered. "
                    f"Valid types: {sorted(registered_names)}"
                )
            item_id = item.get("id")
            if item_id in seen_ids:
                errors.append(f"Duplicate item id '{item_id}'")
            seen_ids.add(item_id)

    return errors
```

### 9.4 Environment variables

| Variable                   | Required | Default                       | Description            |
| -------------------------- | -------- | ----------------------------- | ---------------------- |
| `OPENROUTER_API_KEY`       | Yes      | —                             | OpenRouter API key     |
| `OPENROUTER_DEFAULT_MODEL` | No       | `anthropic/claude-3.5-sonnet` | Model identifier       |
| `OPENROUTER_MAX_TOKENS`    | No       | `2048`                        | Max tokens per request |
| `OPENROUTER_TEMPERATURE`   | No       | `0.2`                         | Sampling temperature   |

---

## 10. Frontend Component Design

### 10.1 AIChatPanel

**Location:** `packages/framework-core-ui/src/components/AIChatPanel.tsx`

**Props:**

```typescript
interface AIChatPanelProps {
  /** Base URL of the backend. Defaults to window.location.origin. */
  backendUrl?: string;
  /** Called when the user approves a generated layout. */
  onLayoutApprove: (layout: ShellLayout) => void;
  /** Whether panel is open. */
  open: boolean;
  /** Called when panel close is requested. */
  onClose: () => void;
}
```

**Internal state:**

```typescript
type MessageRole = "user" | "assistant" | "error";

interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  /** Present on assistant messages that carry a layout proposal. */
  proposedLayout?: ShellLayout;
}
```

**Behaviour:**

- Maintains a `messages: ChatMessage[]` array in local state.
- On submit, appends the user message and calls `POST /ai/layout`.
- While waiting, shows a typing indicator.
- On success, appends the assistant message. If a `proposedLayout` is present, renders `LayoutDiffViewer` inline within the assistant bubble.
- On error, appends an `error` message with the detail.
- Scroll-to-bottom on every new message (same pattern as `LogViewerComponent`).

**Required shadcn setup:** `Sheet`, `ScrollArea`, and `Textarea` are not yet present in `packages/framework-core-ui/src/components/ui/`. They must be scaffolded before this component can be implemented (see Section 3.4 Prerequisites):

```bash
npx shadcn@latest add sheet scroll-area textarea
```

**UI structure (shadcn/ui components):**

```
<Sheet> (right-side panel, width 420px)
  <SheetHeader>
    "AI Layout Assistant"
  </SheetHeader>
  <ScrollArea className="chat-messages">
    {messages.map(msg => <ChatBubble ... />)}
  </ScrollArea>
  <SheetFooter>
    <Textarea placeholder="Describe your simulation..." />
    <Button>Send</Button>
  </SheetFooter>
</Sheet>
```

> **Decision needed:** Should `AIChatPanel` be a right-side `Sheet` (overlay) or a resizable panel docked into the shell layout? A docked panel would require adding a seventh region (e.g. `"chat"`) to `ShellLayout` or treating it as a shell-level element outside the layout system. For v1, `Sheet` overlay is simpler and avoids schema changes.

### 10.2 LayoutDiffViewer

**Location:** `packages/framework-core-ui/src/components/LayoutDiffViewer.tsx`

**Props:**

```typescript
interface LayoutDiffViewerProps {
  current: ShellLayout;
  proposed: ShellLayout;
  explanation: string;
  onApprove: () => void;
  onReject: () => void;
}
```

**Behaviour:**

- Renders the AI's `explanation` text above the visual preview.
- Shows a **side-by-side visual wireframe** of the current layout (left) and the proposed layout (right). Each wireframe is a miniaturised CSS grid representing the six shell regions (`header`, `sidebar-left`, `main`, `sidebar-right`, `bottom`, `status-bar`). Widget names are shown inside each region cell.
- **Changed regions** are highlighted with a distinct border and background colour. A region is "changed" if its `items` array or `visible` flag differs between current and proposed.
- Unchanged regions render in a muted style.
- Does NOT show raw JSON by default. Provides a "Show JSON" toggle that expands a `<pre>` block with the proposed layout JSON for power users.
- **Approve** button calls `onApprove`. **Reject** button calls `onReject`.

**Visual wireframe layout:**

```
     Current layout               Proposed layout

 ┌─────────────────────┐      ┌─────────────────────┐
 │       header        │      │       header        │
 ├───────────┬─────────┤      ├───────────┬─────────┤
 │ sidebar-  │         │      │ sidebar-  │         │ ◄ changed
 │   left    │  main   │      │   left    │  main   │
 │           │         │      │[ParamCtrl]│ [Chart] │
 ├───────────┴─────────┤      ├───────────┴─────────┤
 │        bottom       │      │        bottom       │
 ├─────────────────────┤      ├─────────────────────┤
 │      status-bar     │      │      status-bar     │
 └─────────────────────┘      └─────────────────────┘
```

**Region diff legend:**

- Highlighted border + accent background — region changed (items added, removed, or modified)
- Muted/normal style — region unchanged

### 10.3 Integration in the example app

In `examples/frontend/src/main.tsx`, add a chat toggle button inside the existing `Dashboard` component (which already renders inside `AppShell`) and lift `chatOpen` state up to `App`. `AppShell` has no props — the toggle must live in `Dashboard`, not as a prop on `AppShell`.

Note: the `onLayoutApprove` handler must pass the layout through `applyNonTogglableCorrection` before writing to the store, to preserve the invariant that `header`, `main`, and `status-bar` are always visible. Import `applyNonTogglableCorrection` from `@app-framework/core-ui` (it must be exported from `index.ts` first).

```tsx
// App manages chat open state and passes setter down via context or prop drilling
function App() {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <WidgetRegistryContext.Provider value={registry}>
      <EventBusProvider path="/ws">
        <WidgetLoaderProvider>
          <AppShell />
          {/* Dashboard renders its own toggle button — see Dashboard component */}
          <AIChatPanel
            open={chatOpen}
            onClose={() => setChatOpen(false)}
            onLayoutApprove={(layout) => {
              useShellLayoutStore.setState({
                layout: applyNonTogglableCorrection(layout),
              });
              setChatOpen(false);
            }}
          />
        </WidgetLoaderProvider>
      </EventBusProvider>
    </WidgetRegistryContext.Provider>
  );
}
```

> ⚠️ **Decision needed:** `Dashboard` is rendered inside `AppShell`, which does not receive props from `App`. Passing `setChatOpen` down requires either (a) lifting `Dashboard` out of `AppShell` into `App` directly, or (b) using a React context for the chat toggle. Option (a) is simpler and matches the existing structure where `Dashboard` and `ApplicationShell` are siblings inside `AppShell`'s JSX.

---

## 11. OpenRouter Integration Notes

### 11.1 Why OpenRouter

OpenRouter provides a single OpenAI-compatible endpoint (`https://openrouter.ai/api/v1/chat/completions`) that proxies to 100+ models. Switching models requires changing only the `model` string — no SDK changes, no new dependencies.

### 11.2 Model selection strategy

| Use case                       | Suggested starting model      | Notes                                          |
| ------------------------------ | ----------------------------- | ---------------------------------------------- |
| Layout generation (default)    | `anthropic/claude-3.5-sonnet` | Best at structured JSON, instruction following |
| Layout generation (fast/cheap) | `anthropic/claude-3-haiku`    | Test if prompt quality holds at lower cost     |
| Evaluation / comparison        | `google/gemini-2.5-pro`       | Alternate provider                             |

The model is controlled entirely by the `OPENROUTER_DEFAULT_MODEL` environment variable. No code change is needed to switch.

### 11.3 Cost controls

- `max_tokens: 2048` is sufficient for a full layout with 3–5 widgets. Set as a hard cap.
- For development / CI, use `anthropic/claude-3-haiku` (cheapest) with a mock response fallback.
- OpenRouter's free tier models (e.g. `mistralai/mistral-7b-instruct:free`) can be used for smoke tests.

### 11.4 Headers OpenRouter expects

```python
headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json",
    "HTTP-Referer": "https://github.com/app-framework",  # identifies the app
    "X-Title": "app-framework AI Layout",               # optional, shown in OR dashboard
}
```

---

## 12. Testing Strategy

### 12.1 Python unit tests (`pypackages/framework-core/tests/test_ai.py`)

| Test                                  | What it checks                                             |
| ------------------------------------- | ---------------------------------------------------------- |
| `test_extract_json_bare`              | `extract_json` parses a bare JSON string                   |
| `test_extract_json_fenced`            | `extract_json` strips markdown fences                      |
| `test_extract_json_invalid_raises`    | `extract_json` raises `ValueError` on garbage input        |
| `test_validate_layout_valid`          | Returns empty errors for a well-formed layout              |
| `test_validate_layout_missing_region` | Detects missing required region key                        |
| `test_validate_layout_unknown_widget` | Detects unregistered widget type                           |
| `test_validate_layout_duplicate_id`   | Detects duplicate item IDs                                 |
| `test_build_layout_prompt_structure`  | Messages array has correct role sequence                   |
| `test_call_openrouter_success`        | Uses `httpx.MockTransport` to assert correct request shape |
| `test_call_openrouter_missing_key`    | Raises `ValueError` when no API key                        |
| `test_call_openrouter_http_error`     | Raises `httpx.HTTPStatusError` on 4xx                      |

### 12.2 FastAPI integration tests (`pypackages/framework-core/tests/test_ai_endpoints.py`)

Use `TestClient` with a patched `call_openrouter` that returns a canned valid layout JSON.

| Test                                          | What it checks                               |
| --------------------------------------------- | -------------------------------------------- |
| `test_layout_endpoint_returns_layout`         | Valid prompt → 200 with layout + explanation |
| `test_layout_endpoint_rejects_unknown_widget` | AI returns unregistered widget → 422         |
| `test_layout_endpoint_missing_api_key`        | No env var → 500 with clear error message    |

### 12.3 Frontend unit tests

| Test                                        | What it checks                                |
| ------------------------------------------- | --------------------------------------------- |
| `AIChatPanel` — renders empty state              | Shows placeholder before any messages              |
| `AIChatPanel` — sends request on submit          | `fetch` called with correct body                   |
| `AIChatPanel` — shows loading indicator          | Spinner visible while awaiting response            |
| `AIChatPanel` — renders assistant message        | Message appears after response                     |
| `AIChatPanel` — renders LayoutDiffViewer         | Diff viewer shown when proposedLayout present      |
| `LayoutDiffViewer` — approve calls callback      | `onApprove` called on button click                 |
| `LayoutDiffViewer` — reject calls callback       | `onReject` called on button click                  |
| `LayoutDiffViewer` — highlights changed regions  | Changed regions rendered with accent style         |
| `LayoutDiffViewer` — unchanged regions muted     | Unchanged regions render without accent style      |

### 12.4 Layout quality evaluation (manual / model comparison)

For each candidate model, run a fixed set of benchmark prompts and score the output:

| Benchmark prompt                                              | Pass criteria                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| "Sinusoid with frequency and amplitude sliders, chart output" | Has `ParameterController` + `Chart`, correct channels              |
| "Add a log viewer showing heartbeat messages"                 | Adds `LogViewer` to existing layout, does not remove other widgets |
| "Make the chart show a blue line"                             | Updates `series[0].color` to a valid blue value                    |
| "Move the parameter panel to the right sidebar"               | Changes `defaultRegion` placement correctly                        |
| Prompt with no matching widget need                           | Does not hallucinate; places nothing or uses closest match         |

Scoring: 1 point per criterion met. Models scoring < 3/5 on average are unsuitable for production.

> **Decision needed:** Should benchmark results be stored in the repo as a comparison table, or run ad-hoc during model selection? A lightweight `scripts/eval_models.py` script that runs all benchmarks against a list of models and prints a table would be useful here.

---

## 13. File Structure

```
pypackages/framework-core/src/framework_core/
  ai.py                                # call_openrouter, extract_json, serialise_catalog,
                                       # build_layout_prompt, validate_layout, mount_ai_routes

pypackages/framework-core/tests/
  test_ai.py                           # unit tests for ai.py helpers
  test_ai_endpoints.py                 # integration tests for /ai/layout

examples/backend/
  main.py                              # add mount_ai_routes(app) call

packages/framework-core-ui/src/
  components/
    AIChatPanel.tsx                    # chat panel component
    AIChatPanel.css                    # styles (sct-AIChatPanel- prefix)
    AIChatPanel.test.tsx               # unit tests
    LayoutDiffViewer.tsx               # diff viewer component
    LayoutDiffViewer.css               # styles (sct-LayoutDiffViewer- prefix)
    LayoutDiffViewer.test.tsx          # unit tests
  index.ts                             # export AIChatPanel, LayoutDiffViewer

examples/frontend/src/
  main.tsx                             # add AIChatPanel, wire onLayoutApprove
```

---

## 14. Implementation Checklist

```
- [ ] Task 0: Prerequisites (must be done before all other tasks)
      - [ ] Add /ai proxy entry to examples/frontend/vite.config.ts (see Section 3.4)
      - [ ] npx shadcn@latest add sheet scroll-area textarea (in packages/framework-core-ui)
      - [ ] Add httpx to pypackages/framework-core/pyproject.toml [project].dependencies
      - [ ] Create shell_layout_schema.json at repo root matching the ShellLayout schema in Section 7.1
      - [ ] Import shell_layout_schema.json in ai.py as SHELL_LAYOUT_JSON_SCHEMA

- [ ] Task 1: Python ai.py module (framework-core)
      - [ ] call_openrouter() — httpx POST to OpenRouter, reads OPENROUTER_API_KEY env var
      - [ ] extract_json() — handles bare JSON and markdown-fenced responses
      - [ ] serialise_catalog() — extracts name + description from full registry list
      - [ ] build_layout_prompt() — assembles messages array with system prompt + catalog + history
      - [ ] validate_layout() — checks regions, widget types, unique IDs
      - [ ] mount_ai_routes(app) — registers POST /ai/layout on the passed FastAPI app
      - [ ] _LAYOUT_SYSTEM_PROMPT constant (references get_widget_details tool)
      - [ ] SHELL_LAYOUT_JSON_SCHEMA loaded from shell_layout_schema.json (see Task 0)
      - [ ] Unit tests: test_ai.py (all cases in Section 12.1)

- [ ] Task 2: Backend endpoints (framework helper)
      - [ ] mount_ai_routes(app) wires POST /ai/layout — LayoutRequest → LayoutResponse
      - [ ] One automatic retry on widget type validation failure
      - [ ] 422 with structured error on second failure
      - [ ] examples/backend/main.py: add mount_ai_routes(app) call (one line)
      - [ ] Integration tests: test_ai_endpoints.py (all cases in Section 12.2)

- [ ] Task 3: LayoutDiffViewer component
      - [ ] Props: current, proposed, explanation, onApprove, onReject
      - [ ] Side-by-side visual wireframe of 6 shell regions (current vs proposed)
      - [ ] Changed regions highlighted with accent border + background
      - [ ] Widget names rendered inside each region cell
      - [ ] "Show JSON" toggle with <pre> block
      - [ ] Approve button + Reject button
      - [ ] LayoutDiffViewer.css (sct-LayoutDiffViewer- prefix)
      - [ ] Unit tests: all cases in Section 12.3

- [ ] Task 4: AIChatPanel component
      - [ ] ChatMessage type (user, assistant, error roles)
      - [ ] Message list with scroll-to-bottom
      - [ ] Textarea + Send button
      - [ ] Loading / typing indicator while awaiting response
      - [ ] Renders LayoutDiffViewer inline in assistant bubble when proposedLayout present
      - [ ] Error message bubble on fetch failure
      - [ ] Serialises registry.list() (excluding factory) into the /ai/layout request body
      - [ ] AIChatPanel.css (sct-AIChatPanel- prefix)
      - [ ] Unit tests: all cases in Section 12.3

- [ ] Task 5: Example app wiring
      - [ ] Chat toggle button in Dashboard component
      - [ ] AIChatPanel mounted in App, open state managed
      - [ ] onLayoutApprove calls useShellLayoutStore.setState({ layout: applyNonTogglableCorrection(layout) })
      - [ ] Export applyNonTogglableCorrection from packages/framework-core-ui/src/index.ts

- [ ] Task 6: OpenRouter configuration
      - [ ] OPENROUTER_API_KEY env var documented in README
      - [ ] OPENROUTER_DEFAULT_MODEL env var with sensible default
      - [ ] .env.example file added to examples/backend/

- [ ] Task 7: Quality gate
      - [ ] ruff check .
      - [ ] mypy pypackages/framework-core/src
      - [ ] pytest -q
      - [ ] npm run typecheck
      - [ ] npm run lint
      - [ ] npm run test:ui
      - [ ] npm run format:check
```

---

## 15. Open Questions / Decisions Needed

| #   | Question                                                                                                                                                                                                                  | Impact                         | Suggested default                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------- |
| 1   | ~~Where does the registry catalog come from on the server?~~ **Resolved:** The backend has no Python registry. The frontend must send its catalog in the request body — this is the only valid approach. See Section 6.3. | —                              | Frontend sends it (only option)          |
| 2   | `AIChatPanel` as a `Sheet` overlay or a docked shell region?                                                                                                                                                              | Shell schema changes if docked | Sheet overlay for v1                     |
| 3   | Should rejected AI turns be excluded from conversation history?                                                                                                                                                           | AI context quality             | Yes — only approved turns sent back      |
| 4   | How to handle models that don't support `response_format: json_object`?                                                                                                                                                   | Reliability                    | `extract_json()` fallback for all models |
| 5   | Store chat history in `localStorage`?                                                                                                                                                                                     | UX continuity                  | Out of scope for v1                      |
| 6   | Should `POST /ai/layout` be a streaming endpoint (SSE)?                                                                                                                                                                   | Perceived latency              | Non-streaming for v1; consider SSE in v2 |
| 7   | Benchmark script for model comparison — in-repo or ad-hoc?                                                                                                                                                                | Dev tooling                    | `scripts/eval_models.py` in-repo         |

---

## 16. Out of Scope for v1

- Streaming AI responses (SSE / WebSocket)
- Chat history persistence (localStorage or server-side)
- Image / screenshot input ("here is my current layout, improve it")
- Fine-tuned models or locally-hosted LLMs
- Automatic layout application without user approval
- AI-suggested new widget types not already in the registry
- Multi-user sessions or shared layouts
- Authentication / rate limiting on the AI endpoints
- Layout undo/redo triggered from the AI panel
