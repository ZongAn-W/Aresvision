"""Chronological train/validation/test split contract for training tasks."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Mapping


DEFAULT_SPLIT_RATIOS = {"train_ratio": 0.7, "validation_ratio": 0.2, "test_ratio": 0.1}
LEGACY_SPLIT_RATIOS = {"train_ratio": 0.8, "validation_ratio": 0.0, "test_ratio": 0.2}
_RATIO_KEYS = tuple(DEFAULT_SPLIT_RATIOS)
_SUM_TOLERANCE = Decimal("0.000001")


class TrainingSplitError(ValueError):
    """Raised when a split request cannot produce a valid chronological split."""


def normalize_split_ratios(
    raw: Mapping[str, Any] | None,
    *,
    legacy_default: bool = False,
) -> dict[str, float]:
    """Validate and normalize train/validation/test ratios.

    New tasks default to 70/20/10. ``legacy_default`` explicitly selects the
    historical 80/20 train/test contract for readers of old task metadata.
    Ratios are not silently scaled: callers must provide a sum of one.
    """
    source = LEGACY_SPLIT_RATIOS if legacy_default and not raw else DEFAULT_SPLIT_RATIOS
    values: dict[str, Decimal] = {}
    for key in _RATIO_KEYS:
        value = (raw or {}).get(key, source[key])
        if isinstance(value, bool):
            raise TrainingSplitError(f"{key} must be a finite number")
        try:
            parsed = Decimal(str(value))
        except (InvalidOperation, ValueError, TypeError):
            raise TrainingSplitError(f"{key} must be a finite number") from None
        if not parsed.is_finite() or parsed < 0 or (parsed == 0 and key != "validation_ratio"):
            raise TrainingSplitError(f"{key} must be finite and non-negative")
        values[key] = parsed
    if values["validation_ratio"] < 0:
        raise TrainingSplitError("validation_ratio must be non-negative")
    if abs(sum(values.values()) - Decimal("1")) > _SUM_TOLERANCE:
        raise TrainingSplitError("train_ratio, validation_ratio and test_ratio must sum to 1")
    if values["train_ratio"] <= 0 or values["test_ratio"] <= 0:
        raise TrainingSplitError("train_ratio and test_ratio must be positive")
    return {key: float(values[key]) for key in _RATIO_KEYS}


def split_sample_ranges(sample_count: int, ratios: Mapping[str, float]) -> dict[str, tuple[int, int]]:
    """Allocate contiguous half-open sample ranges using largest remainders."""
    count = int(sample_count)
    if count < 3:
        raise TrainingSplitError("at least three samples are required")
    normalized = normalize_split_ratios(ratios)
    exact = [Decimal(str(normalized[key])) * count for key in _RATIO_KEYS]
    sizes = [int(value) for value in exact]
    remainder = count - sum(sizes)
    order = sorted(range(3), key=lambda index: (exact[index] - sizes[index], -index), reverse=True)
    for index in order[:remainder]:
        sizes[index] += 1
    if sizes[0] < 1 or sizes[2] < 1 or (normalized["validation_ratio"] > 0 and sizes[1] < 1):
        raise TrainingSplitError("train and test splits must contain samples; validation may be empty")
    ranges: dict[str, tuple[int, int]] = {}
    start = 0
    for key, size in zip(_RATIO_KEYS, sizes):
        ranges[key.removesuffix("_ratio")] = (start, start + size)
        start += size
    return ranges


def split_time_boundary(sample_count: int, window: int, ratios: Mapping[str, float]) -> dict[str, int]:
    """Return raw timeline boundaries for normalization fitting.

    The returned ``train_end`` is the target-sample boundary plus ``window``;
    validation and test boundaries are target indices and remain chronological.
    """
    try:
        ranges = split_sample_ranges(sample_count, ratios)
    except TrainingSplitError:
        # Preparation and inference callers may need normalization metadata for a
        # tiny legacy dataset; full three-way validity is enforced by the runner.
        count = int(sample_count)
        if count < 1:
            raise
        normalized = normalize_split_ratios(ratios)
        train_end = max(1, min(count, int(count * normalized["train_ratio"])))
        return {
            "train_start": 0,
            "train_end": train_end + int(window),
            "validation_start": train_end,
            "validation_end": train_end,
            "test_start": train_end,
            "test_end": count,
        }
    return {
        "train_start": ranges["train"][0],
        "train_end": ranges["train"][1] + int(window),
        "validation_start": ranges["validation"][0],
        "validation_end": ranges["validation"][1],
        "test_start": ranges["test"][0],
        "test_end": ranges["test"][1],
    }


__all__ = [
    "DEFAULT_SPLIT_RATIOS",
    "LEGACY_SPLIT_RATIOS",
    "TrainingSplitError",
    "normalize_split_ratios",
    "split_sample_ranges",
    "split_time_boundary",
]
