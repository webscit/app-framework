"""Pytest configuration and shared fixtures for Reachy Mini example tests.

Adds the project root to sys.path so that ``examples.reachy_mini`` is
importable as a namespace package without installing it into the environment.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

_ROOT = Path(__file__).parent.parent.parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def make_mock_mini() -> MagicMock:
    """Return a MagicMock that behaves like a ReachyMini context manager."""
    mini = MagicMock()
    mini.__enter__ = MagicMock(return_value=mini)
    mini.__exit__ = MagicMock(return_value=False)
    mini.goto_target = MagicMock(return_value=None)
    return mini


@pytest.fixture
def reachy_modules() -> dict[str, MagicMock]:
    """Build fake ``reachy_mini`` and ``reachy_mini.utils`` sys.modules entries.

    Because ``run_choreography`` lazy-imports these names, patching them via
    ``sys.modules`` (via ``patch.dict(sys.modules, reachy_modules)`` in a test)
    is the correct approach — they never appear as attributes on the producers
    module. Returns fresh mocks on every use; access ``reachy_modules["reachy_mini"]
    .ReachyMini.return_value`` to get the mock ``ReachyMini`` instance.
    """
    mock_reachy_mini_mod = MagicMock()
    mock_reachy_mini_mod.ReachyMini = MagicMock(return_value=make_mock_mini())

    mock_utils_mod = MagicMock()
    mock_utils_mod.create_head_pose = MagicMock(return_value=MagicMock())

    return {
        "reachy_mini": mock_reachy_mini_mod,
        "reachy_mini.utils": mock_utils_mod,
    }
