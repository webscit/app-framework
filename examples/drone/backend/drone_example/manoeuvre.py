"""Manoeuvre definition — turn a small parameter set into setpoint segments.

A *manoeuvre* is an ordered list of :class:`Segment`, each a target position
held for a duration. v1 derives the list from a compact :class:`ManoeuvreParams`
(so presets are trivial and the AI/engineer tune a few numbers); a future
version replaces this with an explicit waypoint editor (spec §1.4).

The generated profile is a **square wave on the North (x) axis**: even segments
command a step out to ``setpoint_step_m``, odd segments return to the origin,
each held for ``1 / change_frequency_hz`` seconds. Repeated step responses make
settling time and overshoot well defined; at high frequency the drone cannot
settle between steps, which is what drives the Aggressive preset to FAIL.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ManoeuvreParams:
    """Compact parameter set a manoeuvre is generated from (spec §4.4)."""

    setpoint_step_m: float = 12.0
    """Magnitude of each commanded position step (metres)."""

    change_frequency_hz: float = 1.5
    """How often the setpoint changes (Hz); the hold time is its inverse."""

    num_segments: int = 6
    """How many setpoint segments the manoeuvre contains."""


@dataclass(frozen=True)
class Segment:
    """One held setpoint within a manoeuvre."""

    index: int
    """Position of this segment in the manoeuvre (0-based)."""

    target: tuple[float, float, float]
    """Commanded ``(x, y, z)`` setpoint held during this segment (metres)."""

    hold_time_s: float
    """How long this setpoint is held before the next one (seconds)."""


def build_segments(params: ManoeuvreParams) -> list[Segment]:
    """Expand ``params`` into the ordered list of setpoint segments.

    Args:
        params: The manoeuvre parameters to expand.

    Returns:
        ``params.num_segments`` segments: a square wave on x (step on even
        segments, origin on odd), y and z held at 0, each held for
        ``1 / params.change_frequency_hz`` seconds.
    """
    hold_time_s = 1.0 / params.change_frequency_hz
    return [
        Segment(
            index=i,
            target=(params.setpoint_step_m if i % 2 == 0 else 0.0, 0.0, 0.0),
            hold_time_s=hold_time_s,
        )
        for i in range(params.num_segments)
    ]


# ─── Presets ──────────────────────────────────────────────────────────────────

GENTLE_PRESET = ManoeuvreParams(
    setpoint_step_m=1.5,
    change_frequency_hz=0.5,
    num_segments=4,
)
"""Small, slow ramps (0.75 m/s) — tilt stays ~10° and each segment settles
within the window (PASS). Tuned against the real FMU controller, whose stable
tracking cliff sits near 1 m/s of setpoint rate."""

AGGRESSIVE_PRESET = ManoeuvreParams(
    setpoint_step_m=12.0,
    change_frequency_hz=1.5,
    num_segments=6,
)
"""Large, rapid ramps (18 m/s) — far past the controller's tracking limit, so
the drone loses control and diverges (FAIL). Default, so the demo opens broken."""
