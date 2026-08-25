"""EventBus payload types for the drone Flight Manoeuvre Stability Validator.

These mirror the frontend ``useDrone.ts`` interfaces and are published on the
``drone/*`` channels (see the spec §5). The ``DroneStabilityEvent`` shape
deliberately matches Reachy's ``ReachySafetyEvent`` (status + ``*_margin_*``
fields) so the same ``DataTable`` row-colouring and status banner work unchanged.
"""

from __future__ import annotations

from framework_core.bus import BaseEvent


class DroneTelemetryEvent(BaseEvent):
    """One flight sample published to ``drone/telemetry`` after each sim step."""

    t: float
    """Simulation time of this sample (seconds)."""

    segment: int
    """Index of the manoeuvre segment this sample belongs to (0-based)."""

    position: list[float]
    """Body position ``[x, y, z]`` in metres."""

    attitude: list[float]
    """Body attitude ``[roll, pitch, yaw]`` in degrees."""

    velocity: list[float]
    """Body velocity ``[vx, vy, vz]`` in metres/second."""

    prop_w: list[float]
    """The four propeller angular speeds (rad/s)."""

    target: list[float]
    """Commanded setpoint ``[x, y, z]`` active at this sample (metres)."""


class DroneStabilityEvent(BaseEvent):
    """Per-segment stability assessment published to ``drone/stability``."""

    segment: int
    """Index of the assessed manoeuvre segment (0-based)."""

    peak_tilt_deg: float
    """Largest absolute tilt (max of |roll|, |pitch|) seen in the segment (deg)."""

    settling_time_s: float
    """Time to settle within ±5% of the setpoint step, or the segment length
    if it never settled (seconds)."""

    overshoot_pct: float
    """Peak overshoot beyond the target as a percentage of the step size."""

    tilt_margin_deg: float
    """Degrees to the tilt violation limit (positive = safe, negative = exceeded)."""

    settling_margin_s: float
    """Seconds to the settling violation limit (positive = safe, negative = slow)."""

    status: str
    """Overall status: ``"ok"`` | ``"warning"`` | ``"violation"``."""

    violated: list[str]
    """Metrics that crossed a violation threshold, e.g. ``["tilt", "settling"]``."""

    warnings: list[str]
    """Metrics approaching but not past their limit, e.g. ``["overshoot"]``."""


class DroneStateEvent(BaseEvent):
    """Run phase transition published to ``drone/state``."""

    phase: str
    """Current phase: ``"idle"`` | ``"running"`` | ``"warning"``
    | ``"violation"`` | ``"done"``."""

    verdict: str
    """Run verdict: ``"PASS"`` | ``"FAIL"`` | ``""`` (empty until a run ends)."""

    message: str
    """Human-readable description of the transition."""


class DroneLogEvent(BaseEvent):
    """Human-readable log line published to ``drone/log``."""

    level: str
    """Log level: ``"info"`` | ``"warning"`` | ``"error"``."""

    message: str
    """Log message text."""
