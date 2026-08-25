from __future__ import annotations

import pytest
from drone_example.manoeuvre import (
    AGGRESSIVE_PRESET,
    GENTLE_PRESET,
    ManoeuvreParams,
    Segment,
    build_segments,
)


def test_build_segments_count_matches_num_segments() -> None:
    params = ManoeuvreParams(
        setpoint_step_m=3.0, change_frequency_hz=0.5, num_segments=4
    )
    assert len(build_segments(params)) == 4


def test_segments_are_indexed_in_order() -> None:
    params = ManoeuvreParams(
        setpoint_step_m=3.0, change_frequency_hz=0.5, num_segments=3
    )
    assert [s.index for s in build_segments(params)] == [0, 1, 2]


def test_hold_time_is_inverse_of_frequency() -> None:
    params = ManoeuvreParams(
        setpoint_step_m=3.0, change_frequency_hz=0.25, num_segments=2
    )
    for seg in build_segments(params):
        assert seg.hold_time_s == pytest.approx(4.0)


def test_targets_alternate_a_square_wave_on_x() -> None:
    """x steps to the setpoint on even segments and back to 0 on odd ones."""
    params = ManoeuvreParams(
        setpoint_step_m=5.0, change_frequency_hz=1.0, num_segments=4
    )
    xs = [seg.target[0] for seg in build_segments(params)]
    assert xs == [5.0, 0.0, 5.0, 0.0]


def test_y_and_z_targets_are_zero() -> None:
    params = ManoeuvreParams(
        setpoint_step_m=8.0, change_frequency_hz=1.0, num_segments=3
    )
    for seg in build_segments(params):
        assert seg.target[1] == 0.0
        assert seg.target[2] == 0.0


def test_segment_is_immutable_target_length_three() -> None:
    seg = build_segments(
        ManoeuvreParams(setpoint_step_m=1.0, change_frequency_hz=1.0, num_segments=1)
    )[0]
    assert isinstance(seg, Segment)
    assert len(seg.target) == 3


def test_gentle_preset_is_slow_and_small() -> None:
    assert GENTLE_PRESET.setpoint_step_m == pytest.approx(1.5)
    assert GENTLE_PRESET.change_frequency_hz == pytest.approx(0.5)
    # Gentle setpoint rate stays under the controller's ~1 m/s stability cliff.
    rate = GENTLE_PRESET.setpoint_step_m * GENTLE_PRESET.change_frequency_hz
    assert rate < 1.0


def test_aggressive_preset_is_fast_and_large() -> None:
    assert AGGRESSIVE_PRESET.setpoint_step_m == pytest.approx(12.0)
    assert AGGRESSIVE_PRESET.change_frequency_hz == pytest.approx(1.5)
    # Aggressive holds are much shorter than gentle ones (rapid jinking).
    agg = build_segments(AGGRESSIVE_PRESET)[0].hold_time_s
    gentle = build_segments(GENTLE_PRESET)[0].hold_time_s
    assert agg < gentle
