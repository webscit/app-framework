"""Reachy Mini example — FastAPI application entry point.

Wires the EventBus, ControlConsumer, and initial state together.

The app starts in the **aggressive preset** (broken state) so the demo
immediately has something for the engineer to diagnose with the AI.

Run with::

    uv run uvicorn examples.reachy_mini.backend.main:app --reload

The Reachy Mini MuJoCo daemon must be running first::

    # macOS M2
    mjpython -m reachy_mini.daemon.app.main --sim

    # Other platforms
    reachy-mini-daemon --sim
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from framework_core import create_app
from framework_core.ai_layout import mount_ai_routes

from .consumers import register_consumers
from .producers import (
    AGGRESSIVE_PRESET,
    ChoreographyParams,
    ReachyLogEvent,
    ReachyStateEvent,
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Register consumers and publish the initial idle state.

    The app starts with the aggressive preset loaded so the first run the
    engineer triggers will exhibit safety violations — giving the AI
    assistant something concrete to diagnose.

    Args:
        app: The FastAPI application instance (provides ``app.state.bus``).

    Yields:
        Control to FastAPI while the app is running.
    """
    params = ChoreographyParams(
        roll_amplitude_deg=AGGRESSIVE_PRESET.roll_amplitude_deg,
        z_amplitude_mm=AGGRESSIVE_PRESET.z_amplitude_mm,
        step_duration_s=AGGRESSIVE_PRESET.step_duration_s,
        antenna_amplitude=AGGRESSIVE_PRESET.antenna_amplitude,
        num_loops=AGGRESSIVE_PRESET.num_loops,
    )

    register_consumers(app.state.bus, params)

    await app.state.bus.publish(
        "reachy/state",
        ReachyStateEvent(
            phase="idle",
            verdict="",
            message="Ready — aggressive preset loaded (send 'start' to run)",
        ),
    )
    await app.state.bus.publish(
        "reachy/log",
        ReachyLogEvent(
            level="info",
            message="Reachy Mini backend ready. Aggressive preset active.",
        ),
    )

    yield
    # No background tasks to cancel — the choreography task is owned by
    # ControlConsumer and cleaned up on stop/reset commands.


app = create_app(lifespan=lifespan)
mount_ai_routes(app)
