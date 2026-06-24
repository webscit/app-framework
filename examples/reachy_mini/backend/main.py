"""Reachy Mini example — FastAPI application entry point.

Wires the EventBus, the in-process MuJoCo simulator, the ControlConsumer, and
the initial state together.

The app starts in the **aggressive preset** (broken state) so the demo
immediately has something for the engineer to diagnose with the AI.

The choreography runs against an in-process MuJoCo simulation (see
:mod:`sim`), so no separate daemon or viewer window is needed — the robot is
rendered straight into the dashboard. Because ``mujoco`` / ``reachy-mini``
require a Python 3.11 environment, see ``examples/reachy_mini/README.md`` for
setup and the exact run command.

If the simulator fails to initialise (e.g. ``mujoco`` not installed), the app
still serves and runs choreographies — just without rendered frames.
"""

from __future__ import annotations

import logging
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
    RobotRenderer,
    publish_idle_frame,
)

logger = logging.getLogger(__name__)


def _build_renderer() -> RobotRenderer | None:
    """Construct the MuJoCo simulator, or ``None`` if its deps are unavailable.

    Importing :mod:`sim` pulls in ``mujoco`` lazily, so a missing native
    dependency degrades gracefully to a frame-less (data-only) dashboard
    rather than crashing app startup.

    Returns:
        A :class:`~sim.ChoreographySimulator`, or ``None`` on import failure.
    """
    try:
        from .sim import ChoreographySimulator

        return ChoreographySimulator()
    except Exception:  # pragma: no cover - depends on native deps at runtime
        logger.exception("Simulator unavailable; running without rendered frames")
        return None


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

    renderer = _build_renderer()
    register_consumers(app.state.bus, params, renderer)

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

    # Render the robot at rest so the dashboard shows it immediately, before
    # any run — and so a safety-blocked run visibly leaves it sitting still.
    if renderer is not None:
        await publish_idle_frame(app.state.bus, renderer)

    try:
        yield
    finally:
        # The choreography task is owned by ControlConsumer (cancelled on
        # stop/reset). Always release the simulator's GL resources on shutdown,
        # even if the app errored, so the worker thread/context don't leak.
        if renderer is not None and hasattr(renderer, "aclose"):
            await renderer.aclose()


app = create_app(lifespan=lifespan)
mount_ai_routes(app)
