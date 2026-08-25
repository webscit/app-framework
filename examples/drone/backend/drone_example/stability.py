"""Per-segment stability & responsiveness assessment (spec §4.3).

Pure, framework-free logic: given the telemetry samples collected during one
manoeuvre segment, compute peak tilt, settling time, and overshoot, compare them
to the limits, and return a :class:`DroneStabilityEvent`. Kept independent of
FMPy and the EventBus so it is exhaustively unit-testable with crafted samples.

The limits live here in the example (not the framework), like Reachy's safety
thresholds, and are surfaced to the AI assistant via ``AI_INSTRUCTIONS``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .events import DroneStabilityEvent

# ─── Limits ───────────────────────────────────────────────────────────────────

TILT_WARN_DEG: float = 20.0
"""Tilt warning threshold (degrees). Approaching the lift-loss region."""

TILT_VIOLATION_DEG: float = 35.0
"""Tilt violation threshold (degrees). Past ~35° lift drops sharply → flip."""

SETTLING_WARN_S: float = 3.0
"""Settling-time warning threshold (seconds). Sluggish response."""

SETTLING_VIOLATION_S: float = 6.0
"""Settling-time violation threshold (seconds). Too slow to be usable."""

OVERSHOOT_WARN_PCT: float = 20.0
"""Overshoot warning threshold (% of the setpoint step)."""

OVERSHOOT_VIOLATION_PCT: float = 50.0
"""Overshoot violation threshold (% of the setpoint step)."""

DIVERGENCE_POS_M: float = 100.0
"""Tracked-axis magnitude beyond which (or any non-finite value) the run is
considered to have lost control."""

SETTLING_TOLERANCE_FRAC: float = 0.05
"""Settle band: within ±5% of the commanded step counts as settled."""


@dataclass
class SegmentSample:
    """One telemetry sample used for a segment's stability assessment."""

    t: float
    """Sample time (seconds)."""

    roll_deg: float
    """Body roll at this sample (degrees)."""

    pitch_deg: float
    """Body pitch at this sample (degrees)."""

    x: float
    """Tracked-axis (North/x) position at this sample (metres)."""


def _finite(*values: float) -> bool:
    """True if every value is finite (not NaN/inf)."""
    return all(math.isfinite(v) for v in values)


def assess_segment(
    segment: int,
    samples: list[SegmentSample],
    start_x: float,
    target_x: float,
) -> DroneStabilityEvent:
    """Assess one manoeuvre segment against the §4.3 stability limits.

    Args:
        segment: Segment index (0-based), echoed into the event.
        samples: Telemetry samples collected during the segment, in time order.
        start_x: Tracked-axis position at the start of the segment (metres).
        target_x: Commanded tracked-axis setpoint for the segment (metres).

    Returns:
        A :class:`DroneStabilityEvent` with the computed metrics, margins,
        overall ``status``, and the lists of violated / warning metrics.
    """
    if not samples:
        return DroneStabilityEvent(
            segment=segment,
            peak_tilt_deg=0.0,
            settling_time_s=0.0,
            overshoot_pct=0.0,
            tilt_margin_deg=TILT_VIOLATION_DEG,
            settling_margin_s=SETTLING_VIOLATION_S,
            status="ok",
            violated=[],
            warnings=[],
        )

    diverged = any(
        not _finite(s.roll_deg, s.pitch_deg, s.x) or abs(s.x) > DIVERGENCE_POS_M
        for s in samples
    )

    finite = [s for s in samples if _finite(s.roll_deg, s.pitch_deg, s.x)]
    peak_tilt_deg = max(
        (max(abs(s.roll_deg), abs(s.pitch_deg)) for s in finite), default=0.0
    )

    step_mag = abs(target_x - start_x)
    t0 = samples[0].t

    settling_time_s = _settling_time(samples, target_x, step_mag, t0)
    overshoot_pct = _overshoot_pct(finite, start_x, target_x, step_mag)

    violated: list[str] = []
    warnings: list[str] = []
    _classify(
        "tilt", peak_tilt_deg, TILT_WARN_DEG, TILT_VIOLATION_DEG, violated, warnings
    )
    _classify(
        "settling",
        settling_time_s,
        SETTLING_WARN_S,
        SETTLING_VIOLATION_S,
        violated,
        warnings,
    )
    _classify(
        "overshoot",
        overshoot_pct,
        OVERSHOOT_WARN_PCT,
        OVERSHOOT_VIOLATION_PCT,
        violated,
        warnings,
    )
    if diverged:
        violated.append("divergence")

    status = "violation" if violated else "warning" if warnings else "ok"

    return DroneStabilityEvent(
        segment=segment,
        peak_tilt_deg=peak_tilt_deg,
        settling_time_s=settling_time_s,
        overshoot_pct=overshoot_pct,
        tilt_margin_deg=TILT_VIOLATION_DEG - peak_tilt_deg,
        settling_margin_s=SETTLING_VIOLATION_S - settling_time_s,
        status=status,
        violated=violated,
        warnings=warnings,
    )


def _settling_time(
    samples: list[SegmentSample], target_x: float, step_mag: float, t0: float
) -> float:
    """Seconds from segment start until x enters and stays within the settle band.

    Returns the full segment length if it never settles.
    """
    tol = SETTLING_TOLERANCE_FRAC * step_mag
    # Walk backwards to the last sample outside the band; everything after it is
    # settled, so the first settled sample is the one right after. If none are
    # outside the band, settled_from stays 0 (settled from the very start).
    settled_from = 0
    for i in range(len(samples) - 1, -1, -1):
        if not math.isfinite(samples[i].x) or abs(samples[i].x - target_x) > tol:
            settled_from = i + 1
            break
    if settled_from >= len(samples):
        return samples[-1].t - t0
    return samples[settled_from].t - t0


def _overshoot_pct(
    finite: list[SegmentSample], start_x: float, target_x: float, step_mag: float
) -> float:
    """Peak travel beyond the target (in the step direction) as % of the step."""
    if step_mag == 0.0 or not finite:
        return 0.0
    direction = math.copysign(1.0, target_x - start_x)
    beyond = max((direction * (s.x - target_x) for s in finite), default=0.0)
    return max(0.0, beyond) / step_mag * 100.0


def _classify(
    name: str,
    value: float,
    warn: float,
    violation: float,
    violated: list[str],
    warnings: list[str],
) -> None:
    """Append *name* to violated or warnings if it crosses its threshold."""
    if value >= violation:
        violated.append(name)
    elif value >= warn:
        warnings.append(name)
