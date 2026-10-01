"""Earth historical prediction: restore a task's checkpoint and forecast 3 days.

This service is the Earth counterpart of the Mars inference path. It exists so an
Earth task can be predicted from **its own** verified release and checkpoint:
nothing here reads OpenMARS, MCD, MY/Ls, Mars channels or the Mars prediction
cache, and an Earth task is never routed through Mars data preparation.

The contract is deliberately narrow (first stage):

* the forecast origin must be a date in the published dataset that has a complete
  7 day input window before it and 3 published reference days after it;
* the three target days are ``origin + 1..3`` and the reference field for those
  days comes from the same published release;
* every returned field is in DU, on the real published grid.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Optional

import numpy as np
import torch

from services.dataset_identity import DatasetRequestError, is_earth_training_task
from services.dataset_registry import DatasetRegistry
from services.earth_dataset import (
    TARGET_CHANNEL,
    TARGET_CHANNEL_INDEX,
    normalize_cube,
    reference_ozone,
    release_date_index,
    stack_release_cube,
    validate_normalization,
)
from services.earth_training_artifact import (
    EarthArtifactError,
    ErrorAccumulator,
    available_origin_range,
    build_earth_model_from_checkpoint,
    forecast_dates,
    load_earth_training_artifact,
    validate_checkpoint_payload,
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
    return binding


def _require_completed_earth_task(task: Any) -> None:
    if not is_earth_training_task(task):
        raise DatasetRequestError(
            "dataset_prediction_not_supported",
            "Earth historical prediction requires an Earth training task",
            status_code=409,
        )
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
        import json

        try:
            binding["dataset_snapshot"] = json.loads(snapshot)
        except ValueError as exc:
            raise DatasetRequestError(
                "invalid_earth_training_artifact",
                "The task dataset snapshot is damaged",
                status_code=409,
            ) from exc
    try:
        return load_earth_training_artifact(
            getattr(task, "output_model_path"),
            expected_binding=binding,
            expected_task_id=getattr(task, "id", None),
        )
    except EarthArtifactError as exc:
        raise DatasetRequestError(
            getattr(exc, "code", "invalid_earth_training_artifact"),
            str(exc),
            status_code=409,
        ) from exc


def _sync_release(registry: DatasetRegistry, binding: Mapping[str, Any]):
    """Return the release the task was bound to, or a stable version error."""
    try:
        release = registry.get_earth_snapshot(binding["dataset_id"])
    except DatasetRequestError:
        raise
    metadata = release.metadata
    if binding.get("dataset_fingerprint") != metadata.get("dataset_fingerprint"):
        raise DatasetRequestError(
            "dataset_version_changed",
            "The dataset release changed since this task was trained; retrain before predicting",
            status_code=409,
        )
    return release


def build_prediction_context(task: Any, registry: DatasetRegistry) -> EarthPredictionContext:
    """Return the selectable origins, grid, units, model identity and metrics."""
    _require_completed_earth_task(task)
    checkpoint = _load_checkpoint(task)
    release = _sync_release(registry, checkpoint.dataset_binding)
    contract = checkpoint.training_contract
    origins = available_origin_range(
        release,
        window=int(contract.get("window", EARTH_WINDOW)),
        horizon=int(contract.get("horizon", EARTH_HORIZON)),
    )
    splits = checkpoint.metrics.get("splits") or {}
    run = checkpoint.run
    snapshot = checkpoint.dataset_binding.get("dataset_snapshot") or {}
    published_splits = snapshot.get("splits") or {}
    training_end = (published_splits.get("train") or {}).get("end")
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
    try:
        index = release_date_index(release, text)
    except (KeyError, ValueError) as exc:
        raise DatasetRequestError(
            ORIGIN_OUT_OF_RANGE,
            "The forecast origin is not a date in the published dataset",
            status_code=422,
        ) from exc
    dates = np.asarray(release.dates, dtype="datetime64[D]")
    if index < window or index + horizon >= len(dates):
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
) -> dict:
    """Forecast the three days after ``origin`` and score them against the release."""
    _require_completed_earth_task(task)
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
    "EarthPredictionContext",
    "ORIGIN_INVALID",
    "ORIGIN_OUT_OF_RANGE",
    "TASK_NOT_COMPLETED",
    "build_prediction_context",
    "run_earth_prediction",
]
