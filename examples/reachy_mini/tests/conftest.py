"""Pytest configuration and shared fixtures for Reachy Mini example tests.

Adds the project root to sys.path so that ``examples.reachy_mini`` is
importable as a namespace package without installing it into the environment.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_ROOT = Path(__file__).parent.parent.parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class FakeRenderer:
    """Test double for ``RobotRenderer`` — records steps, returns fake JPEG bytes.

    Avoids the heavy ``mujoco`` / ``reachy_mini`` native dependencies in unit
    tests while letting the runner exercise its frame-publishing path.
    """

    def __init__(self) -> None:
        self.rendered_steps: list[object] = []

    async def render_step(self, step: object) -> bytes:
        """Record *step* and return minimal valid JPEG header bytes."""
        self.rendered_steps.append(step)
        return b"\xff\xd8\xff\xe0fake-jpeg"


@pytest.fixture
def fake_renderer() -> FakeRenderer:
    """Provide a fresh :class:`FakeRenderer` per test."""
    return FakeRenderer()
