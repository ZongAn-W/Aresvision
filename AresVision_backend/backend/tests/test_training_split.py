import pytest

from services.training_split import (
    TrainingSplitError,
    normalize_split_ratios,
    split_sample_ranges,
    split_time_boundary,
)


def test_new_task_defaults_to_seven_two_one():
    assert normalize_split_ratios({}) == {
        "train_ratio": 0.7,
        "validation_ratio": 0.2,
        "test_ratio": 0.1,
    }


def test_legacy_default_is_explicit_eight_two_zero():
    assert normalize_split_ratios({}, legacy_default=True) == {
        "train_ratio": 0.8,
        "validation_ratio": 0.0,
        "test_ratio": 0.2,
    }


@pytest.mark.parametrize("raw", [
    {"train_ratio": 0.6, "validation_ratio": 0.2, "test_ratio": 0.1},
    {"train_ratio": float("nan"), "validation_ratio": 0.2, "test_ratio": 0.1},
    {"train_ratio": -0.1, "validation_ratio": 0.5, "test_ratio": 0.6},
    {"train_ratio": 1.0, "validation_ratio": 0.0, "test_ratio": 0.0},
])
def test_invalid_ratios_are_rejected(raw):
    with pytest.raises(TrainingSplitError):
        normalize_split_ratios(raw)


def test_largest_remainder_ranges_are_contiguous_and_cover_all_samples():
    ranges = split_sample_ranges(10, {"train_ratio": 0.7, "validation_ratio": 0.2, "test_ratio": 0.1})
    assert ranges == {"train": (0, 7), "validation": (7, 9), "test": (9, 10)}


def test_small_data_requires_one_sample_per_split():
    with pytest.raises(TrainingSplitError):
        split_sample_ranges(2, {"train_ratio": 0.7, "validation_ratio": 0.2, "test_ratio": 0.1})


def test_time_boundary_accounts_for_input_window():
    assert split_time_boundary(10, 3, {"train_ratio": 0.7, "validation_ratio": 0.2, "test_ratio": 0.1}) == {
        "train_start": 0,
        "train_end": 10,
        "validation_start": 7,
        "validation_end": 9,
        "test_start": 9,
        "test_end": 10,
    }
