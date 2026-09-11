# AI Visual Snapshot Reasoning — the assistant sees your dashboard

**Goal:** Let the AI assistant **look at a screenshot of the running dashboard**
and reason over it — answering "what's wrong with this run?", flagging
anomalies, and (optionally) proposing corrected parameters — the same way a
person analyses a screenshot. The AI sees exactly what the user sees, so its
diagnosis is grounded in the rendered charts, trajectory, and status widgets,
not only in raw numbers.

**Architecture:** The existing `POST /ai/layout` endpoint and the single AI chat
panel are **extended, not replaced**. The frontend captures the shell's rendered
DOM to a PNG in the browser and attaches it to the chat request as an optional
`screenshot` field. When present, the backend builds a **multimodal** message
(text + image) for the already-multimodal Claude model, and its layout-centric
system prompt is rebalanced so visual diagnosis is a first-class response, not an
afterthought. The response shape is unchanged (`explanation` + optional
`suggested_params` + optional `layout`), so the existing Approve/Reject parameter
flow keeps working with no new command types.

**Tech Stack:**

- Backend — Python, FastAPI, existing `framework_core.ai_layout` (OpenRouter
  client). No new backend dependency; the default model
  (`anthropic/claude-sonnet-4-6`) is already vision-capable.
- Frontend — TypeScript, React, existing `@app-framework/core-ui`
  (`AIChatPanel`, `ApplicationShell`). One new dev/runtime dependency: an
  `html2canvas`-style DOM→image library.
- Model input — an OpenRouter multimodal chat message: a text block plus an
  `image_url` block carrying a `data:image/png;base64,…` URL.

**Status:** Specification for review. Implementation follows once approved
(mirrors the Reachy / drone example flow: spec → PR → review → implement).
Branch: `feat/ai-parameter-commands`.

---

## 1. Problem Statement

### 1.1 What the engineer wants

An engineer running a simulation looks at the dashboard — a ringing trajectory,
a tilt chart spiking past a limit, a red status banner — and wants to ask the
assistant _"look at this and tell me what's going wrong"_ and get an answer
grounded in **what is actually on screen**. Today they can describe it in words,
but the AI cannot see the plots the engineer is reacting to.

### 1.2 What exists today (and its limit)

The framework already sends a **structured data snapshot**: `getSnapshot()`
returns `{ context, instructions, currentParams }`, `AIChatPanel` attaches
`context` + `context_instructions` to each `/ai/layout` request (gated by an
"Include app context" toggle, on by default), and the endpoint can return a
diagnosis (`explanation`) plus `suggested_params` that render with Approve /
Reject.

Two limits motivate this work:

1. **No visual grounding.** The AI reasons only over the JSON the app chose to
   put in `context`. It never sees the rendered charts/trajectory, so visual
   patterns (oscillation shape, divergence, where a curve crosses a limit line)
   are invisible to it, and any mismatch between the snapshot data and what is
   drawn on screen is a source of confusion.
2. **Diagnosis is second-class.** The system prompt opens with _"You are a
   dashboard layout generator… your ONLY job is to produce a valid
   ShellLayout"_, with data Q&A bolted on afterwards. The assistant reads as a
   layout tool, so "look at my run" is not an obvious or reliable capability.

### 1.3 What this adds

- A **visual snapshot**: the assistant can capture and reason over an image of
  the current dashboard — "the same screen you see" — so its analysis matches
  the engineer's view with no data/display mismatch.
- **First-class visual diagnosis**: the prompt is rebalanced so answering
  questions and flagging anomalies from the screenshot is a primary response,
  equal to (and independent of) layout changes.
- Reuse of the **existing** Approve/Reject `suggested_params` path, so a visual
  diagnosis can still propose a parameter fix the engineer approves — with no
  new command grammar in this PR.

### 1.4 Next steps after v1

- Richer AI-commanded parameters: goal-directed ("make the drone climb to 5 m")
  and bulk / pattern commands ("freeze all temps of this type"). A distinct,
  larger design — its own spec and PR.
- Optional structured data alongside the image (image + numbers) for exact
  threshold reasoning, if visual-only proves imprecise for some questions.

---

## 2. Scope

**In scope (v1):**

- A browser-side `captureView()` utility in `framework-core-ui` that renders a
  given DOM element (the shell's main content) to a downscaled PNG data URL.
- `AIChatPanel` capturing that screenshot on send and attaching it to the
  request; a thumbnail of what was sent shown in the user's message bubble.
- `ApplicationShell` exposing the capturable region to the panel.
- `POST /ai/layout` accepting an optional `screenshot`; when present, sending a
  multimodal (text + image) message to the model.
- Rebalanced system prompt so visual diagnosis / anomaly-flagging is
  first-class; the response contract (`explanation` / `suggested_params` /
  `layout`) is unchanged.
- Demonstration on an existing example (Reachy Mini; drone once merged): ask the
  AI to look at a broken run and explain it.
- Python + frontend unit tests.

**Out of scope (v1):** new parameter-command grammars (goal / bulk); a new AI
endpoint; server-side / headless rendering of the dashboard; video or streaming
capture; non-Claude vision providers; automatic (unprompted) screenshotting —
the engineer still initiates every request.

---

## 3. Architecture

### 3.1 System diagram

```
┌───────────────── Frontend (ApplicationShell + AIChatPanel) ─────────────────┐
│  user types "what's wrong with this run?"                                   │
│        │                                                                    │
│        ▼                                                                    │
│  captureView(mainRef) ──▶ PNG (base64, downscaled)                          │
│        │                                                                    │
│        ▼   POST /ai/layout { prompt, screenshot, context?, currentLayout }  │
└────────┼────────────────────────────────────────────────────────────────── ┘
         ▼
┌──────────────── Backend (framework_core.ai_layout) ─────────────────────────┐
│  build multimodal message: [ {text: prompt+catalog+context}, {image_url} ]  │
│        │                                                                    │
│        ▼   OpenRouter → claude-sonnet-4-6 (vision)                          │
│  response JSON: { explanation, suggested_params?, layout? }                 │
└────────┼────────────────────────────────────────────────────────────────── ┘
         ▼
   AIChatPanel renders explanation; suggested_params → Approve/Reject → publish
```

### 3.2 Data flow — visual diagnosis

1. The engineer opens the chat panel (with "Include current view" enabled) and
   asks a question about the run.
2. The panel calls `captureView()` on the shell's main-content element, yielding
   a downscaled PNG data URL.
3. It `POST`s to `/ai/layout` with `{ prompt, screenshot, … }` (plus the
   existing `context` / `context_instructions` if the app still provides them).
4. The backend detects `screenshot` and builds a multimodal user message: a text
   block (prompt + widget catalog + any context/instructions) and an
   `image_url` block with the data URL.
5. The model reasons over the image and returns the standard JSON
   (`explanation`, and optionally `suggested_params` and/or `layout`).
6. The panel shows the explanation; any `suggested_params` render with
   Approve / Reject; approval publishes them via the existing `onApproveParams`.

### 3.3 Relationship to the existing snapshot

The screenshot is an **additional, optional** input. Apps that already provide a
structured `context` continue to work; the screenshot can be sent alone, with
context, or context can be omitted entirely. The single "Include current view"
toggle governs whether either is attached. No app is required to change to
benefit — capture is a framework capability over the shell DOM.

---

## 4. Screenshot Capture (frontend)

### 4.1 `captureView()` utility

A small, framework-owned helper (e.g. `packages/framework-core-ui/src/ai/
captureView.ts`):

```
captureView(element: HTMLElement, opts?: { maxWidth?: number }): Promise<string>
// → resolves to a "data:image/png;base64,…" string, downscaled to maxWidth
```

- Renders `element` to a canvas with an `html2canvas`-style library, then
  `toDataURL("image/png")`.
- **Downscales** to a capped width (default ~1024 px) to keep the base64 payload
  small; a full dashboard at native resolution is too large for a chat request.
- Same-origin only — the dashboard's `<canvas>` widgets (trajectory, robot
  frame as a `data:` image) and SVG/DOM (charts, tables, banners) are all
  same-origin, so the canvas is not tainted and `toDataURL` succeeds.

### 4.2 What gets captured

The shell's **main content region** (charts, tables, status banners, trajectory
/ robot views) — not the chat panel itself, and not browser chrome. The captured
element is provided by `ApplicationShell` (which owns the layout) via a ref
passed to `AIChatPanel`.

### 4.3 Failure handling

- If capture throws (library error, detached node), the request is sent
  **without** the screenshot and falls back to the text `context`; the message
  notes that the view could not be captured.
- If the encoded image exceeds a size budget, `captureView` lowers `maxWidth`
  (or switches to JPEG at reduced quality) before returning.

---

## 5. Extended `POST /ai/layout` Endpoint

### 5.1 Why extend, not add an endpoint

The endpoint already accepts `context` / `context_instructions` and already
returns diagnosis-only responses (validating `layout` only when present). Adding
one optional `screenshot` field keeps a single conversation that can answer,
diagnose, suggest params, and change layout — mirroring the choice made for the
Reachy example (§7 of that spec). **Noted trade-off:** the name `/ai/layout` is
now broader than "layout"; renaming is deferred to avoid churn and a breaking
change for existing callers.

### 5.2 Extended request / response

- `LayoutRequest` gains `screenshot: str | None = None` — a
  `data:image/png;base64,…` URL, or `None`.
- `LayoutResponse` is **unchanged**: `layout`, `explanation`,
  `suggested_params`.

### 5.3 Multimodal message construction

When `screenshot` is present, the user message `content` becomes a list rather
than a string:

```
content = [
  { "type": "text", "text": <prompt + catalog + schema + context sections> },
  { "type": "image_url", "image_url": { "url": <screenshot data URL> } },
]
```

When `screenshot` is absent, behaviour is exactly as today (string content). The
tool-call / retry loop and validation are unchanged.

### 5.4 System-prompt rebalance

The prompt is revised so the model understands two co-equal jobs: (a) analyse
the attached screenshot and/or context to answer the user's question and flag
anomalies, and (b) change the layout when asked. A screenshot section is added:
_"A screenshot of the running dashboard may be attached. Use it to answer the
user's question and to flag anomalies you can see (unexpected shapes, values
crossing limits, error states). Ground your answer in the image; do not invent
values you cannot see."_ The "your ONLY job is a ShellLayout" framing is
softened accordingly; a pure diagnosis response (no `layout`) remains valid.

### 5.5 Privacy note

The screenshot is an image of the user's own dashboard, sent to the same model
provider (OpenRouter) that already receives the text `context`. No new data
leaves the system that the context path did not already permit; this is called
out in docs so operators are aware an image is transmitted.

---

## 6. Frontend AIChatPanel Integration

- The existing **"Include app context"** toggle is generalised to **"Include
  current view"**: when on, sending a message captures the screenshot (and still
  attaches `context` if the app provides it).
- The request body gains `screenshot` when a capture succeeds.
- The user's message bubble shows a **small thumbnail** of the captured image so
  the engineer can confirm what the AI was given.
- `AISnapshot` / `ApplicationShell.ai` are extended only as needed to pass the
  capturable element ref; `getSnapshot` and `onApproveParams` are unchanged.

---

## 7. Testing Strategy

- **Backend** (`framework-core` tests): a request with `screenshot` builds a
  message whose `content` is a list containing an `image_url` block (mock the
  OpenRouter call; assert the outgoing payload). A request without `screenshot`
  still sends string content. A diagnosis-only response (no `layout`) returns
  `explanation` (+ `suggested_params`) without validation error. Malformed /
  oversized screenshot handled gracefully.
- **Frontend** (Vitest): `captureView` returns a `data:image/png` URL for a
  given element (mock the html2canvas-style lib); `AIChatPanel` attaches
  `screenshot` to the request body when the toggle is on and omits it when off
  or when capture fails; the thumbnail renders.
- **Quality gate:** `ruff` / `mypy` / `pytest` + `npm run typecheck` / `lint` /
  `test:ui` / `format:check`.

---

## 8. Dependencies

- **Frontend (new):** one `html2canvas`-style DOM-to-image library (exact choice
  — `html2canvas`, `modern-screenshot`, or `dom-to-image-more` — decided at
  implementation, judged on canvas/SVG fidelity and bundle size).
- **Backend:** none new — OpenRouter already carries multimodal messages and the
  default Claude model is vision-capable.

---

## 9. Implementation Checklist

```
- [ ] Task 1: captureView() util in framework-core-ui (+ downscale + failure path)
- [ ] Task 2: ApplicationShell exposes the main-content ref to AIChatPanel
- [ ] Task 3: AIChatPanel — "Include current view", capture on send, attach
      screenshot, render thumbnail
- [ ] Task 4: LayoutRequest.screenshot field; multimodal message construction in
      call_openrouter / build_layout_prompt
- [ ] Task 5: system-prompt rebalance (visual diagnosis first-class) + screenshot
      guidance section
- [ ] Task 6: backend tests (multimodal payload, diagnosis-only, fallbacks)
- [ ] Task 7: frontend tests (captureView, panel attaches/omits screenshot,
      thumbnail)
- [ ] Task 8: demo wiring on an example (Reachy; drone once merged) + README/docs
      note incl. the privacy line
- [ ] Task 9: full quality gate
```

---

## 10. Next Steps (after v1)

- Goal-directed and bulk / pattern AI parameter commands (own spec + PR).
- Optional "image + structured data" mode for exact-threshold reasoning.
- A generic, reusable capture affordance (e.g. a camera button) if more surfaces
  than the chat panel want to snapshot the view.
