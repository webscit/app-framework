"""Drone example — FastAPI application entry point.

Wires the EventBus, the ``drone/control`` consumer, and the initial state.
Each run instantiates a fresh ``Drone.fmu`` co-simulation slave via
:func:`~fmpy_model.load_fmu` (injected as the FMU factory), stepped by
:func:`~fmu_runner.run_manoeuvre`.

The app loads the **aggressive preset** so the first run the engineer triggers
opens in a visibly broken (FAIL) state — giving the AI assistant something to
diagnose. Because ``fmpy`` needs a Python 3.11–3.12 environment and a C
toolchain, see ``examples/drone/README.md`` for setup and the run command.

If the FMU cannot be built (FMPy or toolchain missing), the app still serves —
the start command reports the FMU as unavailable rather than crashing.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from dataclasses import replace

from fastapi import FastAPI
from framework_core import create_app
from framework_core.ai_layout import mount_ai_routes

from .consumers import register_consumers
from .events import DroneLogEvent, DroneStateEvent
from .fmpy_model import load_fmu, prewarm
from .manoeuvre import AGGRESSIVE_PRESET

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Register the control consumer and publish the initial idle state.

    Starts with the aggressive preset loaded so the first run exhibits stability
    violations, giving the AI assistant a concrete failure to explain.

    Args:
        app: The FastAPI application (provides ``app.state.bus``).

    Yields:
        Control to FastAPI while the app is running.
    """
    params = replace(AGGRESSIVE_PRESET)
    register_consumers(app.state.bus, params, load_fmu)

    # Build the FMU binary now (once, off the event loop) so the first run
    # doesn't freeze the app while compiling. Safe to thread: this only
    # extracts/compiles — it never touches an FMU instance.
    await asyncio.to_thread(prewarm)

    await app.state.bus.publish(
        "drone/state",
        DroneStateEvent(
            phase="idle",
            verdict="",
            message="Ready — aggressive preset loaded (send 'start' to run)",
        ),
    )
    await app.state.bus.publish(
        "drone/log",
        DroneLogEvent(
            level="info",
            message="Drone backend ready. Aggressive preset active.",
        ),
    )

    yield


app = create_app(lifespan=lifespan)
mount_ai_routes(app)
