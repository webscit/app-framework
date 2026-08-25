"""Drone FMU co-simulation runner — steps ``Drone.fmu`` and publishes telemetry.

Drives an FMI 2.0 co-simulation slave (the real one is FMPy's ``FMU2Slave``; a
stub with the same ``setReal`` / ``doStep`` / ``getReal`` interface is used in
tests) through a manoeuvre: for each segment it injects the setpoint, steps the
FMU at a fixed rate, reads the outputs into ``drone/telemetry``, and at the
segment boundary assesses stability into ``drone/stability``. Run state and a
human log complete the picture.

The value references below were resolved from the FMU's ``modelDescription.xml``
(spec §4.2). Attitude (`phi`) is stored in radians in the FMU and converted to
degrees here.
"""

from __future__ import annotations

import asyncio
import logging
import math
from typing import Protocol

from framework_core.bus import EventBus

from .events import (
    DroneLogEvent,
    DroneStateEvent,
    DroneTelemetryEvent,
)
from .manoeuvre import ManoeuvreParams, build_segments
from .stability import SegmentSample, assess_segment

logger = logging.getLogger(__name__)

# ─── FMU value references (resolved from modelDescription.xml, spec §4.2) ──────

VR_TARGET: list[int] = [352321536, 352321538, 352321537]
"""Setpoint inputs ``[xcoord, ycoord, zcoord]`` (metres)."""

VR_POSITION: list[int] = [33554432, 33554433, 33554434]
"""Body position ``frame_a.r_0[1..3]`` (metres)."""

VR_ATTITUDE: list[int] = [33554438, 33554439, 33554440]
"""Body attitude ``body.phi[1..3]`` (radians — converted to degrees on read)."""

VR_VELOCITY: list[int] = [33554435, 33554436, 33554437]
"""Body velocity ``v_0[1..3]`` (metres/second)."""

VR_PROP: list[int] = [33554445, 33554448, 33554451, 33554454]
"""The four propeller angular speeds ``revolute.w`` (rad/s)."""

HOVER_WARMUP_S: float = 1.5
"""Seconds to hold the origin setpoint before the manoeuvre, so the drone
settles into stable hover first. Commanding a manoeuvre before it has settled
makes the position controller diverge."""

DEFAULT_DT: float = 0.01
"""Communication step size (seconds). The FMU's controller goes numerically
unstable at coarser steps (≥ 0.02 s), so this must stay small."""

RUNAWAY_TILT_DEG: float = 90.0
"""Tilt beyond which the drone is unrecoverable — the segment aborts at once."""

RUNAWAY_POS_M: float = 100.0
"""Tracked-axis distance beyond which the run has clearly diverged — abort."""


class Fmu(Protocol):
    """The subset of FMPy's ``FMU2Slave`` co-simulation API the runner needs."""

    def setReal(self, vr: list[int], value: list[float]) -> None:  # noqa: N802
        """Set the real variables at the given value references."""
        ...

    def doStep(  # noqa: N802
        self, current_communication_point: float, communication_step_size: float
    ) -> None:
        """Advance the co-simulation by one communication step."""
        ...

    def getReal(self, vr: list[int]) -> list[float]:  # noqa: N802
        """Read the real variables at the given value references."""
        ...


async def _pace(seconds: float) -> None:
    """Sleep to pace the loop toward real time (patched out in tests)."""
    await asyncio.sleep(seconds)


def read_telemetry(
    fmu: Fmu, segment: int, t: float, target: tuple[float, float, float]
) -> DroneTelemetryEvent:
    """Read the FMU outputs into a :class:`DroneTelemetryEvent`.

    Args:
        fmu: The co-simulation slave to read from.
        segment: Current manoeuvre segment index.
        t: Current simulation time (seconds).
        target: The setpoint active at this sample (metres).

    Returns:
        A telemetry event with position (m), attitude (deg), velocity (m/s),
        propeller speeds (rad/s), and the active target.
    """
    position = list(fmu.getReal(VR_POSITION))
    attitude = [math.degrees(a) for a in fmu.getReal(VR_ATTITUDE)]
    velocity = list(fmu.getReal(VR_VELOCITY))
    prop_w = list(fmu.getReal(VR_PROP))
    return DroneTelemetryEvent(
        t=t,
        segment=segment,
        position=position,
        attitude=attitude,
        velocity=velocity,
        prop_w=prop_w,
        target=list(target),
    )


async def run_manoeuvre(
    bus: EventBus,
    params: ManoeuvreParams,
    fmu: Fmu,
    *,
    dt: float = DEFAULT_DT,
) -> None:
    """Run a full manoeuvre on the FMU, publishing to the ``drone/*`` channels.

    Steps the FMU at ``dt`` intervals across every segment, publishing a
    telemetry sample per step and a per-segment stability assessment. Publishes
    an intermediate ``violation`` / ``warning`` state when a segment crosses a
    limit and a terminal ``done`` state with the overall verdict (``FAIL`` if
    any segment violated, else ``PASS``).

    Args:
        bus: The EventBus to publish to.
        params: The manoeuvre to run.
        fmu: An initialised FMI2 co-simulation slave.
        dt: Communication step size / sample interval (seconds).
    """
    segments = build_segments(params)
    await bus.publish(
        "drone/state",
        DroneStateEvent(phase="running", verdict="", message="Manoeuvre started"),
    )
    await bus.publish(
        "drone/log",
        DroneLogEvent(
            level="info",
            message=(
                f"Starting manoeuvre — {len(segments)} segment(s), "
                f"step={params.setpoint_step_m} m @ {params.change_frequency_hz} Hz"
            ),
        ),
    )

    any_violation = False
    t = 0.0
    start_x = 0.0

    try:
        # Hover warm-up: hold the origin setpoint until the drone settles into
        # stable hover. Telemetry is published (segment −1) so the take-off is
        # visible, but no segment is assessed during it.
        fmu.setReal(VR_TARGET, [0.0, 0.0, 0.0])
        warmup_steps = int(HOVER_WARMUP_S / dt)
        for _ in range(warmup_steps):
            # Call the FMU directly (never via a thread): FMUs are not
            # thread-safe, and a threaded doStep cannot be cancelled — it would
            # race the terminate() on the next Start and crash the process.
            fmu.doStep(t, dt)
            t += dt
            await bus.publish(
                "drone/telemetry", read_telemetry(fmu, -1, t, (0.0, 0.0, 0.0))
            )
            await _pace(dt)

        for seg in segments:
            seg_samples: list[SegmentSample] = []
            seg_start_t = t
            seg_start_x = start_x

            while t - seg_start_t < seg.hold_time_s:
                # Ramp the setpoint linearly across the segment: the position
                # controller tracks a moving reference, and an instantaneous
                # step reference makes it diverge. The ramp *rate*
                # (step / hold_time = setpoint_step_m × change_frequency_hz) is
                # exactly what makes the aggressive preset unstable.
                progress = min(1.0, (t - seg_start_t + dt) / seg.hold_time_s)
                ramped_x = seg_start_x + (seg.target[0] - seg_start_x) * progress
                fmu.setReal(VR_TARGET, [ramped_x, seg.target[1], seg.target[2]])
                fmu.doStep(t, dt)
                t += dt
                tel = read_telemetry(fmu, seg.index, t, seg.target)
                await bus.publish("drone/telemetry", tel)
                seg_samples.append(
                    SegmentSample(
                        t=t,
                        roll_deg=tel.attitude[0],
                        pitch_deg=tel.attitude[1],
                        x=tel.position[0],
                    )
                )
                await _pace(dt)

                # Abort the segment the instant the drone is clearly out of
                # control, so a diverging run stops promptly instead of running
                # the tilt up to absurd values before the assessment sees it.
                if (
                    max(abs(tel.attitude[0]), abs(tel.attitude[1])) > RUNAWAY_TILT_DEG
                    or abs(tel.position[0]) > RUNAWAY_POS_M
                ):
                    break

            assessment = assess_segment(
                seg.index, seg_samples, start_x=start_x, target_x=seg.target[0]
            )
            await bus.publish("drone/stability", assessment)

            if assessment.status != "ok":
                phase = "violation" if assessment.status == "violation" else "warning"
                await bus.publish(
                    "drone/state",
                    DroneStateEvent(
                        phase=phase,
                        verdict="",
                        message=(
                            f"Segment {seg.index}: {assessment.status} "
                            f"({', '.join(assessment.violated + assessment.warnings)})"
                        ),
                    ),
                )
            if assessment.status == "violation":
                # First violation ends the run — the manoeuvre is unsafe, so
                # there is no point flying the remaining segments (mirrors the
                # Reachy validator, which refuses the move on a violation).
                any_violation = True
                break

            start_x = seg.target[0]

    except asyncio.CancelledError:
        await bus.publish(
            "drone/state",
            DroneStateEvent(phase="idle", verdict="", message="Manoeuvre stopped"),
        )
        raise

    verdict = "FAIL" if any_violation else "PASS"
    await bus.publish(
        "drone/state",
        DroneStateEvent(
            phase="done",
            verdict=verdict,
            message=f"Manoeuvre complete — {verdict}",
        ),
    )
    await bus.publish(
        "drone/log",
        DroneLogEvent(level="info", message=f"Manoeuvre complete — {verdict}"),
    )
