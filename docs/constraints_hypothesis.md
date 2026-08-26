# Constraints & Hypotheses

## Introduction

This document defines the constraints, hypotheses, and extension capabilities for a modular scientific simulation application framework.

The goals of this framework are:
- A unified frontend and backend extension system
- A declarative plugin manifest (no raw code needed to register capabilities)
- AI-assisted UI generation
- AI-assisted scientific analysis
- Support for multiple simulation engines

## 1. Target Users

Three types of users this framework serves:

**Simulation Engineer** --- builds simulation systems (CoSApp,
OpenMDAO, Genesis, or other engines) to perform analysis to address
technical queries; e.g. what would be the fuel consumption of a new engine
for that hypothetical airplane, is the drone still stable on reference missions
with the weight of that drone part increased by 100 grams. Needs to create
simulation scenarios, execute them and post-process their results to answer
the query. Should be able to create a working dashboard in 3 lines of Python, 
from a text prompt or from a no-code editor.

**Extension Developer** --- adds new widget types, simulation
connectors, or data viewers. Needs a clean, well-documented API. Must
not need to touch framework core code. The barrier to writing a first
working extension should be under one hour for a Python developer.

**Dashboard End User** --- uses sliders, charts, and 3D views in a
browser. Zero coding required. Should be able to interact with
simulation results through visual controls and through natural language
prompts to the AI layer.

## 2. Hard Constraints

These are non-negotiable boundaries the framework must respect.
Violating any of these means the framework cannot serve its target use
case.

### 2.1 Language & Runtime

-   **Backend must be Python.** The simulation engineer\'s code is
    Python. The framework must be natively Python on the backend --- no
    Node.js or JVM backend. This rules out using Theia or VS Code as a
    base.
-   **Frontend must use web-standard technologies** (HTML, CSS,
    JavaScript/TypeScript). No proprietary frontend framework that
    cannot run outside its host application --- this rules out OWL
    (Odoo) and Lumino (JupyterLab) as mandatory dependencies.
-   **No mandatory Jupyter ecosystem dependency.** The framework must
    work without JupyterLab or JupyterHub installed. Jupyter Server may
    be used as an *optional* backend if convenient, but the framework
    cannot require it. End users in production will not have Jupyter.

### 2.2 Deployment

-   **Must be deployable as a standalone web application** --- a
    simulation engineer runs a command and gets a URL their team can
    open in a browser. No notebook server required.
-   **Must be installable via pip** (and optionally conda). No complex
    build steps for end users or extension developers. A single pip
    install myextension must be sufficient to install both the Python
    backend and the JavaScript frontend of an extension.
-   **Deployment must be cloud-agnostic.** Must not be tied to
    JupyterHub, Binder, or any specific hosting platform.

### 2.3 Simulation Engine

-   **Must support multiple simulation engines**, not just CoSApp. The
    simulation connector layer must be an abstract, replaceable
    interface. CoSApp is the first reference implementation, not the
    only one. Other connectors (OpenMDAO, Genesis, custom in-house
    tools, remote simulation servers) must be installable as extensions
    without modifying the framework core.

### 2.4 Extension System

-   **Extensions must not break the core application if they fail to
    load.** A broken extension must be isolated --- it cannot crash the
    server or make other extensions unavailable.
-   **Multiple extensions must coexist without conflicts.** Extensions
    cannot override each other\'s registered IDs, widget types, or
    connector names.
-   **Extensions must not require rebuilding the application.**
    Installing an extension via pip must be sufficient --- no compile
    step, no application rebuild (this rules out Theia\'s compile-time
    extension model as the primary mechanism).
-   **Extension code must run in an isolated context.** Extensions
    cannot directly access framework internals beyond the defined API
    surface. Long-running extension operations must not block the main
    UI thread.

## 3. Design Hypotheses

These are strong design bets that we believe are correct but that will
be validated through implementation. They can be revised if evidence
contradicts them.

### 3.1 Architecture Hypotheses

**H1 --- Python asyncio backend.** The backend must be async-first to
handle long-running simulations without blocking. A modern ASGI
framework (Connexion, FastAPI, or Starlette) is preferred over Tornado,
which is increasingly seen as legacy in the Python ecosystem.

**H2 --- Event bus as the simulation data bus.** Simulation engines
publish step results as named events. Dashboard widgets subscribe to
specific event channels. Producers and consumers are fully decoupled ---
no direct imports between extensions. This pattern (proven in Home
Assistant) is the right model for our simulation data flow.

**H3 --- Replaceable simulation connector layer.** The connector between
the framework and a simulation engine is a Python class implementing a
defined interface (start, pause, get_state, stop). Extensions register
new connector implementations. The framework core never imports a
specific simulation library.

**H4 --- JSON-serializable layout templates.** Widget layout (positions,
sizes, widget types, data bindings) is stored as JSON. Layouts can be
saved, loaded, shared, and generated by AI. Both manually created and
AI-generated layouts use the same JSON format.

### 3.2 Extension System Hypotheses

**H5 --- Declarative plugin manifest.** Every extension declares its
contributions in a manifest file (inspired by VS Code\'s package.json
contributes block and Odoo\'s \_\_manifest\_\_.py). The manifest lists
widget types, simulation connectors, data viewers, and AI handlers the
extension provides --- without requiring the framework to execute
extension code to discover capabilities. This keeps extension discovery
fast and safe.

**H6 --- Single pip install for full extension deployment.** An
extension is one Python package that ships both Python backend code and
prebuilt JavaScript frontend assets (following JupyterLab 3.0+ packaging
model). No separate npm install or build step is required by the end
user.

**H7 --- Typed contribution interfaces.** The framework defines typed
Python interfaces for each extension point (widget, connector, viewer,
AI handler). Extensions implement these interfaces. This is inspired by
Theia\'s contribution point system but implemented in Python --- not
TypeScript DI.

**H8 --- No frontend TypeScript required for simple extensions.** A
simulation engineer writing a custom widget should be able to do so
without learning TypeScript. The framework should provide a Python-first
widget authoring path for common cases (e.g. using a high-level widget
description that compiles to a Web Component). TypeScript is available
for extension developers who need full control, but it must not be
mandatory.

### 3.3 User Experience Hypotheses

**H9 --- Simulation engineer connects a system in ≤3 lines of Python.**

from myframework import App

app = App(system=my_cosapp_system)

app.serve()

The framework auto-discovers the system\'s inputs and outputs and
generates a default dashboard. The engineer can then customize from
there.

**H10 --- Dashboard creation is possible without writing layout code.**
The engineer interacts with a drag-and-drop layout editor to place,
resize, and configure widgets. Writing Python or JavaScript should not
be required for dashboard layout.

**H11 --- Text prompt generates a valid dashboard layout.** A simulation
engineer or end user can describe what they want (\"show temperature
across all components with a parameter sweep for engine thrust\") and
the AI layer generates a widget layout in the framework\'s JSON format.
The generated layout is validated before being presented to the user.

### 3.4 AI Layer Hypotheses

**H12 --- AI-generated UI uses a change-set model.** The AI proposes a
layout change. The user reviews and approves or rejects it before it is
applied --- inspired by Theia AI\'s change set mechanism and VS Code\'s
prepareInvocation confirmation pattern. AI never modifies the dashboard
without user review.

**H13 --- AI receives simulation-domain context.** The AI is not
prompted with generic instructions. It receives structured context about
the current simulation system: available inputs, outputs, data types,
units, and current state. This context is provided by the simulation
connector, not hardcoded. Extensions can register domain-specific
context providers.

**H14 --- AI-generated layouts are first-class.** A layout generated by
the AI can be saved, loaded, shared, and edited exactly like a manually
created layout. There is no second-class status for AI-generated
content.

**H15 --- AI can manipulate simulation parameters on behalf of the
user.** An end user can describe a simulation objective in natural
language (\"find the thrust setting that minimizes fuel consumption\").
The AI translates this into simulation parameter adjustments using a
tool-calling pattern (inspired by VS Code\'s Language Model Tool API and
Theia AI\'s tool function mechanism). The user confirms parameter
changes before execution.

## 4. Open Questions

These are known unknowns that will need resolution during the design and
implementation phase.

**Q1 --- Frontend framework choice.** What is the right frontend
technology for the widget layer? Options: plain Web Components (most
portable, highest authoring burden), React (large ecosystem, JSX
required), or a lightweight framework like Lit (Web Component-based,
simpler than React). The choice determines what extension developers
must learn. *Hypothesis: Web Components as the registration mechanism,
with the framework optionally providing React or Lit helpers for common
widget patterns.*

**Q2 --- Python-to-JavaScript communication protocol.** How does
simulation state flow from Python to browser widgets in real time?
Options: WebSocket (used by Jupyter/ipywidgets), Server-Sent Events
(simpler, one-directional), or REST polling (simplest, highest latency).
*Hypothesis: WebSocket, following the ipywidgets comm protocol model,
which is proven for scientific data at high update rates.*

**Q3 --- Extension sandboxing depth.** How strictly should extension
code be sandboxed? Full iframe/Web Worker isolation adds complexity and
performance cost. A defined Python API surface (like VS Code\'s
Extension Host) is lighter but requires discipline. *Hypothesis: Start
with API surface restriction (extensions only call framework APIs, not
internals), move to Worker isolation only for frontend widgets with
performance risk.*

**Q4 --- Simulation engine target for first prototype.** Genesis
(robotics) or CoSApp (aerospace)? This determines the first simulation
connector implementation and shapes the data bus event schema. *Status:
pending response from Genesis team; CoSApp is confirmed backup.*

**Q5 --- AI model access pattern.** Does the framework call an LLM
directly (requiring an API key from the engineer), or does it expose a
model-agnostic interface that the engineer wires to their preferred LLM?
*Hypothesis: Model-agnostic interface --- the framework defines the
tool-calling contract, the engineer plugs in any OpenAI-compatible
endpoint.*

## 5. Constraints Explicitly Ruled Out

These are things the framework will NOT attempt, to keep scope clear.

-   **Not an IDE.** The framework is not a code editor. Engineers write
    simulation code in their existing Python IDE. The framework only
    serves the dashboard runtime.
-   **Not a notebook.** The framework does not embed a Jupyter notebook
    or cell-based interface. This is a deliberate departure from the
    CoSApp Lab model.
-   **Not a general-purpose BI tool.** The framework is specifically for
    scientific simulation dashboards. It is not Grafana or Retool.
    Features that are useful for business dashboards but irrelevant to
    simulation (e.g. SQL query builders, CRM integrations) are out of
    scope.
-   **Not a multi-tenant SaaS platform.** The initial target is
    single-team or single-organization deployment. Multi-tenant concerns
    (per-user billing, data isolation between organizations) are
    explicitly deferred.