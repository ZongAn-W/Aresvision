"""Earth historical prediction from a task's verified release and checkpoint.

This service is the Earth counterpart of the Mars inference path. It exists so an
Earth task can be predicted from **its own** verified release and checkpoint:
nothing here reads OpenMARS, MCD, MY/Ls, Mars channels or the Mars prediction
cache, and an Earth task is never routed through Mars data preparation.

Daily tasks retain date-only 7-to-3 windows. Three-hour tasks use a UTC interval
center, 56 inputs ending at that origin and 24 subsequent reference timestamps.
Every returned field is TO3 in DU on the task's published grid.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import json
from typing import Any, Mapping, Optional

import numpy as np
import torch

from services.dataset_identity import (
    DatasetRequestError, is_earth_training_task, EARTH_DATASET_3HOURLY_ID,
    require_active_dataset, training_task_dataset_id,
)
from services.dataset_registry import DatasetRegistry
from services.earth_dataset import (
    TARGET_CHANNEL,
    TARGET_CHANNEL_INDEX,
    normalize_cube,
    reference_ozone,
    release_date_index,
    stack_release_cube,
    validate_normalization,
    _threehour_path, _threehour_values, threehour_release_split_codes,
)
from services.earth_training_artifact import (
    EarthArtifactError,
    ErrorAccumulator,
    available_origin_range,
    build_earth_model_from_checkpoint,
    forecast_dates,
    load_earth_training_artifact,
    origin_split,
    validate_checkpoint_payload,
    threehour_available_origin_range, threehour_origin_index,
    threehour_forecast_timestamps, threehour_origin_split,
)
from services.earth_training_contract import (
    EARTH_HORIZON,
    EARTH_TARGET_UNIT,
    EARTH_WINDOW,
)
from services.earth_model_source import (
    MODEL_SOURCE_OFFICIAL,
    MODEL_SOURCE_UPLOADED,
    EarthModelBuildError,
    earth_forward_for_model,
)
from services.uploaded_model_source import (
    UploadedModelSourceError,
    verify_reference_source,
)
from services.earth_dataset_metadata import file_sha256
from services.earth_prediction_cache import EARTH_PREDICTION_CACHE, build_earth_prediction_cache_key
from services.netcdf_read_lock import netcdf_read_lock
import xarray as xr

ORIGIN_OUT_OF_RANGE = "earth_prediction_origin_out_of_range"
ORIGIN_INVALID = "invalid_earth_prediction_origin"
TASK_NOT_COMPLETED = "earth_prediction_task_not_completed"

VARIABLE_LABELS = {
    "TO3": "Total column ozone",
}


@dataclass(frozen=True)
class EarthPredictionContext:
    """Everything the prediction page needs before a run is requested."""

    task_id: int
    dataset_id: str
    dataset_version: str
    dataset_fingerprint: str
    target: str
    target_unit: str
    horizon: int
    window: int
    input_channel_order: list[str]
    input_units: list[str]
    latitude: list[float]
    longitude: list[float]
    grid_shape: list[int]
    origins: dict
    metrics: dict
    run: dict
    training_split_end: Optional[str] = field(default=None)
    #: Identity of the trained model (official DLinear or a pinned uploaded model).
    model: dict = field(default_factory=dict)
    #: Warnings raised while rebuilding the model, e.g. the uploaded file is gone.
    warnings: list[str] = field(default_factory=list)
    temporal: dict = field(default_factory=dict)


def _task_binding(task: Any) -> dict:
    binding = {
        "dataset_id": getattr(task, "dataset_id", None),
        "dataset_version": getattr(task, "dataset_version", None),
        "dataset_fingerprint": getattr(task, "dataset_fingerprint", None),
        "dataset_identity_status": getattr(task, "dataset_identity_status", None),
        "dataset_snapshot": getattr(task, "dataset_snapshot", None),
    }
    if not binding["dataset_id"] or not binding["dataset_fingerprint"]:
        # A task without a verified Earth binding cannot be predicted: there is no
        # release to recover the reference field from.
        raise DatasetRequestError(
            "invalid_earth_training_artifact",
            "This Earth task has no verified dataset binding",
            status_code=409,
        )
    if binding["dataset_id"] == EARTH_DATASET_3HOURLY_ID and (
            binding["dataset_version"] != "v1" or binding["dataset_identity_status"] != "verified"
            or not binding["dataset_snapshot"]):
        raise DatasetRequestError("invalid_earth_training_artifact",
                                  "The three-hour task has no complete verified identity", status_code=409)
    return binding


def _require_completed_earth_task(task: Any) -> None:
    if not is_earth_training_task(task):
        raise DatasetRequestError(
            "dataset_prediction_not_supported",
            "Earth historical prediction requires an Earth training task",
            status_code=409,
        )
    require_active_dataset(training_task_dataset_id(task))
    status = getattr(task, "status", None)
    if status != "completed":
        raise DatasetRequestError(
            TASK_NOT_COMPLETED,
            "The Earth training task has not completed successfully",
            status_code=409,
        )
    output_path = getattr(task, "output_model_path", None)
    if not output_path:
        raise DatasetRequestError(
            TASK_NOT_COMPLETED,
            "The Earth training task has no model artifact",
            status_code=409,
        )


def _load_checkpoint(task: Any):
    binding = _task_binding(task)
    snapshot = binding.get("dataset_snapshot")
    if isinstance(snapshot, str):
        try:
            binding["dataset_snapshot"] = json.loads(snapshot)
        except ValueError as exc:
            raise DatasetRequestError(
                "invalid_earth_training_artifact",
                "The task dataset snapshot is damaged",
                status_code=409,
            ) from exc
    try:
        expected_hypers = None
        if binding["dataset_id"] == EARTH_DATASET_3HOURLY_ID:
            expected_hypers = json.loads(getattr(task, "hyperparameters", None) or "{}")
            if not isinstance(expected_hypers, dict):
                raise EarthArtifactError("The task hyperparameters are damaged")
        checkpoint = load_earth_training_artifact(
            getattr(task, "output_model_path"),
            expected_binding=binding,
            expected_task_id=getattr(task, "id", None),
            expected_hyperparameters=expected_hypers,
        )
        if binding["dataset_id"] == EARTH_DATASET_3HOURLY_ID:
            build_earth_model_from_checkpoint(checkpoint)  # Strict state-dict shape check for context/cache hits too.
        if binding["dataset_id"] == EARTH_DATASET_3HOURLY_ID:
            expected_snapshot = binding.get("dataset_snapshot")
            actual_snapshot = checkpoint.dataset_binding["dataset_snapshot"]
            if not isinstance(expected_snapshot, dict) or any(
                    expected_snapshot.get(key) != actual_snapshot.get(key)
                    for key in ("dataset_id", "dataset_version", "dataset_fingerprint", "data_sha256",
                                "time", "grid", "splits", "frequency_hours", "step_unit", "step")):
                raise EarthArtifactError("The task snapshot does not match its checkpoint")
        return checkpoint
    except (EarthArtifactError, ValueError, TypeError, KeyError, OverflowError) as exc:
        raise DatasetRequestError(
            getattr(exc, "code", "invalid_earth_training_artifact"),
            str(exc),
            status_code=409,
        ) from exc


def _sync_release(registry: DatasetRegistry, binding: Mapping[str, Any]):
    """Return the release the task was bound to, or a stable version error."""
    try:
        release = registry.get_earth_snapshot(binding["dataset_id"])
    except DatasetRequestError as exc:
        if (binding["dataset_id"] == EARTH_DATASET_3HOURLY_ID
                and exc.code == "dataset_unavailable"
                and exc.availability_reason != "package_unreadable"):
            raise DatasetRequestError("dataset_version_changed",
                                      "The bound three-hour Earth package is no longer verifiable", status_code=409) from exc
        raise
    metadata = release.metadata
    if binding.get("dataset_fingerprint") != metadata.get("dataset_fingerprint"):
        raise DatasetRequestError(
            "dataset_version_changed",
            "The dataset release changed since this task was trained; retrain before predicting",
            status_code=409,
        )
    if binding.get("dataset_id") == EARTH_DATASET_3HOURLY_ID:
        snapshot = binding.get("dataset_snapshot") or {}
        if (metadata.get("dataset_id") != binding["dataset_id"]
                or metadata.get("dataset_version") != binding.get("dataset_version")
                or metadata.get("grid") != snapshot.get("grid")
                or metadata.get("time") != snapshot.get("time")
                or metadata.get("splits") != snapshot.get("splits")
                or any(metadata.get(key) != snapshot.get(key) for key in (
                    "schema", "data_sha256", "variables", "channel_order"))):
            raise DatasetRequestError("dataset_version_changed",
                                      "The bound Earth release metadata changed", status_code=409)
        try:
            threehour_release_split_codes(release.dates, metadata)
            threehour_available_origin_range(release)
            if (not np.array_equal(release.latitude, -89.625 + np.arange(240) * .75)
                    or not np.array_equal(release.longitude, -179.625 + np.arange(480) * .75)):
                raise ValueError("The three-hour grid coordinates changed")
            _threehour_path(release)
        except (EarthArtifactError, ValueError) as exc:
            raise DatasetRequestError("dataset_version_changed", str(exc), status_code=409) from exc
    return release


def _validate_checkpoint_split_ranges(checkpoint: Any, release: Any) -> None:
    """Reject a checkpoint whose published split contract no longer matches."""
    contract = checkpoint.training_contract
    if checkpoint.dataset_binding.get("dataset_id") == EARTH_DATASET_3HOURLY_ID:
        # The new checkpoint validator already checked complete UTC ranges/counts.
        for name in ("train", "validation", "test"):
            expected = contract["split_ranges"][name]
            current = (release.metadata.get("splits") or {})[name]
            first = np.datetime64(expected["date_start"].removesuffix("Z"), "ns")
            last = np.datetime64(expected["date_end"].removesuffix("Z"), "ns")
            if (str(first.astype("datetime64[D]")) != current["start"]
                    or str(last.astype("datetime64[D]")) != current["end"]
                    or expected["window_count"] != current["steps"] - contract['window'] - contract['horizon'] + 1):
                raise DatasetRequestError("dataset_version_changed", "The Earth release split changed", status_code=409)
        return
    if contract.get("split_policy") != "published_manifest_splits":
        # Historical Earth artifacts predate persisted manifest ranges. They
        # remain readable; newly trained artifacts always use the strict policy.
        return None
    expected = contract.get("split_ranges") or {}
    published = release.metadata.get("splits") or {}
    for name in ("train", "validation", "test"):
        actual = expected.get(name) or {}
        current = published.get(name) or {}
        if (
            str(actual.get("date_start")) != str(current.get("start"))
            or str(actual.get("date_end")) != str(current.get("end"))
        ):
            raise DatasetRequestError(
                "dataset_version_changed",
                "The Earth release split dates changed since this task was trained",
                status_code=409,
            )
        days = int(current.get("days", 0))
        expected_count = days - int(contract.get("window", EARTH_WINDOW)) - int(contract.get("horizon", EARTH_HORIZON)) + 1
        if int(actual.get("window_count", -1)) != expected_count:
            raise DatasetRequestError(
                "dataset_version_changed",
                "The Earth release split window counts changed since this task was trained",
                status_code=409,
            )
    return None


def build_prediction_context(task: Any, registry: DatasetRegistry) -> EarthPredictionContext:
    """Return the selectable origins, grid, units, model identity and metrics."""
    _require_completed_earth_task(task)
    checkpoint = _load_checkpoint(task)
    release = _sync_release(registry, checkpoint.dataset_binding)
    _validate_checkpoint_split_ranges(checkpoint, release)
    contract = checkpoint.training_contract
    origins = threehour_available_origin_range(release, window=contract['window'], horizon=contract['horizon'],
        strict_split=checkpoint.model_source == MODEL_SOURCE_UPLOADED) if checkpoint.dataset_binding["dataset_id"] == EARTH_DATASET_3HOURLY_ID else available_origin_range(
        release,
        window=int(contract.get("window", EARTH_WINDOW)),
        horizon=int(contract.get("horizon", EARTH_HORIZON)),
    )
    splits = checkpoint.metrics.get("splits") or {}
    run = checkpoint.run
    snapshot = checkpoint.dataset_binding.get("dataset_snapshot") or {}
    published_splits = snapshot.get("splits") or {}
    training_end = (published_splits.get("train") or {}).get("end")
    if checkpoint.dataset_binding["dataset_id"] == EARTH_DATASET_3HOURLY_ID:
        training_end = contract["split_ranges"]["train"]["date_end"]
    # Report the uploaded model's file state without failing the context call: the
    # page must be able to explain that the original file is gone even though the
    # checkpoint can still rebuild the model from its embedded copy.
    warnings = _model_source_warnings(checkpoint)
    return EarthPredictionContext(
        task_id=int(getattr(task, "id", 0) or 0),
        dataset_id=checkpoint.dataset_binding["dataset_id"],
        dataset_version=str(checkpoint.dataset_binding.get("dataset_version")),
        dataset_fingerprint=checkpoint.dataset_binding["dataset_fingerprint"],
        target=contract.get("target", TARGET_CHANNEL),
        target_unit=contract.get("target_unit", EARTH_TARGET_UNIT),
        horizon=int(contract.get("horizon", EARTH_HORIZON)),
        window=int(contract.get("window", EARTH_WINDOW)),
        input_channel_order=list(contract.get("input_channel_order") or []),
        input_units=list(contract.get("input_units") or []),
        latitude=[float(value) for value in release.latitude],
        longitude=[float(value) for value in release.longitude],
        grid_shape=[int(release.latitude.size), int(release.longitude.size)],
        origins=origins,
        metrics={
            "schema": checkpoint.metrics.get("schema"),
            "unit": checkpoint.metrics.get("unit"),
            "aggregation": checkpoint.metrics.get("aggregation"),
            "splits": splits,
            "split_ratios": contract.get("split_ratios"),
            "split_ranges": contract.get("split_ranges"),
        },
        run={
            "best_epoch": run.get("best_epoch"),
            "epochs_completed": run.get("epochs_completed"),
            "seed": run.get("seed"),
            "device": run.get("device"),
            "created_utc": run.get("created_utc"),
            "linear_hidden_layers": (checkpoint.model_config.get("architecture_params") or {}).get(
                "linear_hidden_layers"
            ),
        },
        training_split_end=str(training_end) if training_end else None,
        model=checkpoint.model_identity(),
        warnings=warnings,
        temporal=({"frequency_hours": 3, "step_unit": "hour", "step": 3,
                   "time_zone": "UTC", "timestamp_rule": "interval_center"}
                  if checkpoint.dataset_binding["dataset_id"] == EARTH_DATASET_3HOURLY_ID else {}),
    )


def _model_source_warnings(checkpoint: Any) -> list[str]:
    """Describe the uploaded model file state for the prediction page."""
    if checkpoint.model_source != MODEL_SOURCE_UPLOADED:
        return []
    reference = checkpoint.uploaded_model or {}
    report = verify_reference_source(reference)
    if report["status"] == "available":
        return []
    if report["status"] == "missing":
        return [
            "the original uploaded model file is unavailable; prediction uses the "
            "verified copy stored inside the checkpoint"
        ]
    if report["status"] == "tampered":
        return [
            f"the uploaded model file no longer matches the trained version ({report['detail']}); "
            "prediction will use the verified copy stored inside the checkpoint"
        ]
    return [f"the uploaded model file state is unknown: {report['detail']}"]


def _origin_index(release, origin: Any, window: int, horizon: int) -> int:
    if not isinstance(origin, str) or not origin.strip():
        raise DatasetRequestError(
            ORIGIN_INVALID,
            "A forecast origin date is required",
            status_code=422,
        )
    text = origin.strip()
    if len(text) > 10:
        raise DatasetRequestError(
            ORIGIN_INVALID, "Daily Earth tasks require a date-only forecast origin", status_code=422,
        )
    try:
        index = release_date_index(release, text)
    except (KeyError, ValueError) as exc:
        raise DatasetRequestError(
            ORIGIN_OUT_OF_RANGE,
            "The forecast origin is not a date in the published dataset",
            status_code=422,
        ) from exc
    dates = np.asarray(release.dates, dtype="datetime64[D]")
    if index < window - 1 or index + horizon >= len(dates):
        raise DatasetRequestError(
            ORIGIN_OUT_OF_RANGE,
            "The forecast origin needs a complete input window before it and "
            "published reference days after it",
            status_code=422,
        )
    return index


def run_earth_prediction(
    task: Any,
    origin: Any,
    registry: DatasetRegistry,
    device: Optional[str] = None,
    cache=None,
) -> dict:
    """Forecast the three days after ``origin`` and score them against the release."""
    _require_completed_earth_task(task)
    if getattr(task, "dataset_id", None) == EARTH_DATASET_3HOURLY_ID:
        return _run_threehour_prediction(task, origin, registry, device=device, cache=cache)
    checkpoint = _load_checkpoint(task)
    try:
        validate_checkpoint_payload(checkpoint.payload, expected_task_id=getattr(task, "id", None))
    except EarthArtifactError as exc:
        raise DatasetRequestError(
            getattr(exc, "code", "invalid_earth_training_artifact"),
            str(exc),
            status_code=409,
        ) from exc
    release = _sync_release(registry, checkpoint.dataset_binding)
    _validate_checkpoint_split_ranges(checkpoint, release)

    contract = checkpoint.training_contract
    window = int(contract.get("window", EARTH_WINDOW))
    horizon = int(contract.get("horizon", EARTH_HORIZON))
    order = list(contract.get("input_channel_order") or [])
    index = _origin_index(release, origin, window, horizon)
    dates = np.asarray(release.dates, dtype="datetime64[D]")
    origin_date = str(dates[index])

    mean, scale = validate_normalization(checkpoint.normalization, order)
    cube = stack_release_cube(release)
    # Input window is ``origin - (window - 1) .. origin`` inclusive.
    block = cube[index - window + 1:index + 1]
    inputs = normalize_cube(block, order, mean, scale)[None, ...]

    resolved_device = torch.device(device) if device else torch.device(
        "cuda" if torch.cuda.is_available() else "cpu"
    )
    try:
        model, model_warnings = build_earth_model_from_checkpoint(checkpoint)
    except (EarthArtifactError, EarthModelBuildError, UploadedModelSourceError) as exc:
        raise DatasetRequestError(
            getattr(exc, "code", "invalid_earth_training_artifact"),
            str(exc),
            status_code=409,
        ) from exc
    model = model.to(resolved_device)
    with torch.no_grad():
        output = earth_forward_for_model(
            model,
            torch.from_numpy(inputs).to(resolved_device),
            model_source=checkpoint.model_source,
            horizon=horizon,
        )
    if not torch.isfinite(output).all():
        raise DatasetRequestError(
            "invalid_earth_training_artifact",
            "The Earth model produced non-finite values",
            status_code=409,
        )
    prediction_scaled = output[0, :, 0].detach().cpu().numpy()
    target_mean = float(checkpoint.normalization["mean"][TARGET_CHANNEL_INDEX])
    target_scale = float(checkpoint.normalization["scale"][TARGET_CHANNEL_INDEX])
    prediction_du = prediction_scaled * target_scale + target_mean

    target_dates = forecast_dates(release, origin_date, horizon)
    reference_du = reference_ozone(release, target_dates[0], horizon)
    if prediction_du.shape != reference_du.shape:
        raise DatasetRequestError(
            "invalid_earth_training_artifact",
            "Prediction and reference shapes disagree",
            status_code=409,
        )
    residual_du = prediction_du - reference_du

    accumulator = ErrorAccumulator()
    # ErrorAccumulator expects [N, horizon, 1, lat, lon]; one origin, one channel.
    accumulator.update(prediction_du[None, :, None], reference_du[None, :, None])
    metrics = accumulator.result()
    metrics.update({
        "unit": EARTH_TARGET_UNIT,
        "target": TARGET_CHANNEL,
        "aggregation": "user_forecast_origin_lead_grid_uniform",
        "reference_available": True,
    })

    snapshot = checkpoint.dataset_binding.get("dataset_snapshot") or {}
    published_grid = snapshot.get("grid") or {}
    identity = checkpoint.model_identity()
    return {
        "planet": "earth",
        "task_id": int(getattr(task, "id", 0) or 0),
        "dataset_id": checkpoint.dataset_binding["dataset_id"],
        "dataset_version": str(checkpoint.dataset_binding.get("dataset_version")),
        "dataset_fingerprint": checkpoint.dataset_binding["dataset_fingerprint"],
        "target": TARGET_CHANNEL,
        "target_unit": EARTH_TARGET_UNIT,
        "model_architecture": identity.get("model_architecture"),
        "model_source": identity.get("model_source"),
        "model": identity,
        "warnings": list(model_warnings),
        "input_channel_order": order,
        "input_units": list(contract.get("input_units") or []),
        "forecast_origin": origin_date,
        "origin_split": origin_split(release, origin_date),
        "input_dates": [
            str(value) for value in dates[index - window + 1:index + 1]
        ],
        "target_dates": target_dates,
        "horizon": horizon,
        "window": window,
        "grid": {
            "shape": [int(release.latitude.size), int(release.longitude.size)],
            "latitude": [float(value) for value in release.latitude],
            "longitude": [float(value) for value in release.longitude],
            "latitude_range": published_grid.get("latitude_range"),
            "longitude_range": published_grid.get("longitude_range"),
            "latitude_step": published_grid.get("latitude_step"),
            "longitude_step": published_grid.get("longitude_step"),
            "coverage": published_grid.get("coverage"),
            "wrap_longitude": published_grid.get("wrap_longitude"),
        },
        "variables": [
            {
                "id": TARGET_CHANNEL,
                "label": VARIABLE_LABELS.get(TARGET_CHANNEL, TARGET_CHANNEL),
                "units": EARTH_TARGET_UNIT,
                "role": "target_and_input",
            }
        ],
        "prediction": _field_list(prediction_du),
        "reference": _field_list(reference_du),
        "residual": _field_list(residual_du),
        "metrics": metrics,
    }


def _threehour_checkpoint_sha(task):
    try:
        return file_sha256(Path(task.output_model_path))
    except OSError as exc:
        raise DatasetRequestError("invalid_earth_training_artifact",
                                  "The Earth checkpoint cannot be read", status_code=409) from exc


def _read_threehour_forecast_block(release, index, order, normalization, *, window=56, horizon=24):
    """Read the task's input/reference span outside the tile loop."""
    mean, scale = validate_normalization(normalization, order)
    inputs = np.empty((window, len(order), 240, 480), dtype="float32")
    reference = np.empty((horizon, 240, 480), dtype="float32")
    try:
        path = _threehour_path(release)
        first, forecast, stop = index - window + 1, index + 1, index + horizon + 1
        with netcdf_read_lock(), xr.open_dataset(path, engine="netcdf4", mask_and_scale=False) as ds:
            if (not np.array_equal(ds.time.isel(time=slice(first, stop)).values, release.dates[first:stop])
                    or not np.array_equal(ds.lat.values, release.latitude)
                    or not np.array_equal(ds.lon.values, release.longitude)):
                raise DatasetRequestError("dataset_version_changed",
                                          "Prediction coordinates or timestamps changed", status_code=409)
            for channel_index, channel in enumerate(order):
                for start in range(first, forecast, 8):
                    end = min(start + 8, forecast)
                    values = _threehour_values(ds, channel, start, end)
                    inputs[start - first:end - first, channel_index] = (
                        (values.astype("float64") - mean[channel_index]) / scale[channel_index]
                    ).astype("float32")
            for start in range(forecast, stop, 8):
                end = min(start + 8, stop)
                reference[start - forecast:end - forecast] = _threehour_values(ds, "TO3", start, end)
        _threehour_path(release)
    except DatasetRequestError:
        raise
    except (OSError, ValueError, KeyError) as exc:
        try:
            _threehour_path(release)
        except ValueError as changed:
            raise DatasetRequestError("dataset_version_changed", str(changed), status_code=409) from changed
        raise DatasetRequestError("earth_prediction_data_unavailable",
                                  "The selected Earth input or reference data are unavailable", status_code=503) from exc
    return inputs, reference


def _serialize_threehour_result(result):
    public = {key: value for key, value in result.items() if not key.startswith("_")}
    public["prediction"] = _field_list(result["_prediction_du"])
    public["reference"] = _field_list(result["_reference_du"])
    public["residual"] = _field_list(result["_residual_du"])
    return public


def _run_threehour_prediction(task, origin, registry, *, device=None, cache=None):
    checkpoint_sha = _threehour_checkpoint_sha(task)
    checkpoint = _load_checkpoint(task)
    if _threehour_checkpoint_sha(task) != checkpoint_sha:
        raise DatasetRequestError("invalid_earth_training_artifact",
                                  "The checkpoint changed during loading", status_code=409)
    release = _sync_release(registry, checkpoint.dataset_binding)
    _validate_checkpoint_split_ranges(checkpoint, release)
    window, horizon = checkpoint.training_contract['window'], checkpoint.training_contract['horizon']
    try:
        index = threehour_origin_index(release, origin, window=window, horizon=horizon,
            strict_split=checkpoint.model_source == MODEL_SOURCE_UPLOADED)
        timestamps = threehour_forecast_timestamps(release, origin, window=window, horizon=horizon)
        split_name = threehour_origin_split(release, origin, window=window, horizon=horizon)
    except EarthArtifactError as exc:
        raise DatasetRequestError(exc.code, str(exc), status_code=422 if exc.code in (
            ORIGIN_INVALID, ORIGIN_OUT_OF_RANGE) else 409) from exc
    iso = lambda value: np.datetime_as_string(value, unit="s") + "Z"
    normalized_origin = iso(release.dates[index])
    key = build_earth_prediction_cache_key(
        planet="earth", dataset_id=EARTH_DATASET_3HOURLY_ID,
        dataset_version=checkpoint.dataset_binding["dataset_version"],
        dataset_fingerprint=checkpoint.dataset_binding["dataset_fingerprint"],
        task_id=task.id, forecast_origin=normalized_origin, target_timestamps=timestamps,
        checkpoint_sha256=checkpoint_sha,
    )
    cache = EARTH_PREDICTION_CACHE if cache is None else cache
    cached = cache.get(key)
    if cached is not None:
        return _serialize_threehour_result(cached)
    order = checkpoint.training_contract["input_channel_order"]
    inputs, reference = _read_threehour_forecast_block(release, index, order, checkpoint.normalization,
                                                     window=window, horizon=horizon)
    try:
        model, warnings = build_earth_model_from_checkpoint(checkpoint)
        resolved_device = torch.device(device) if device else torch.device("cuda" if torch.cuda.is_available() else "cpu")
        model.to(resolved_device).eval()
        prediction = np.empty_like(reference)
        mean, scale = checkpoint.normalization["mean"][0], checkpoint.normalization["scale"][0]
        with torch.no_grad():
            for lat in range(0, 240, 24):
                for lon in range(0, 480, 48):
                    tile = np.ascontiguousarray(inputs[None, :, :, lat:lat + 24, lon:lon + 48])
                    output = earth_forward_for_model(
                        model, torch.from_numpy(tile).to(resolved_device), model_source=checkpoint.model_source,
                        horizon=horizon, height=24, width=48,
                    )
                    with np.errstate(over="ignore", invalid="ignore"):
                        prediction[:, lat:lat + 24, lon:lon + 48] = output[0, :, 0].cpu().numpy() * scale + mean
        if not np.isfinite(prediction).all():
            raise EarthArtifactError("The Earth model produced non-finite DU predictions")
    except (EarthArtifactError, EarthModelBuildError, UploadedModelSourceError, ValueError, RuntimeError) as exc:
        raise DatasetRequestError("invalid_earth_training_artifact", str(exc), status_code=409) from exc
    try:
        with np.errstate(over="ignore", invalid="ignore"):
            residual = prediction - reference
        if not np.isfinite(residual).all():
            raise EarthArtifactError("The Earth model produced non-finite residuals")
        accumulator = ErrorAccumulator(dataset_id=EARTH_DATASET_3HOURLY_ID, horizon=horizon)
        accumulator.update(prediction[None, :, None], reference[None, :, None])
        metrics = {**accumulator.result(), "unit": "DU", "target": "TO3",
                   "aggregation": "user_forecast_origin_lead_grid_uniform", "reference_available": True}
    except EarthArtifactError as exc:
        raise DatasetRequestError("invalid_earth_training_artifact", str(exc), status_code=409) from exc
    published_grid = checkpoint.dataset_binding["dataset_snapshot"]["grid"]
    identity = checkpoint.model_identity()
    result = {
        "planet": "earth", "task_id": task.id,
        "dataset_id": EARTH_DATASET_3HOURLY_ID,
        "dataset_version": checkpoint.dataset_binding["dataset_version"],
        "dataset_fingerprint": checkpoint.dataset_binding["dataset_fingerprint"],
        "target": "TO3", "target_unit": "DU", "window": window, "horizon": horizon,
        "frequency_hours": 3, "step_unit": "hour", "step": 3, "time_zone": "UTC",
        "timestamp_rule": "interval_center", "forecast_origin": normalized_origin,
        "origin_split": split_name, "input_channel_order": list(order),
        "input_units": checkpoint.training_contract["input_units"],
        "input_dates": [iso(value) for value in release.dates[index - window + 1:index + 1]],
        "input_timestamps": [iso(value) for value in release.dates[index - window + 1:index + 1]],
        "target_dates": timestamps, "target_timestamps": timestamps,
        "model_architecture": identity.get("model_architecture"), "model_source": identity.get("model_source"),
        "model": identity, "warnings": list(warnings), "metrics": metrics, "cache_key": key,
        "grid": {"shape": [240, 480], "latitude": release.latitude.tolist(), "longitude": release.longitude.tolist(),
                 **{name: published_grid.get(name) for name in (
                     "latitude_range", "longitude_range", "latitude_step", "longitude_step", "coverage", "wrap_longitude")}},
        "variables": [{"id": "TO3", "label": VARIABLE_LABELS["TO3"], "units": "DU", "role": "target_and_input"}],
        "_prediction_du": prediction, "_reference_du": reference, "_residual_du": residual,
    }
    # Check the bound package again after inference, before publishing/cache insertion.
    _sync_release(registry, checkpoint.dataset_binding)
    if _threehour_checkpoint_sha(task) != checkpoint_sha:
        raise DatasetRequestError("invalid_earth_training_artifact", "The checkpoint changed during prediction", status_code=409)
    cache.put(key, result)
    return _serialize_threehour_result(result)


def compare_earth_test_metrics(tasks: list[Any], registry: DatasetRegistry) -> dict:
    """Compare verified, persisted full-test metrics without rerunning inference."""
    if len(tasks) < 2 or len({task.id for task in tasks}) != len(tasks):
        raise DatasetRequestError("invalid_earth_comparison", "Select at least two distinct Earth tasks", status_code=422)
    items, guards, signature = [], [], None
    for task in tasks:
        _require_completed_earth_task(task)
        sha = _threehour_checkpoint_sha(task)
        checkpoint = _load_checkpoint(task)
        release = _sync_release(registry, checkpoint.dataset_binding)
        _validate_checkpoint_split_ranges(checkpoint, release)
        contract = checkpoint.training_contract
        test = checkpoint.metrics["splits"]["test"]
        current = {
            "dataset_id": checkpoint.dataset_binding["dataset_id"],
            "version": checkpoint.dataset_binding["dataset_version"],
            "fingerprint": checkpoint.dataset_binding["dataset_fingerprint"],
            "window": contract["window"], "horizon": contract["horizon"],
            "target": contract["target"], "unit": checkpoint.metrics["unit"],
            "aggregation": checkpoint.metrics["aggregation"],
            "test_range": contract["split_ranges"]["test"],
            "window_count": test["window_count"],
        }
        if signature is not None and current != signature:
            raise DatasetRequestError("earth_comparison_incompatible",
                                      "Models must use the same dataset release, test windows and metric policy", status_code=409)
        signature = current
        identity = checkpoint.model_identity()
        raw = getattr(task, "hyperparameters", None) or {}
        hypers = json.loads(raw) if isinstance(raw, str) else dict(raw)
        metrics = {
            "overall": dict(test["overall"]),
            "per_step": [{"step": row["lead_step"], **row} for row in test["by_lead"]],
            "by_horizon": test["by_horizon"], "unit": "DU",
            "aggregation": checkpoint.metrics["aggregation"],
            "split_meta": {"source": "published_manifest_splits", "test_range": current["test_range"],
                           "window_count": test["window_count"]},
        }
        items.append({"task_id": task.id, "model_name": task.custom_model_name or f"Task #{task.id}",
                      "planet": "earth", "dataset_id": current["dataset_id"],
                      "window": contract['window'], "horizon": contract['horizon'],
                      "dataset_version": current["version"], "dataset_fingerprint": current["fingerprint"],
                      "model_source": checkpoint.model_source, "architecture": identity.get("model_architecture"),
                      "selected_channels": list(contract["input_channel_order"]), "hyperparameters": hypers,
                      "model": identity, "metrics": metrics})
        guards.append((task, sha, checkpoint.dataset_binding))
    for task, sha, binding in guards:
        _sync_release(registry, binding)
        if _threehour_checkpoint_sha(task) != sha:
            raise DatasetRequestError("invalid_earth_training_artifact", "The checkpoint changed during comparison", status_code=409)
    return {"planet": "earth", "metric_source": "verified_checkpoint_test_metrics", "items": items}


def _field_list(values: np.ndarray) -> list[dict]:
    """Serialize ``[horizon, lat, lon]`` into finite per-day field payloads."""
    fields = []
    for day in np.asarray(values, dtype="float64"):
        finite = np.isfinite(day)
        fields.append({
            "field": [[float(cell) for cell in row] for row in day],
            "minVal": float(day.min()),
            "maxVal": float(day.max()),
            "valid_cells": int(finite.sum()),
        })
    return fields


__all__ = [
    "compare_earth_test_metrics",
    "EarthPredictionContext",
    "ORIGIN_INVALID",
    "ORIGIN_OUT_OF_RANGE",
    "TASK_NOT_COMPLETED",
    "build_prediction_context",
    "run_earth_prediction",
]
