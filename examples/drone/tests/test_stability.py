from __future__ import annotations

import math

import pytest
from drone_example.events import DroneStabilityEvent
from drone_example.stability import (
    SETTLING_VIOLATION_S,
    TILT_VIOLATION_DEG,
    SegmentSample,
    assess_segment,
)


def _steady(
    x: float, roll: float = 0.0, pitch: float = 0.0, n: int = 20
) -> list[SegmentSample]:
    """A segment that jumps to and holds x with the given constant tilt."""
    return [
        SegmentSample(t=float(i) * 0.1, roll_deg=roll, pitch_deg=pitch, x=x)
        for i in range(n)
    ]


def test_calm_flight_is_ok() -> None:
    result = assess_segment(0, _steady(3.0, roll=5.0), start_x=0.0, target_x=3.0)
    assert isinstance(result, DroneStabilityEvent)
    assert result.status == "ok"
    assert result.violated == []
    assert result.tilt_margin_deg > 0


def test_peak_tilt_is_max_abs_of_roll_and_pitch() -> None:
    result = assess_segment(
        0, _steady(3.0, roll=-18.0, pitch=12.0), start_x=0.0, target_x=3.0
    )
    assert result.peak_tilt_deg == pytest.approx(18.0)


def test_high_tilt_is_a_violation() -> None:
    result = assess_segment(
        0, _steady(3.0, roll=TILT_VIOLATION_DEG + 6.0), start_x=0.0, target_x=3.0
    )
    assert result.status == "violation"
    assert "tilt" in result.violated
    assert result.tilt_margin_deg < 0


def test_warning_tilt_is_a_warning_not_violation() -> None:
    result = assess_segment(0, _steady(3.0, roll=25.0), start_x=0.0, target_x=3.0)
    assert result.status == "warning"
    assert "tilt" in result.warnings
    assert result.violated == []


def test_slow_settling_is_a_violation() -> None:
    """x never gets within 5% of the target, so settling = segment length."""
    samples = [
        SegmentSample(t=float(i) * 1.0, roll_deg=0.0, pitch_deg=0.0, x=0.5)
        for i in range(int(SETTLING_VIOLATION_S) + 3)
    ]
    result = assess_segment(0, samples, start_x=0.0, target_x=10.0)
    assert result.settling_time_s > SETTLING_VIOLATION_S
    assert "settling" in result.violated
    assert result.status == "violation"


def test_fast_settling_records_the_settle_time() -> None:
    # Steps to target immediately at t=0 and holds → settles at ~0 s.
    result = assess_segment(0, _steady(4.0), start_x=0.0, target_x=4.0)
    assert result.settling_time_s == pytest.approx(0.0, abs=0.2)


def test_overshoot_beyond_target_is_measured_as_pct_of_step() -> None:
    # step is 10 m; peak x is 15 m → 50% overshoot.
    samples = (
        [SegmentSample(t=0.0, roll_deg=0.0, pitch_deg=0.0, x=0.0)]
        + [SegmentSample(t=0.5, roll_deg=0.0, pitch_deg=0.0, x=15.0)]
        + _steady(10.0)[2:]
    )
    result = assess_segment(0, samples, start_x=0.0, target_x=10.0)
    assert result.overshoot_pct == pytest.approx(50.0, abs=1.0)


def test_divergence_is_a_violation() -> None:
    samples = _steady(3.0) + [
        SegmentSample(t=5.0, roll_deg=0.0, pitch_deg=0.0, x=500.0)
    ]
    result = assess_segment(0, samples, start_x=0.0, target_x=3.0)
    assert result.status == "violation"
    assert "divergence" in result.violated


def test_non_finite_is_divergence() -> None:
    samples = _steady(3.0) + [
        SegmentSample(t=5.0, roll_deg=math.nan, pitch_deg=0.0, x=3.0)
    ]
    result = assess_segment(0, samples, start_x=0.0, target_x=3.0)
    assert "divergence" in result.violated


def test_violation_takes_precedence_over_warning() -> None:
    # Warning-level tilt but a hard settling violation → overall violation.
    samples = [
        SegmentSample(t=float(i) * 1.0, roll_deg=25.0, pitch_deg=0.0, x=0.0)
        for i in range(int(SETTLING_VIOLATION_S) + 3)
    ]
    result = assess_segment(0, samples, start_x=0.0, target_x=10.0)
    assert result.status == "violation"


def test_empty_samples_is_ok_with_zero_metrics() -> None:
    result = assess_segment(0, [], start_x=0.0, target_x=3.0)
    assert result.status == "ok"
    assert result.peak_tilt_deg == 0.0
