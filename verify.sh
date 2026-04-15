#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify.sh — run from the repo root before raising the PR
# Checks: structure, Python quality + tests, TypeScript quality + tests
# ---------------------------------------------------------------------------
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✅  $1${NC}"; }
fail() { echo -e "${RED}❌  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️   $1${NC}"; }
section() { echo -e "\n${YELLOW}── $1 ──${NC}"; }

# ---------------------------------------------------------------------------
# 1. FOLDER STRUCTURE — things that must exist
# ---------------------------------------------------------------------------
section "1. Required files & folders"

REQUIRED=(
  "docs/event-bus.md"

  # framework-core Python
  "pypackages/framework-core/src/framework_core/__init__.py"
  "pypackages/framework-core/src/framework_core/bus.py"
  "pypackages/framework-core/src/framework_core/ws_bridge.py"
  "pypackages/framework-core/tests/test_event_bus.py"
  "pypackages/framework-core/tests/test_ws_bridge.py"

  # framework-core-ui TypeScript
  "packages/framework-core-ui/src/client.ts"
  "packages/framework-core-ui/src/client.test.ts"
  "packages/framework-core-ui/src/EventBusContext.tsx"
  "packages/framework-core-ui/src/useChannel.ts"
  "packages/framework-core-ui/src/useEventBusStatus.ts"
  "packages/framework-core-ui/src/usePublish.ts"
  "packages/framework-core-ui/src/index.ts"

  # examples backend
  "examples/backend/__init__.py"
  "examples/backend/producers.py"
  "examples/backend/consumers.py"
  "examples/backend/main.py"
  "examples/backend/pyproject.toml"

  # examples frontend source (not dist)
  "examples/frontend/src/main.tsx"
  "examples/frontend/src/useSimulation.ts"
  "examples/frontend/src/useSimulation.test.ts"
  "examples/frontend/package.json"
  "examples/frontend/vite.config.ts"
)

ALL_PRESENT=true
for f in "${REQUIRED[@]}"; do
  if [[ -e "$f" ]]; then
    pass "$f"
  else
    fail "MISSING: $f"
    ALL_PRESENT=false
  fi
done

# ---------------------------------------------------------------------------
# 2. FORBIDDEN — things that must NOT exist
# ---------------------------------------------------------------------------
section "2. Forbidden files & folders (must be absent)"

FORBIDDEN=(
  "example"                               # old shim folder
  "examples/__init__.py"                  # examples/ is not a Python package
  "examples/frontend/dist"               # compiled output — gitignored
  "packages/framework-core-ui/dist"      # compiled output — gitignored
  "packages/ui-shell"                    # moved to examples/frontend
)

ALL_CLEAN=true
for f in "${FORBIDDEN[@]}"; do
  if [[ -e "$f" ]]; then
    fail "SHOULD NOT EXIST: $f"
    ALL_CLEAN=false
  else
    pass "absent: $f"
  fi
done

# ---------------------------------------------------------------------------
# 3. .gitignore — verify output dirs are ignored
# ---------------------------------------------------------------------------
section "3. .gitignore coverage"

GITIGNORE_ENTRIES=(
  "examples/frontend/dist"
  "packages/framework-core-ui/dist"
  "packages/*/dist"
)

for entry in "${GITIGNORE_ENTRIES[@]}"; do
  if grep -qF "$entry" .gitignore 2>/dev/null; then
    pass ".gitignore covers: $entry"
  else
    warn ".gitignore missing entry: $entry  (add it)"
  fi
done

# ---------------------------------------------------------------------------
# 4. SPEC — quick content checks
# ---------------------------------------------------------------------------
section "4. Spec content checks (docs/event-bus.md)"

check_spec() {
  local pattern="$1"
  local label="$2"
  if grep -q "$pattern" docs/event-bus.md 2>/dev/null; then
    pass "spec: $label"
  else
    fail "spec missing: $label"
  fi
}

check_spec "time_ns.*1_000_000"            "timestamp in milliseconds"
check_spec "extends BaseEvent"             "useChannel example uses extends BaseEvent"
check_spec "fnmatch"                       "wildcard / fnmatch documented"
check_spec "lifespan"                      "lifespan pattern documented"
check_spec "path.*=.*\"/ws\""             "EventBusProvider uses path= not url="
check_spec "last message"                  "last-message replay documented"

# ---------------------------------------------------------------------------
# 5. PYTHON — format, lint, types, tests
# ---------------------------------------------------------------------------
section "5. Python quality"

echo "→ ruff format check"
uv run ruff format --check . && pass "ruff format" || fail "ruff format — run: uv run ruff format ."

echo "→ ruff lint"
uv run ruff check . && pass "ruff lint" || fail "ruff lint — run: uv run ruff check --fix ."

echo "→ mypy"
uv run mypy pypackages/framework-core/src && pass "mypy" || fail "mypy type errors"

echo "→ pytest"
uv run pytest pypackages/framework-core/tests -v && pass "pytest" || fail "pytest — check test output above"

# ---------------------------------------------------------------------------
# 6. TYPESCRIPT — format, lint, types, tests
# ---------------------------------------------------------------------------
section "6. TypeScript quality"

echo "→ prettier"
npm run format:check && pass "prettier" || fail "prettier — run: npx prettier --write ."

echo "→ eslint"
npm run lint && pass "eslint" || fail "eslint — fix errors above"

echo "→ typecheck"
npm run typecheck && pass "tsc typecheck" || fail "tsc typecheck — fix type errors above"

echo "→ vitest"
npm run test:ui && pass "vitest" || fail "vitest — check test output above"

# ---------------------------------------------------------------------------
# 7. DOCSTRINGS — spot-check key public symbols
# ---------------------------------------------------------------------------
section "7. Docstring spot-check"

check_docstring() {
  local file="$1"
  local symbol="$2"
  # Look for the symbol followed by a docstring (triple-quote within 3 lines)
  if python3 - <<EOF 2>/dev/null
import ast, sys
tree = ast.parse(open("$file").read())
for node in ast.walk(tree):
    name = getattr(node, "name", None)
    if name == "$symbol":
        if ast.get_docstring(node):
            sys.exit(0)
sys.exit(1)
EOF
  then
    pass "docstring: $file :: $symbol"
  else
    fail "MISSING docstring: $file :: $symbol"
  fi
}

check_docstring "pypackages/framework-core/src/framework_core/bus.py"    "BaseEvent"
check_docstring "pypackages/framework-core/src/framework_core/bus.py"    "EventBus"
check_docstring "pypackages/framework-core/src/framework_core/bus.py"    "subscribe"
check_docstring "pypackages/framework-core/src/framework_core/bus.py"    "unsubscribe"
check_docstring "pypackages/framework-core/src/framework_core/bus.py"    "publish"
check_docstring "pypackages/framework-core/src/framework_core/__init__.py" "create_app"
check_docstring "examples/backend/producers.py"                           "start_sine_wave_producer"
check_docstring "examples/backend/producers.py"                           "start_log_producer"
check_docstring "examples/backend/consumers.py"                           "log_consumer"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
section "Summary"
if $ALL_PRESENT && $ALL_CLEAN; then
  echo -e "${GREEN}All structure checks passed.${NC}"
else
  echo -e "${RED}Structure issues found — fix before raising PR.${NC}"
  exit 1
fi