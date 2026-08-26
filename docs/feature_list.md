# Framework feature list

**How to Read This Document**

Each feature entry contains: a description, why it matters for our use
case, which analyzed framework provides the strongest reference, and a
priority tier. Features marked \[NEW\] were not in the previous version
.

Priority tiers: P1 = prototype must have this. P2 = needed soon after
prototype. P3 = later scope.

The AI interaction model in this framework has a dual mode : (1) Visual
drag-and-drop dashboard builder for simulation engineers who are not
developers. (2) AI code generation - the user describes what they want,
the AI generates framework-compliant code (connector, widget, layout),
the user makes small edits, and it is running. Both modes use the same
underlying JSON schema and widget registry.

⚠ *The JSON-schema-driven widget registry is the bridge between both
modes. A widget defined as a JSON schema is usable by drag-and-drop, by
AI layout generation, and by AI code generation - all three read the
same schema._

# User-Facing Features

## Simulation Connector Interface

P1  ·  Core

A pluggable Python abstract base class that wraps any simulation engine
and exposes a standard interface: start(), stop(), pause(), get_state(),
set_parameters(), save_checkpoint(), load_checkpoint(). The framework
core never imports a specific simulation library - it only talks to this
interface.

**Why it matters:** Without this, the framework is hardcoded to CoSApp.
Every other feature depends on this abstraction being in place first.
The checkpoint methods are new additions - long-running simulations that
crash lose all progress without them.

_**Reference:** Home Assistant\'s integration pattern. Checkpoint
methods drawn from ML training patterns (Keras ModelCheckpoint, PyTorch
torch.save) adapted to simulation context._

## Event Bus / Data Bus

P1  ·  Core

An async event channel where the simulation connector publishes step
results as named events, and dashboard widgets subscribe to specific
channels. Producers and consumers never import each other. Built on
Python asyncio; WebSocket transport to the browser.

**Why it matters:** This is the mechanism that lets a simulation running
on the Python backend push live data to React widgets in the browser
without any widget knowing anything about the simulation engine.

_**Reference:** Home Assistant\'s event bus - the cleanest Python-native
implementation found in the analysis. WebSocket transport reference:
FastAPI WebSocket with asyncio queues._

## WebSocket Stream Multiplexing

**P1 · Core · NEW ✦**

The single WebSocket connection between the Python backend and the
browser carries three named stream types distinguished by a stream field
on every message. Type 1 - data: structured JSON payloads published by
the simulation connector onto named event channels, consumed by
dashboard widgets. Type 2 - log: raw UTF-8 text lines from simulation
stdout/stderr, consumed exclusively by the terminal panel widget. Type 3
- control: framework-level messages - heartbeat, run status changes,
extension error notifications, load/unload events. The terminal output
feature (P1) is a consumer of the log stream on this connection - it is
not a separate WebSocket. The real-time data update feature (P2) is a
consumer of the data stream on this same connection.

**Why it matters:** The event bus, terminal output, and control
signalling all share one WebSocket connection to the browser. Without
naming the stream types explicitly and including a stream discriminator
field on every message, implementations will either open redundant
connections (one per concern, multiplying connection overhead) or mix
log text and structured JSON on the same channel, making both
unreadable. Defining the wire format now --- before any widget is built
against it - prevents a breaking change later. The control stream is
also the mechanism the isolated extension failure feature uses to report
errors to the shell without crashing the data channel.

**Reference:** Jupyter Server\'s WebSocket channel multiplexing concept
- multiple logical channels over one physical connection, simplified
from binary framing to JSON with a discriminator field. FastAPI
WebSocket with asyncio queues for the Python implementation.

## Widget Registry (JSON Schema-Driven)

P1  ·  Core

A catalog of available widget types that extensions contribute to. Each
widget type is defined as a JSON schema: name, description of what data
it consumes, parameters it exposes to the user, and the React component
that renders it. The registry is what the AI layer uses as its component
catalog - the agent can only generate layouts using widget types that
are registered.

**Why it matters:** This is the central extensibility point for the
frontend AND the bridge between the extension system and the AI layer.
Adding a new widget type automatically makes it available for AI layout
generation, AI code generation, drag-and-drop, and the template library
- all at once. JSON schema as the definition language means the same
spec is read by Python (for validation), TypeScript (for rendering), and
the LLM (for generation).

_**Reference:** A2UI\'s catalog model - constrained generation. VS
Code\'s contribution points - declarative manifest. json-schema.org as
the schema language._

## Application Shell

P1  ·  Core

The main container that holds the entire UI. Manages sections (tabs or
panels), handles widget placement, provides the layout surface.
Implements pre-defined slot regions: header, sidebar-left, main,
sidebar-right, bottom panel (terminal/log). Extensions contribute to
named slots.

**Why it matters:** This is what the user sees. Everything else is
backend infrastructure - this is the product. Slot-based contribution
means extensions add to the shell without touching shell code.

_**Reference:** CoSApp Lab\'s SysExplorer for the feel. Theia\'s
application shell areas for the slot contribution model._

## Standalone Server

P1  ·  Core

A single command that serves the dashboard as a web application on a
local or remote URL. No Jupyter, no notebook server, no special client
software. Command: sim-framework serve mysimulation.py.

**Why it matters:** CoSApp Lab\'s cosapp load command already does this
but is tied to the Jupyter ecosystem. Our version must work
independently and be deployable to any server.

_**Reference:** FastAPI ASGI server model --- lightweight, modern,
uvicorn-deployable anywhere._

## JSON Layout Persistence

P1  ·  Core

Dashboard layouts are saved and loaded as JSON files. The JSON describes
which widgets exist, where they are placed, what data channels they are
bound to, and what their configuration is. Both manually created layouts
and AI-generated layouts use the exact same JSON format. The schema is
versioned.

**Why it matters:** Without this, every dashboard is throwaway.
Engineers need to share layouts with their team and reload them between
sessions. Schema versioning means layouts do not break on framework
updates.

_**Reference:** CoSApp Lab\'s SAVE/LOAD concept, but with a proper
versioned schema instead of ad-hoc JSON._

## Built-in Widget Set

P1  ·  User

A minimal set of widgets covering the most common simulation use cases,
included in the framework core without requiring any extension:

-   ⭐⭐⭐ Chart/plot (time series, convergence), 
-   ⭐⭐⭐ Parameter controller (slider, input, dropdown), 
-   ⭐⭐⭐ Data table (tabular output), 
-   ⭐⭐ Status indicator (running/paused/converged/failed),
-   ⭐ Geometry viewer (basic 3D), 
-   ⭐⭐ Terminal/log output (live simulation stdout stream). -\> done -
    add a strong example for it; the best example is a streaming log
    from a subprocess running in the backend.
-   ⭐ Workflow editor;
    using [https://reactflow.dev](https://reactflow.dev/)

**Why it matters:** A framework with no built-in widgets is unusable on
day one. The terminal widget is added to the core set --- engineers rely
on print-based debugging and log output. Without a terminal panel in the
dashboard, the dashboard feels disconnected from the computation.

_**Reference:** CoSApp Lab\'s 8 built-in widget types pared to essential
core. Terminal widget added from Frédéric\'s explicit request._

## Terminal Output / Simulation Log Stream

**P1  ·  User  ·  NEW**  ✦ 

A live-streaming terminal panel in the application shell bottom area
that shows stdout/stderr from the running simulation process in real
time. The engineer sees print statements, warnings, convergence logs,
and Python tracebacks without switching to a separate terminal.
Implemented as a named WebSocket stream on the same channel as event bus
data.

**Why it matters:** Simulation engineers rely heavily on print-based
debugging and log output. Without this, the dashboard feels disconnected
from the actual computation. It is the cheapest form of simulation
feedback - requires no structured data contract, just a text stream on
the existing WebSocket.

_**Reference:** VS Code\'s integrated terminal panel and Debug Console
- both stream process output into a bounded UI region. The event bus
already provides the WebSocket; terminal output is another stream type
on the same channel._

## User Authentication & Session Management

**P1  ·  Core  ·  NEW**  ✦ 

Basic identity layer: login, session token, and per-user state. The auth
system is split into two independently swappable interfaces.
AuthProvider handles identity - answering who is making this request
- and returns a User object or None. Authorizer handles permissions ---
answering what this user is allowed to do - via a single method
is_authorized(request, user, action, resource) → bool where action is
one of read, write, or execute, and resource is the framework resource
name (e.g. layouts, runs, settings, connectors). Default AuthProvider
implementation: local username/password with bcrypt-hashed storage.
Default Authorizer: allow all authenticated users. Extensions replace
either interface independently - swap AuthProvider for OAuth2/SSO/LDAP
without touching authorization logic, or swap Authorizer for RBAC (P3)
without touching identity logic. All subsequent stateful features
(settings, saved layouts, run history) are scoped to the authenticated
user identity.

**Why it matters:** Without the two-interface split, authentication and
authorization get tangled into one class. When RBAC (P3) is added, it
needs to replace only the authorization half --- not the entire auth
system. The is_authorized signature with explicit action and resource
parameters is the prerequisite for role-based permissions: roles are
just a mapping of (role → allowed actions on resources), checked inside
is_authorized. Building the split now means P3 RBAC is an Authorizer
swap, not a refactor.

**Reference:** Jupyter Server\'s IdentityProvider + Authorizer
two-interface pattern. FastAPI\'s OAuth2PasswordBearer for the default
AuthProvider implementation. The is_authorized(handler, user, action,
resource) → bool signature taken directly from Jupyter Server\'s
Authorizer interface.

## Isolated Extension Failure

P1  ·  Developer

When an extension fails to load or throws a runtime error, the error is
contained. The framework logs a clear Python traceback to the server log
and to the terminal stream, shows a non-breaking placeholder widget in
the UI with a clear error message, and continues serving all other
extensions normally.

**Why it matters:** If one broken extension crashes the entire server,
no one will deploy third-party extensions. Isolation is the prerequisite
for a healthy extension ecosystem.

_**Reference:** VS Code\'s Extension Host process isolation. Home
Assistant\'s integration error handling --- broken integrations show as
unavailable, not as server crashes._

## Drag and Drop Layout Editor

P2  ·  User

A visual editor in the browser where the engineer places, resizes, and
configures widgets by dragging from a panel onto the dashboard surface.
No JSON editing required for layout creation. Widget palette shows all
registered widget types with descriptions from the registry.

**Why it matters:** Dashboard creation without writing layout code ---
the main interaction model for simulation engineers who are not frontend
developers. The widget palette is auto-generated from the registry ---
no manual maintenance.

_**Reference:** CoSApp Lab\'s section/tab drag-and-drop system.
Grafana\'s panel system for visual editor feel. React-grid-layout as the
implementation library candidate._

## StorageProvider Abstraction

**P2 · Core · NEW ✦**

A pluggable Python abstract base class that defines the standard
interface for all persistent storage operations in the framework:
get(path), save(model, path), delete(path), rename(old_path, new_path),
exists(path), list(path). The framework core never calls the filesystem
directly - it only talks to this interface. Default implementation uses
the local filesystem. Extensions can replace it with S3, a database, or
a network filesystem by implementing the interface. All stateful
features - saved layouts, run history, checkpoints, user settings - go
through this abstraction.

**Why it matters:** Without this, every stateful feature (run
versioning, checkpoint persistence, saved layouts, user settings)
implicitly assumes local filesystem storage. Migrating any of them later
to S3 or a database requires touching every feature individually. With
this abstraction in place first, all storage is swappable from a single
config line - the same pattern that makes Jupyter Server\'s
ContentsManager one of its strongest design decisions.

**Reference:** Jupyter Server\'s ContentsManager abstraction - the
7-method interface pattern adapted to our storage needs. The same
principle used in Django\'s storage backends and SQLAlchemy\'s engine
abstraction.

## Data Operation Lifecycle Hooks

**P2 · Core · NEW ✦**

A hook registry that allows extensions to register functions that run
before or after any data write operation without modifying core storage
code. Two hook types: pre_save_hook(model, path, storage) runs before a
write - use for validation, schema enforcement, content transformation,
stripping oversized intermediate outputs before checkpointing.
post_save_hook(model, path, storage) runs after a write - use for audit
logging, cache invalidation, triggering derived artifact generation
(e.g. a summary JSON alongside a full HDF5 result), committing to
version control. Multiple hooks can be registered per operation type and
execute in registration order. Hooks are declared in the plugin manifest
and registered at startup.

**Why it matters:** Without this, any logic that needs to react to a
data write must be hardcoded into the write path itself - coupling
validation, logging, and transformation directly to storage. The hook
registry decouples these concerns cleanly. Simulation-specific examples:
auto-stripping large intermediate arrays before a checkpoint saves,
auto-generating a parameter summary JSON every time a run result is
stored, enforcing that required output fields are present before a
result is committed.

**Reference:** Jupyter Server\'s pre_save_hook / post_save_hook pattern
on ContentsManager - adapted to our StorageProvider interface. The same
pattern used in Django\'s signal system and SQLAlchemy\'s event system.

## Real-Time Data Updates

P2  ·  User

While a simulation is running, widgets update live as new data arrives
from the event bus. Engineers see convergence in real time without
manually refreshing. Updates pushed from Python backend to browser via
the existing WebSocket channel. Each widget declares which event
channels it subscribes to in its JSON schema.

**Why it matters:** A simulation dashboard that only shows results after
the run finishes is much less useful than one that tracks progress live.

_**Reference:** ipywidgets\' comm protocol --- most proven
Python-to-browser real-time sync pattern in scientific Python. FastAPI
WebSocket + asyncio queues on the Python side._

## User Settings & Preferences

**P2  ·  User  ·  NEW**  ✦ 

Per-user persistent settings scoped to the authenticated user: preferred
units, default layout, color scheme, widget defaults, notification
preferences. Stored server-side in a simple key-value store. Extensions
contribute their own settings schema via the plugin manifest --- the
framework auto-generates a settings UI panel from the schema.

**Why it matters:** Without per-user settings, every session starts from
scratch. The extension settings schema (extensions declare their schema,
framework renders the UI) is what makes the system composable ---
extensions do not hardcode values, and users can configure extensions
without touching code.

_**Reference:** VS Code\'s Settings contribution point --- extensions
declare a schema in package.json, VS Code renders the settings UI
automatically. This is the direct pattern: manifest declares schema,
framework generates the panel._

## AI Layout Generation (Dual Mode)

P2  ·  User

Two complementary AI interaction modes that share the same underlying
registry and JSON schema. Mode 1 --- Visual: user types a natural
language prompt, the AI generates a valid widget layout JSON using only
registered widget types, user reviews the proposed layout diff and
approves or rejects before the dashboard updates. Mode 2 --- Code
generation: user describes what they want, the AI generates
framework-compliant Python code (connector, custom widget, or layout
JSON), user makes small edits, runs it. Both modes are constrained to
the widget registry --- the agent cannot invent widget types that do not
exist.

**Why it matters:** This is the core differentiator. The dual mode
addresses two real user personas: the simulation engineer who wants a
dashboard without coding (Mode 1) and the developer who wants to extend
the framework quickly (Mode 2). The JSON schema is the shared contract
that makes both modes consistent.

_**Reference:** Mode 1: A2UI\'s catalog-constrained generation model.
Mode 2: VS Code\'s AI code generation patterns --- user gets code, makes
small changes, it runs. Both reference: VS Code Language Model Tool API
for the tool-calling loop._

## User Review Before AI Applies Changes

P2  ·  User

The AI proposes a layout change or code change first. The user sees a
diff preview and explicitly approves or rejects before anything changes.
The AI never silently modifies the dashboard or writes files without
user confirmation. Implemented as a ToolConfirmation interface in the
framework --- not tied to VS Code\'s prepareInvocation which has
evolved.

**Why it matters:** Trust. If the AI can modify the dashboard without
the user\'s knowledge, users will not use the AI layer. This is the most
important UX constraint for the AI feature.

_**Reference:** Theia AI\'s change set mechanism. AG-UI\'s
interrupt/human-in-the-loop pattern. VS Code agent mode\'s tool
confirmation UX --- abstracted behind our own interface._

## Data Slicing / Filtered Views

**P2  ·  User  ·  NEW**  ✦ 

Widgets can display a filtered or sliced view of simulation data rather
than the full output. A chart widget can show only the last 100
timesteps, only output channels matching a filter expression, or a
cross-section of a 3D field at a given plane. Slicing is defined in the
widget\'s JSON schema configuration --- a transformation layer sits
between the event bus and each widget. Transformations: filter by name,
reduce (last N, mean, min, max), sort, limit, and cross-section (for
spatial data).

**Why it matters:** Simulation outputs are large. Displaying raw full
output in every widget is impractical for performance and for cognitive
load. The engineer needs to zoom into the relevant slice without
touching the simulation connector code.

_**Reference:** Grafana\'s query transformation layer --- between data
source and panel, transformations are applied declaratively. This is the
direct pattern: connector → slice/transform (declared in widget schema)
→ widget._

## Theme / Visual Skin System

**P2 · User · \[NEW\]**

A theming system that controls the visual appearance of the entire
dashboard. The framework ships with a light theme and a dark theme.
Users select their theme via the settings panel; it is persisted
per-user via the existing settings system. Extensions can contribute
additional themes by declaring them in their manifest - a theme
extension is a special extension type that provides only CSS custom
property overrides and no Python backend. The theme system is
implemented as a three-tier CSS variable hierarchy: semantic tokens
(what components reference, e.g. \--sf-color-surface-primary), theme
tokens (what each theme defines, mapping semantic names to actual
colors), and component usage (components only ever reference semantic
tokens, never raw color values).

**Why it matters:** Without a defined theming system, every widget
hardcodes colors, themes are impossible to add as extensions, and dark
mode requires touching every component. JupyterLab\'s approach - theme
as a distinct extension type, CSS variables as the interface contract
between theme and components - is the correct pattern. It also means the
AI-generated widget code is automatically theme-compatible, since
AI-generated components reference semantic tokens from the registry
schema rather than hardcoded values.

**Reference:** JupyterLab\'s theme extension type --- theme extensions
provide only CSS variable overrides, no code. The three-tier variable
hierarchy (semantic → theme → component) drawn from JupyterLab\'s
\@jupyterlab/default-theme and \@lumino/default-theme patterns. User
theme preference persisted via the existing User Settings system (P2).

## Widget Configuration Panel (Property Inspector)

**P2 · User · \[NEW\]**

A sidebar panel (right slot of the application shell) that shows the
configurable parameters of the currently selected widget. When an
engineer clicks a widget on the dashboard, the panel populates with that
widget\'s exposed parameters - drawn directly from the widget\'s JSON
schema - and lets the engineer edit them without opening a separate
dialog. Parameter changes apply live. The panel is empty when no widget
is selected and shows a multi-widget summary when multiple widgets are
selected. This panel is how engineers configure placed widgets in the
drag-and-drop editor without writing JSON.

**Why it matters:** The drag-and-drop layout editor (P2) covers placing
and resizing widgets, but the feature list has no mechanism for
*configuring* a placed widget\'s parameters through the UI after it is
placed. Without a property inspector panel, engineers must edit the
underlying layout JSON directly to change widget parameters --- which
defeats the purpose of the visual editor. JupyterLab\'s right sidebar
property inspector (active in notebooks) is the direct reference
pattern: click a cell, see its configurable properties in the sidebar.
The widget JSON schema is already being defined (P1 Widget Registry)
- the property inspector is the UI surface that reads and writes that
schema at runtime.

**Reference:** JupyterLab\'s property inspector sidebar panel
- @jupyterlab/property-inspector extension pattern. The widget\'s JSON
schema (already defined in P1 Widget Registry) is the data source; the
panel is the generated UI surface. Implementation: auto-generate the
panel UI from the JSON schema the same way the settings panel is
auto-generated from extension settings schemas (User Settings &
Preferences, P2).

## AI Layout Generation

P2  ·  User

See \'AI Layout Generation (Dual Mode)\' above. This entry is merged.

**Why it matters:** .

_**Reference:** ._

## Declarative Plugin Manifest

P2  ·  Core

Every extension declares its contributions in a single manifest file
(pyproject.toml \[tool.simframework\] section or a framework.json file).
Declarations cover: widget types (with JSON schema), simulation
connectors, layout templates, AI tool handlers, settings schemas, and
activation conditions. The framework reads and validates all manifests
at startup before executing any extension code - extensions are
enumerated from their manifests, not from running their Python modules.
Only after all manifests are validated does the framework proceed to
load extension code. Extensions install via pip install.

**Why it matters:** Without this, extension discovery requires running
untrusted Python code at startup --- a broken or malicious extension can
crash the framework before it finishes loading. Reading manifests first
means the framework can safely enumerate all installed extensions,
detect conflicts, and report manifest validation errors before any
extension code runs. The manifest is also the single source of truth for
what an extension contributes --- it is what the AI layer reads to know
which widget types are available for generation, what the drag-and-drop
palette shows, and what settings panels to render. All three consumers
read the same manifest.

**Reference:** VS Code\'s package.json contributes block - strongest
reference for manifest-first loading. Odoo\'s \_\_manifest\_\_.py as the
Python-native equivalent. The pre-execution safety property drawn from
Jupyter Server\'s extension discovery analysis.

## Run Versioning & Input/Result Tracking

**P2  ·  Core  ·  NEW**  ✦ 

Every simulation run is recorded with: a unique run ID, a snapshot of
all input parameters at the time of the run, the user who triggered it,
a timestamp, run duration, final status (converged/failed/stopped), and
a reference to the output data store. The engineer browses run history
in a dedicated panel, compares inputs across runs, and reloads the exact
parameter set from any previous run. A run can be re-executed with the
same inputs with one click.

**Why it matters:** Frédéric explicitly requested \'data storage
services to track version of input and the associated results.\' This is
the most-requested missing feature in scientific computing dashboards.
Without it, engineers lose reproducibility --- they cannot explain what
parameters produced a given result. It is also the prerequisite for
multi-run comparison (P3).

_**Reference:** MLflow\'s run tracking model --- each run has params,
metrics, artifacts, and a parent experiment. Adapted to simulation:
params = connector inputs at run time, metrics = scalar outputs,
artifacts = full result sets stored as HDF5 or Zarr._

## Simulation Checkpoint / State Persistence

**P2  ·  Core  ·  NEW**  ✦ 

The simulation connector interface exposes optional save_checkpoint()
and load_checkpoint() methods. When implemented by a connector, the
engineer can checkpoint the full simulation state mid-run, share the
checkpoint file, and resume or inspect from exactly that state on a
different machine. The checkpoint is linked to a run version entry so
state is always associated with its parameter history.

**Why it matters:** Long-running simulations (hours or days in HPC
contexts) that crash lose all progress. Checkpointing is standard in ML
training and HPC batch workflows but absent from all analyzed dashboard
tools. Complements run versioning --- a checkpoint is a versioned run
state, not just parameter metadata.

_**Reference:** ML training patterns (Keras ModelCheckpoint, PyTorch
torch.save) adapted to simulation. The connector interface gets the
save/load methods as optional --- connectors that do not implement them
degrade gracefully._

## Multiple Simulation Engine Support

P2  ·  Core

A second connector implementation (Genesis or OpenMDAO) that proves the
connector interface is genuinely abstract. The framework ships with a
CoSApp connector; the second connector is the first real extension and
validates the interface design.

**Why it matters:** If only one connector is ever built, the abstraction
is theoretical. Building two forces the interface to be real and reveals
any design gaps before the interface is published.

_**Reference:** Home Assistant --- thousands of device integrations all
implementing the same abstract interface._

# Developer-Facing Features (P2)


## Usage Analytics / Telemetry

P2  ·  Developer

Tracks what widgets are used, how often simulations are triggered, where
users spend time, what AI prompts are accepted vs rejected, and what
errors occur. Reported to the engineer who deployed the dashboard. Not
exposed to end users. Opt-in, privacy-respecting, local-first option
available.

**Why it matters:** Without this, the engineer who built the dashboard
has no idea whether people are actually using it. Standard in any
deployed web application. Absent from every scientific dashboard tool
analyzed --- a differentiator.

_**Reference:** Raised by Frédéric. OpenTelemetry as the instrumentation
standard --- vendor-neutral, exportable to Prometheus, Grafana, or a
local file._

## Extension Development CLI

P2  ·  Developer

A command-line tool that scaffolds a new extension project with one
command: sim-framework new-extension my_connector \--type connector.
Creates: the manifest file, the Python backend skeleton with the correct
interface, the React widget component skeleton (TypeScript + JSON
schema), a test file, and a README. Also: sim-framework
validate-manifest checks a manifest for schema compliance before
publish.

**Why it matters:** The biggest barrier to extension adoption is time to
write the first working extension. If scaffolding takes 5 minutes
instead of 2 hours, far more engineers will try it.

_**Reference:** VS Code\'s yo code scaffolding --- most
developer-friendly extension onboarding found across all analyzed
frameworks._

## Extension Hot Reload

P2  ·  Developer

When an extension developer changes their Python connector code or their
React widget component, the framework reloads the changed module without
a full server restart. Changes are visible in the browser within
seconds. File watcher monitors the extension directory; changed modules
are reloaded via Python importlib.

**Why it matters:** Home Assistant\'s 20-40 second restart requirement
per code change is identified in the developer review as the biggest
friction point in its extension development experience. Our framework
solves this from day one.

_**Reference:** JupyterLab 3.0+ hot reload as the positive reference.
Python importlib.reload() + FastAPI lifespan for the implementation
approach._

## Extension API Surface Restriction

P2  ·  Developer

Extensions can only call defined framework APIs exported from a
versioned simframework.api module. They cannot import framework
internals directly (simframework.\_internal is not a public module).
Internal refactoring does not break extensions. The API surface is
documented, typed with Python type hints, and versioned with semantic
versioning.

**Why it matters:** Without this, any internal refactoring breaks all
extensions. With it, the framework can evolve independently of its
extension ecosystem --- the same reason 60,000+ VS Code extensions do
not break on every release.

_**Reference:** VS Code\'s deliberately restricted Extension API --- the
architectural principle, adapted to Python module boundaries._

# User-Facing Features (P3)

## Data Processor

P3  ·  User

It should be possible to define data processors to be registered
dynamically on the backend that are able to transform data from the
simulation engine or another data processor to be consumed by another
data processor or a frontend widget.

**Why it matters: **Raw data from the simulation engine may not be
optimized for consumption by the frontend widgets or some
post-processing steps may be required that will run more effectively on
the backend.

## Layout Template Library

P3  ·  User

Pre-built JSON layout templates for common simulation types: aerodynamic
analysis, thermal simulation, parameter sweep, multi-output monitoring,
convergence tracking. Engineers start from a template instead of a blank
canvas. Extensions can contribute new templates via the manifest.

**Why it matters:** Reduces time from \'I have a simulation\' to \'I
have a useful dashboard\' from hours to minutes for common cases.

_**Reference:** CoSApp Lab\'s SAVE/LOAD concept --- but with a shared,
browsable template registry rather than local files._

## Multi-Run Comparison

P3  ·  User

A widget and layout mode that displays results from multiple simulation
runs side by side. Engineers compare the effect of different parameter
settings without opening separate tabs. Comparison is driven by the run
version history --- select two or more run IDs, compare their inputs and
outputs.

**Why it matters:** The most common scientific workflow after running a
simulation is comparing it to the previous run. CoSApp Lab has no
support for this. Requires run versioning (P2) to be complete first.

_**Reference:** No existing analyzed framework implements this cleanly.
Run versioning (P2) is the prerequisite and provides the data model._

## AI Parameter Manipulation

P3  ·  User

An end user describes a simulation objective in natural language. The AI
translates this into a sequence of parameter changes, calls simulation
control actions as tool calls via the tool registry, evaluates the
result via the event bus, and proposes the next step. The user confirms
each parameter change before execution via the ToolConfirmation
interface.

**Why it matters:** The most ambitious version of the AI layer --- going
beyond layout generation to actual simulation steering. Requires the
connector interface, event bus, run versioning, and AI layout generation
to all be working first.

_**Reference:** AG-UI\'s shared state model. VS Code\'s Language Model
Tool API --- the agent reads simulation state and calls actions via the
tool-calling pattern._

## Results Export

P3  ·  User

Export simulation results as CSV, structured JSON, HDF5, or a PDF report
snapshot of the current dashboard state. Available from any running
dashboard without additional configuration.

**Why it matters:** Engineers need to share results with colleagues who
do not have the dashboard running. CoSApp Lab has no export capability
today.

_**Reference:** Identified as a gap in the CoSApp Lab analysis. pandas
to_csv/to_json for tabular data; h5py for HDF5; headless Chromium
screenshot for PDF dashboard snapshot._

## Role-Based Access Control (RBAC)

**P3  ·  Core  ·  NEW**  ✦ 

Extend the auth layer (P1) with roles: viewer (read-only dashboard,
cannot trigger runs), operator (can run simulations, cannot edit
layouts), engineer (full access), admin (manage users and extensions).
Permissions are checked at the API level via FastAPI dependency
injection --- not just in the UI.

**Why it matters:** Once auth exists, the next ask from any team
deploying to multiple users is \'can I make this read-only for some
people?\' Without RBAC, auth is just a password on the front door with
no interior locks.

_**Reference:** FastAPI dependency injection for role checking. VS
Code\'s \'when\' clause context system --- capabilities gated on
context, not hardcoded per user._

## Extension Marketplace / Registry

**P3  ·  Developer  ·  NEW**  ✦

A browsable catalog (web UI + CLI) of published extensions compatible
with the framework. Engineers discover, install, and update extensions:
sim-framework search connector or sim-framework install
genesis-connector. Metadata per extension: description, compatibility
version, author, screenshots, tags. PyPI as the distribution backend;
the registry adds discoverability.

**Why it matters:** The extension ecosystem only has network effects if
discovery is easy. pip install alone is not sufficient for domain
experts who do not live in terminals. A CoSApp connector found via a
searchable registry is qualitatively different from hunting GitHub.

_**Reference:** VS Code Marketplace as the reference for
discoverability. PyPI as the distribution backend --- no need to
reinvent package hosting._

Features Explicitly Excluded

These features were considered and deliberately excluded from scope.

| Excluded Feature                               | Reason |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Code editor / IDE                              | We are not a development tool. Engineers write simulation code in their existing IDE. |
| Notebook / cell interface                      | Deliberate departure from CoSApp Lab\'s Jupyter dependency. |
| SQL query builder                              | We are a scientific simulation tool, not a BI platform. |
| Multi-tenant billing / access control          | Not in scope for the prototype. Can be added by a deployment-layer extension later. |
| Built-in LLM / AI model                        | The framework is model-agnostic. Engineers plug in their own OpenAI-compatible endpoint. |
| Real-time collaboration (multi-user editing)   | Operational complexity not justified for scientific simulation use case. Single-user dashboard is the primary target. |


Summary Table

Features marked \[NEW\] were added in this revision. Source column notes
whether the addition came from the VS Code analysis correction,
Frédéric\'s explicit requests, or identified gaps in the prior state of
the art analysis.

| Feature                                     | Priority   | Category |
| ------------------------------------------- | ---------- | ----------- |
| Simulation connector interface              | P1         | Core |
| Event bus / data bus                        | P1         | Core |
| Widget registry (JSON schema)               | P1         | Core |
| Application shell                           | P1         | Core |
| Standalone server                           | P1         | Core |
| JSON layout persistence                     | P1         | Core |
| Built-in widget set                         | P1         | User |
| Isolated extension failure                  | P1         | Developer |
| Terminal output / log stream                | P1         | User |
| User authentication & sessions              | P1         | Core |
| Drag and drop layout editor                 | P2         | User |
| Real-time data updates                      | P2         | User |
| User settings & preferences                 | P2         | User |
| AI layout generation (dual mode)            | P2         | User |
| User review before AI applies               | P2         | User |
| Data slicing / filtered views               | P2         | User |
| Declarative plugin manifest                 | P2         | Core |
| Run versioning & input/result tracking      | P2         | Core |
| Simulation checkpoint / state persistence   | P2         | Core |
| Multiple simulation engine support          | P2         | Core |
| Usage analytics / telemetry                 | P2         | Developer |
| Extension development CLI                   | P2         | Developer |
| Extension hot reload                        | P2         | Developer |
| Extension API surface restriction           | P2         | Developer |
| Layout template library                     | P3         | User |
| Multi-run comparison                        | P3         | User |
| AI parameter manipulation                   | P3         | User |
| Results export                              | P3         | User |
| Role-based access control (RBAC)            | P3         | Core |
| Extension marketplace / registry            | P3         | Developer |