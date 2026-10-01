"""Earth training contract: profile, strict parameters and channel canonicalisation.

Earth training deliberately does **not** reuse the legacy Mars normaliser in
``services.training_channels``. That normaliser is intentionally tolerant (it
coerces, clamps and falls back), which is correct for reading decades-old Mars
tasks but wrong for a new request: a silently clamped window would train a
different model than the user asked for.

This module is the single authority for:

* the published training profile of ``earth_merra2_daily_v2``;
* the canonical input channel order (``TO3`` first, then the four optional
  auxiliary variables in a fixed order);
* the fixed ``7 -> 3`` window/horizon pair;
* strict parameter validation with stable :class:`DatasetRequestError` codes.

It must stay dependency-light: the HTTP layer, the training service and the
training subprocess all import it, so it may not import torch, the database
engine or any NetCDF reader.
"""

from __future__ import annotations

import copy
import math
from typing import Any, Mapping, Optional

from services.dataset_identity import (
    EARTH_DATASET_ID,
    EARTH_DATASET_V2_ID,
    SERVER_IDENTITY_FIELDS,
    DatasetRequestError,
)
from services.training_split import normalize_split_ratios, TrainingSplitError

EARTH_DATASET_IDS = (EARTH_DATASET_ID, EARTH_DATASET_V2_ID)

#: Only official DLinear is opened for Earth in this stage.
EARTH_TRAINING_SCRIPT = "earth_daily.py"
EARTH_SUPPORTED_ARCHITECTURE = "dlinear"
#: Marker architecture for uploaded Earth models. The actual code comes from the
#: pinned uploaded model reference, never from this label.
EARTH_UPLOADED_ARCHITECTURE = "uploaded"
EARTH_MODEL_SOURCES = ("official", "uploaded")
EARTH_IMPLEMENTATION_ID = "aresvision_gridpoint_dlinear_v1"

#: The target is always total column ozone, always the first model input.
EARTH_TARGET_CHANNEL = "TO3"
EARTH_TARGET_UNIT = "DU"
EARTH_CHANNELS = ("TO3", "U10M", "V10M", "T2M", "SWGDN")
EARTH_OPTIONAL_CHANNELS = ("U10M", "V10M", "T2M", "SWGDN")
EARTH_CHANNEL_UNITS = {
    "TO3": "DU",
    "U10M": "m s-1",
    "V10M": "m s-1",
    "T2M": "K",
    "SWGDN": "W m-2",
}

EARTH_WINDOW = 7
EARTH_HORIZON = 3
EARTH_GRID_SHAPE = (36, 72)

EARTH_METRICS_SCHEMA = "earth_training_metrics_v1"
EARTH_ARTIFACT_SCHEMA = "aresvision_earth_forecast_checkpoint_v1"
EARTH_TRAINING_SPEC_SCHEMA = "earth_training_spec_v1"
EARTH_PROFILE_ID = "earth_daily_dlinear_v1"
EARTH_DEFAULT_SPLIT_RATIOS = {
    "train_ratio": 0.7,
    "validation_ratio": 0.2,
    "test_ratio": 0.1,
}

#: Bounds mirrored by the frontend form. Values outside these ranges are
#: rejected, never clamped.
EARTH_INTEGER_PARAMS = {
    "epochs": (1, 1000, 10),
    "batch_size": (1, 64, 8),
    "seed": (0, 2**32 - 1, 11),
    "early_stopping_patience": (0, 200, 0),
    "linear_hidden_layers": (1, 4, 2),
}
EARTH_LEARNING_RATE = (0.0, 1.0, 0.001)

#: Hyperparameter keys an Earth request may carry. Anything else is rejected so
#: a client cannot smuggle a device path, a split override, normalisation
#: statistics, a replacement target or an internal ``_`` field into the run.
EARTH_ALLOWED_PARAMETER_KEYS = frozenset({
    "training_dataset",
    "model_architecture",
    "selected_channels",
    "window",
    "horizon",
    "epochs",
    "batch_size",
    "learning_rate",
    "seed",
    "early_stopping_patience",
    "linear_hidden_layers",
    "use_sphere",
    "model_source",
    "transfer_learning",
    # Values for the uploaded model's declared parameters. They are validated
    # against the package's own schema before the task is written; the pinned
    # reference in the training spec stays authoritative.
    "custom_model_params",
    "train_ratio",
    "validation_ratio",
    "test_ratio",
})


def earth_training_profile() -> dict:
    """Return a fresh copy of the published Earth training profile."""
    return {
        "profile_id": EARTH_PROFILE_ID,
        "model_architectures": [EARTH_SUPPORTED_ARCHITECTURE, EARTH_UPLOADED_ARCHITECTURE],
        "model_sources": list(EARTH_MODEL_SOURCES),
        "target": EARTH_TARGET_CHANNEL,
        "target_unit": EARTH_TARGET_UNIT,
        "window": EARTH_WINDOW,
        "horizon": EARTH_HORIZON,
        "step_unit": "day",
        "optional_channels": list(EARTH_OPTIONAL_CHANNELS),
        "default_selected_channels": list(EARTH_OPTIONAL_CHANNELS),
        "input_units": dict(EARTH_CHANNEL_UNITS),
        "grid_shape": list(EARTH_GRID_SHAPE),
        "supported_planet": "earth",
        "supports_sphere": False,
        "supports_transfer_learning": False,
        "implementation_id": EARTH_IMPLEMENTATION_ID,
    }


def is_earth_dataset_id(dataset_id: Any) -> bool:
    """Return True only for a registered Earth dataset identity."""
    return isinstance(dataset_id, str) and dataset_id.strip().lower() in EARTH_DATASET_IDS


def canonical_channel_order(selected_channels: Any) -> list[str]:
    """Return the canonical input channel order for a selection.

    Request order never decides model channel order. ``TO3`` is always first and
    the auxiliary variables follow ``U10M, V10M, T2M, SWGDN``. Unknown, blank or
    duplicated channels raise instead of being dropped.
    """
    if selected_channels is None:
        return [EARTH_TARGET_CHANNEL] + list(EARTH_OPTIONAL_CHANNELS)
    if isinstance(selected_channels, str) or not isinstance(selected_channels, (list, tuple, set)):
        raise DatasetRequestError(
            "invalid_earth_training_parameters",
            "selected_channels must be a list of auxiliary channel names",
            status_code=422,
        )
    requested: set[str] = set()
    target_seen = False
    for item in selected_channels:
        if not isinstance(item, str):
            raise DatasetRequestError(
                "invalid_earth_training_parameters",
                "selected_channels must contain channel names",
                status_code=422,
            )
        name = item.strip().upper()
        if name == EARTH_TARGET_CHANNEL:
            # TO3 is mandatory and always present; naming it explicitly is
            # accepted but never changes the model input order. Naming it twice
            # is still a duplicated channel.
            if target_seen:
                raise DatasetRequestError(
                    "invalid_earth_training_parameters",
                    f"Duplicate Earth input channel: {item}",
                    status_code=422,
                )
            target_seen = True
            continue
        if name == "" or name not in EARTH_OPTIONAL_CHANNELS:
            raise DatasetRequestError(
                "invalid_earth_training_parameters",
                f"Unsupported Earth input channel: {item}",
                status_code=422,
            )
        if name in requested:
            raise DatasetRequestError(
                "invalid_earth_training_parameters",
                f"Duplicate Earth input channel: {item}",
                status_code=422,
            )
        requested.add(name)
    return [EARTH_TARGET_CHANNEL] + [
        name for name in EARTH_OPTIONAL_CHANNELS if name in requested
    ]


def input_units_for(input_channel_order: list[str]) -> list[str]:
    """Return the physical unit of each channel in model input order."""
    return [EARTH_CHANNEL_UNITS[name] for name in input_channel_order]


def _strict_int(key: str, value: Any, minimum: int, maximum: int, default: int) -> int:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int):
        raise DatasetRequestError(
            "invalid_earth_training_parameters",
            f"{key} must be an integer",
            status_code=422,
        )
    if value < minimum or value > maximum:
        raise DatasetRequestError(
            "invalid_earth_training_parameters",
            f"{key} must be between {minimum} and {maximum}",
            status_code=422,
        )
    return value


def _strict_float(key: str, value: Any, minimum: float, maximum: float, default: float) -> float:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise DatasetRequestError(
            "invalid_earth_training_parameters",
            f"{key} must be a number",
            status_code=422,
        )
    parsed = float(value)
    if not math.isfinite(parsed):
        raise DatasetRequestError(
            "invalid_earth_training_parameters",
            f"{key} must be a finite number",
            status_code=422,
        )
    if parsed <= minimum or parsed > maximum:
        raise DatasetRequestError(
            "invalid_earth_training_parameters",
            f"{key} must be greater than {minimum} and at most {maximum}",
            status_code=422,
        )
    return parsed


def normalize_earth_training_hyperparameters(hyperparameters: Optional[Mapping[str, Any]]) -> dict:
    """Validate and canonicalise Earth training hyperparameters.

    Returns a new dictionary containing only the documented keys, with the
    canonical channel order and the fixed 7/3 window. Unknown keys, internal
    ``_`` fields and wrong types are rejected; nothing is silently coerced.
    """
    hypers = dict(hyperparameters or {})
    # Dataset identity is always server generated. A client that tries to set it
    # gets the established identity error, not a generic parameter error.
    identity = sorted(SERVER_IDENTITY_FIELDS.intersection(hypers))
    if identity:
        raise DatasetRequestError(
            "client_identity_not_allowed",
            f"Dataset identity is generated by the server: {identity[0]}",
        )
    unknown = sorted(set(hypers) - EARTH_ALLOWED_PARAMETER_KEYS)
    if unknown:
        raise DatasetRequestError(
            "invalid_earth_training_parameters",
            f"Unsupported Earth training parameter: {unknown[0]}",
            status_code=422,
        )

    dataset_id = hypers.get("training_dataset")
    if dataset_id is not None:
        if not is_earth_dataset_id(dataset_id):
            raise DatasetRequestError(
                "invalid_earth_training_parameters",
                "training_dataset must be a registered Earth dataset",
                status_code=422,
            )
        dataset_id = str(dataset_id).strip().lower()

    architecture = hypers.get("model_architecture")
    if architecture is not None:
        if not isinstance(architecture, str) or architecture.strip().lower() not in (
            EARTH_SUPPORTED_ARCHITECTURE,
            EARTH_UPLOADED_ARCHITECTURE,
        ):
            raise DatasetRequestError(
                "dataset_training_configuration_not_supported",
                "Earth training supports the official DLinear and uploaded models only",
                status_code=409,
            )

    model_source = hypers.get("model_source")
    if model_source is not None:
        if not isinstance(model_source, str) or model_source.strip().lower() not in EARTH_MODEL_SOURCES:
            raise DatasetRequestError(
                "dataset_training_configuration_not_supported",
                "Earth model_source must be 'official' or 'uploaded'",
                status_code=409,
            )

    if _is_truthy(hypers.get("use_sphere")):
        raise DatasetRequestError(
            "dataset_training_configuration_not_supported",
            "SPHERE models are not available for Earth",
            status_code=409,
        )
    if _is_truthy(hypers.get("transfer_learning")):
        raise DatasetRequestError(
            "dataset_training_configuration_not_supported",
            "Transfer learning is not available for Earth",
            status_code=409,
        )

    for key, expected in (("window", EARTH_WINDOW), ("horizon", EARTH_HORIZON)):
        value = hypers.get(key)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, int) or value != expected:
            raise DatasetRequestError(
                "invalid_earth_training_parameters",
                f"Earth training fixes {key}={expected}",
                status_code=422,
            )

    normalized: dict[str, Any] = {}
    try:
        normalized.update(normalize_split_ratios(hypers))
    except TrainingSplitError as error:
        raise DatasetRequestError(
            "invalid_earth_training_parameters",
            str(error),
            status_code=422,
        ) from error
    for key, (minimum, maximum, default) in EARTH_INTEGER_PARAMS.items():
        normalized[key] = _strict_int(key, hypers.get(key), minimum, maximum, default)
    normalized["learning_rate"] = _strict_float(
        "learning_rate",
        hypers.get("learning_rate"),
        EARTH_LEARNING_RATE[0],
        EARTH_LEARNING_RATE[1],
        EARTH_LEARNING_RATE[2],
    )
    model_source_value = str(hypers.get("model_source") or "official").strip().lower()
    normalized["window"] = EARTH_WINDOW
    normalized["horizon"] = EARTH_HORIZON
    # The architecture label follows the model source: the official DLinear, or the
    # generic uploaded marker. Nothing here decides which code runs; that is the
    # server-side pinned model reference's job.
    normalized["model_architecture"] = (
        EARTH_UPLOADED_ARCHITECTURE
        if model_source_value == "uploaded"
        else EARTH_SUPPORTED_ARCHITECTURE
    )
    normalized["model_source"] = model_source_value
    normalized["use_sphere"] = False
    normalized["selected_channels"] = [
        name
        for name in canonical_channel_order(hypers.get("selected_channels"))
        if name != EARTH_TARGET_CHANNEL
    ]
    # Uploaded-model parameter values are carried through as a plain mapping; the
    # values were already checked against the package's own schema, and the pinned
    # reference decides what the runner actually builds.
    custom_params = hypers.get("custom_model_params")
    if custom_params is not None:
        if not isinstance(custom_params, dict):
            raise DatasetRequestError(
                "invalid_earth_training_parameters",
                "custom_model_params must be an object",
                status_code=422,
            )
        normalized["custom_model_params"] = dict(custom_params)
    if dataset_id is not None:
        normalized["training_dataset"] = dataset_id
    return normalized


def _is_truthy(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return False


def require_earth_training_configuration(
    *,
    model_source: Any,
    uploaded_model_id: Any,
    hyperparameters: Optional[Mapping[str, Any]],
) -> dict:
    """Reject unsupported Earth configurations, then validate the parameters.

    Both model sources are supported. The uploaded source requires an uploaded
    model id; the official source must not carry one. The heavy compatibility work
    (ownership, version, parameter schema, Earth tensor contract) belongs to the
    training service, which owns the database session.
    """
    normalized_source = str(model_source or "").strip().lower() or "official"
    if normalized_source not in EARTH_MODEL_SOURCES:
        raise DatasetRequestError(
            "dataset_training_configuration_not_supported",
            "Earth model_source must be 'official' or 'uploaded'",
            status_code=409,
        )
    has_uploaded_id = uploaded_model_id not in (None, "", 0)
    if normalized_source == "uploaded" and not has_uploaded_id:
        raise DatasetRequestError(
            "invalid_earth_training_parameters",
            "uploaded_model_id is required when model_source is 'uploaded'",
            status_code=422,
        )
    if normalized_source == "official" and has_uploaded_id:
        raise DatasetRequestError(
            "invalid_earth_training_parameters",
            "uploaded_model_id must be empty when model_source is 'official'",
            status_code=422,
        )
    hypers = dict(hyperparameters or {})
    if hypers.get("transfer_learning") not in (None, False, 0, "false", "False", ""):
        raise DatasetRequestError(
            "dataset_training_configuration_not_supported",
            "Transfer learning is not available for Earth",
            status_code=409,
        )
    normalized = normalize_earth_training_hyperparameters(hypers)
    # The caller (HTTP layer or uploaded-model flow) is authoritative about the
    # source, so apply it explicitly rather than trusting a request field.
    normalized["model_source"] = normalized_source
    normalized["model_architecture"] = (
        EARTH_UPLOADED_ARCHITECTURE
        if normalized_source == "uploaded"
        else EARTH_SUPPORTED_ARCHITECTURE
    )
    return normalized


#: Keys the server owns inside the internal spec's uploaded-model block. A client
#: must never be able to set a storage path, source text or content hash.
SERVER_UPLOADED_REFERENCE_FIELDS = frozenset({
    "package_id",
    "display_name",
    "version",
    "content_hash",
    "source_path",
    "source_text",
    "source_available",
    "param_schema",
    "custom_model_params",
})


def build_earth_training_spec(
    *,
    task_id: int,
    dataset_binding: Mapping[str, Any],
    hyperparameters: Mapping[str, Any],
    uploaded_model: Optional[Mapping[str, Any]] = None,
) -> dict:
    """Build the internal subprocess spec for one Earth training run.

    The spec is passed through the environment rather than the command line so
    identity fields and the long snapshot never become CLI arguments. When the run
    uses an uploaded model, its pinned reference (including the verified source
    text) travels in the same server-side channel.
    """
    normalized = normalize_earth_training_hyperparameters(hyperparameters)
    if uploaded_model is not None:
        # A pinned uploaded reference *is* the model source, whatever a caller
        # passed in the parameter dict; trusting the parameter alone would let the
        # runner build the official DLinear and then fail to load uploaded weights.
        normalized["model_source"] = "uploaded"
        normalized["model_architecture"] = EARTH_UPLOADED_ARCHITECTURE
    spec: dict[str, Any] = {
        "schema": EARTH_TRAINING_SPEC_SCHEMA,
        "task_id": int(task_id),
        "dataset_binding": {
            "dataset_id": dataset_binding.get("dataset_id"),
            "dataset_version": dataset_binding.get("dataset_version"),
            "dataset_fingerprint": dataset_binding.get("dataset_fingerprint"),
            "dataset_identity_status": dataset_binding.get("dataset_identity_status"),
            # Deep copied: the child process owns its spec, and a later mutation
            # of either side must never leak into the other.
            "dataset_snapshot": copy.deepcopy(dataset_binding.get("dataset_snapshot")),
        },
        "hyperparameters": normalized,
    }
    if uploaded_model is not None:
        spec["uploaded_model"] = {
            key: copy.deepcopy(value)
            for key, value in dict(uploaded_model).items()
            if key in SERVER_UPLOADED_REFERENCE_FIELDS
        }
    return spec


def split_window_counts(
    split_days: Mapping[str, int],
    *,
    window: int = EARTH_WINDOW,
    horizon: int = EARTH_HORIZON,
) -> dict:
    """Return the sample count per split for a fixed window/horizon pair."""
    counts = {}
    for name, days in split_days.items():
        available = int(days) - int(window) - int(horizon) + 1
        if available < 1:
            raise DatasetRequestError(
                "invalid_earth_training_parameters",
                f"Split {name} has too few days for window={window} horizon={horizon}",
                status_code=422,
            )
        counts[name] = available
    return counts


__all__ = [
    "EARTH_ALLOWED_PARAMETER_KEYS",
    "EARTH_ARTIFACT_SCHEMA",
    "EARTH_CHANNELS",
    "EARTH_CHANNEL_UNITS",
    "EARTH_GRID_SHAPE",
    "EARTH_HORIZON",
    "EARTH_IMPLEMENTATION_ID",
    "EARTH_METRICS_SCHEMA",
    "EARTH_OPTIONAL_CHANNELS",
    "EARTH_PROFILE_ID",
    "EARTH_SUPPORTED_ARCHITECTURE",
    "EARTH_TARGET_CHANNEL",
    "EARTH_TARGET_UNIT",
    "EARTH_TRAINING_SCRIPT",
    "EARTH_TRAINING_SPEC_SCHEMA",
    "EARTH_WINDOW",
    "build_earth_training_spec",
    "canonical_channel_order",
    "earth_training_profile",
    "input_units_for",
    "is_earth_dataset_id",
    "normalize_earth_training_hyperparameters",
    "require_earth_training_configuration",
    "split_window_counts",
]
