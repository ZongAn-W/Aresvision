"""Versioned single-file Earth forecast checkpoint: strict save, verify, reload.

One ``.pth`` file carries everything needed to reproduce a run without guessing:
the complete adapter state dict, the model configuration, the dataset binding, the
training contract, the normalization block, the run record and the DU metrics.

Two rules shape this module:

* **Only plain data is stored.** Tensors plus ``str``/``int``/``float``/``bool``/
  ``None``/``list``/``dict`` values, so ``torch.load(..., weights_only=True)``
  always succeeds. NumPy arrays, ``datetime64``, ``Path`` and module objects are
  converted before saving.
* **Loading is strict.** Every structural field, the input channel order, the
  grid shape, the window/horizon and the state dict keys are checked, and the
  model is rebuilt and loaded with ``strict=True``. A non-empty file that does not
  satisfy the contract is an error, never a completed run.
"""

from __future__ import annotations

import json
import math
import multiprocessing
import os
import re
from datetime import datetime
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Optional, Sequence

import numpy as np
import torch

from services.earth_dataset import (
    CHANNELS,
    TARGET_CHANNEL,
    UNITS,
    canonical_input_channels,
    fit_normalization,
    input_units,
    release_split_codes,
    threehour_release_split_codes,
    validate_normalization,
)
from services.earth_training_contract import (
    EARTH_3HOURLY_ARTIFACT_SCHEMA,
    EARTH_3HOURLY_METRICS_SCHEMA,
    EARTH_3HOURLY_IMPLEMENTATION_ID,
    EARTH_3HOURLY_WINDOW,
    EARTH_3HOURLY_HORIZON,
    EARTH_ARTIFACT_SCHEMA,
    EARTH_HORIZON,
    EARTH_IMPLEMENTATION_ID,
    EARTH_METRICS_SCHEMA,
    EARTH_TARGET_CHANNEL,
    EARTH_TARGET_UNIT,
    EARTH_UPLOADED_ARCHITECTURE,
    EARTH_WINDOW,
    earth_training_profile,
)
from services.dataset_identity import EARTH_DATASET_3HOURLY_ID
from services.training_split import normalize_split_ratios, TrainingSplitError
from services.earth_model_source import (
    MODEL_SOURCE_OFFICIAL,
    MODEL_SOURCE_UPLOADED,
    EarthModelBuildError,
    build_uploaded_earth_model,
    earth_forward_for_model,
)
from training_backbones.earth_daily_model import (
    earth_model_config,
    forecaster_from_config,
    require_earth_channel_order,
    state_dict_to_cpu,
)

METRIC_KEYS = ("rmse", "mae")
LEAD_DAYS = (1, 2, 3)
THREE_HOURLY_HORIZONS = (24, 48, 72)
THREE_HOURLY_TIMESTAMP_RULE = "interval_center"
RUN_REQUIRED_KEYS = (
    "task_id",
    "optimizer",
    "loss",
    "best_epoch",
    "epochs_completed",
    "run_complete",
)


class EarthArtifactError(ValueError):
    """A checkpoint that does not satisfy the published artifact contract."""

    def __init__(self, message: str, *, code: str = "invalid_earth_training_artifact"):
        super().__init__(message)
        self.code = code


# ── metrics ────────────────────────────────────────────────────────────────

def compute_earth_metrics(predictions_du, targets_du, dataset_id: str | None = None) -> dict:
    """Return overall and per-lead RMSE/MAE in DU for ``[N, 3, 1, H, W]`` arrays.

    Every ``(forecast origin, lead day, grid cell)`` contributes equally, so the
    numbers are grid-uniform spatial errors, never an area-weighted global mean.
    """
    if dataset_id == EARTH_DATASET_3HOURLY_ID:
        accumulator = ErrorAccumulator(dataset_id=dataset_id)
        accumulator.update(predictions_du, targets_du)
        return accumulator.result()
    prediction = np.asarray(predictions_du, dtype="float64")
    target = np.asarray(targets_du, dtype="float64")
    if prediction.shape != target.shape:
        raise EarthArtifactError("Prediction and reference shapes must match")
    if prediction.ndim != 5:
        raise EarthArtifactError("Predictions must be [N, horizon, 1, lat, lon]")
    if not np.isfinite(prediction).all() or not np.isfinite(target).all():
        raise EarthArtifactError("Metrics require finite predictions and references")

    error = prediction - target
    absolute = np.abs(error)
    overall_rmse = math.sqrt(float((error ** 2).mean()))
    overall_mae = float(absolute.mean())
    by_lead = []
    for index, lead_day in enumerate(LEAD_DAYS):
        if index >= prediction.shape[1]:
            break
        lead_error = error[:, index]
        by_lead.append({
            "lead_day": int(lead_day),
            "rmse": math.sqrt(float((lead_error ** 2).mean())),
            "mae": float(np.abs(lead_error).mean()),
        })
    return {
        "overall": {"rmse": overall_rmse, "mae": overall_mae},
        "by_lead": by_lead,
    }


class ErrorAccumulator:
    """Accumulate squared/absolute error sums without keeping predictions.

    Training evaluates the validation and test splits batch by batch; keeping the
    whole partition in memory would defeat the point of a small server. The
    accumulated result is identical to :func:`compute_earth_metrics` because both
    aggregate over error elements in float64.
    """

    def __init__(self, dataset_id: str | None = None) -> None:
        self._three_hourly = dataset_id == EARTH_DATASET_3HOURLY_ID
        leads = 24 if self._three_hourly else len(LEAD_DAYS)
        self._squared = np.zeros(leads, dtype="float64")
        self._absolute = np.zeros(leads, dtype="float64")
        self._counts = np.zeros(leads, dtype="float64")

    def update(self, predictions_du, targets_du) -> None:
        prediction = np.asarray(predictions_du, dtype="float64")
        target = np.asarray(targets_du, dtype="float64")
        if prediction.shape != target.shape or prediction.ndim != 5:
            raise EarthArtifactError("Accumulated batches must be [N, horizon, 1, lat, lon]")
        if self._three_hourly and (prediction.shape[1] != 24 or prediction.shape[2] != 1):
            raise EarthArtifactError("Three-hourly metrics require exactly 24 TO3 leads")
        if not np.isfinite(prediction).all() or not np.isfinite(target).all():
            raise EarthArtifactError("Metrics require finite predictions and references")
        error = prediction - target
        for index in range(min(len(self._counts), prediction.shape[1])):
            lead_error = error[:, index]
            self._squared[index] += float((lead_error ** 2).sum())
            self._absolute[index] += float(np.abs(lead_error).sum())
            self._counts[index] += float(lead_error.size)

    def result(self) -> dict:
        if not np.all(self._counts > 0):
            raise EarthArtifactError("No valid samples were accumulated")
        by_lead = [
            {
                **({"lead_step": index + 1, "lead_hours": (index + 1) * 3}
                   if self._three_hourly else {"lead_day": index + 1}),
                "rmse": math.sqrt(float(self._squared[index] / self._counts[index])),
                "mae": float(self._absolute[index] / self._counts[index]),
            }
            for index in range(len(self._counts))
        ]
        total = float(self._counts.sum())
        squared = float(self._squared.sum())
        absolute = float(self._absolute.sum())
        result = {
            "overall": {"rmse": math.sqrt(squared / total), "mae": absolute / total},
            "by_lead": by_lead,
        }
        if self._three_hourly:
            result["by_horizon"] = []
            for hours in THREE_HOURLY_HORIZONS:
                steps = hours // 3
                count = float(self._counts[:steps].sum())
                result["by_horizon"].append({
                    "horizon_hours": hours, "lead_steps": steps,
                    "rmse": math.sqrt(float(self._squared[:steps].sum()) / count),
                    "mae": float(self._absolute[:steps].sum()) / count,
                })
        return result


def build_metrics_block(
    *,
    validation: Mapping[str, Any],
    test: Mapping[str, Any],
    validation_window_count: int,
    test_window_count: int,
    dataset_id: str | None = None,
) -> dict:
    """Assemble the persisted metrics block for one training run.

    The window count lives inside each split so a loaded checkpoint is
    self-describing: a reader never has to guess how many forecast origins the
    numbers were aggregated over.
    """
    block = {
        "schema": EARTH_3HOURLY_METRICS_SCHEMA if dataset_id == EARTH_DATASET_3HOURLY_ID else EARTH_METRICS_SCHEMA,
        "target": EARTH_TARGET_CHANNEL,
        "unit": EARTH_TARGET_UNIT,
        "aggregation": "forecast_origin_lead_grid_uniform",
        "splits": {
            "validation": _checked_split_metrics(validation, validation_window_count, dataset_id),
            "test": _checked_split_metrics(test, test_window_count, dataset_id),
        },
    }
    return block


def _checked_split_metrics(metrics: Mapping[str, Any], window_count: int, dataset_id: str | None = None) -> dict:
    if not isinstance(metrics, Mapping):
        raise EarthArtifactError("Split metrics must be a mapping")
    counts = int(window_count)
    if counts < 1:
        raise EarthArtifactError("window_count must be positive")
    block = {"window_count": counts, "overall": {}, "by_lead": []}
    overall = metrics.get("overall")
    if not isinstance(overall, Mapping):
        raise EarthArtifactError("Split metrics require an overall block")
    for key in METRIC_KEYS:
        block["overall"][key] = _finite_float(overall.get(key), f"overall.{key}")
    by_lead = metrics.get("by_lead")
    if dataset_id == EARTH_DATASET_3HOURLY_ID:
        if not isinstance(by_lead, (list, tuple)) or len(by_lead) != 24:
            raise EarthArtifactError("Three-hourly metrics require 24 ordered leads")
        for index, row in enumerate(by_lead):
            if not isinstance(row, Mapping) or row.get("lead_step") != index + 1 or row.get("lead_hours") != (index + 1) * 3:
                raise EarthArtifactError("Three-hourly lead step/hour order is invalid")
            block["by_lead"].append({
                "lead_step": index + 1, "lead_hours": (index + 1) * 3,
                "rmse": _finite_float(row.get("rmse"), f"lead[{index}].rmse"),
                "mae": _finite_float(row.get("mae"), f"lead[{index}].mae"),
            })
        horizons = metrics.get("by_horizon")
        if not isinstance(horizons, (list, tuple)) or len(horizons) != 3:
            raise EarthArtifactError("Three-hourly metrics require 24/48/72-hour summaries")
        block["by_horizon"] = []
        for index, hours in enumerate(THREE_HOURLY_HORIZONS):
            row = horizons[index]
            if not isinstance(row, Mapping) or row.get("horizon_hours") != hours or row.get("lead_steps") != hours // 3:
                raise EarthArtifactError("Three-hourly horizon order is invalid")
            block["by_horizon"].append({
                "horizon_hours": hours, "lead_steps": hours // 3,
                "rmse": _finite_float(row.get("rmse"), f"horizon[{index}].rmse"),
                "mae": _finite_float(row.get("mae"), f"horizon[{index}].mae"),
            })
        for group in (block["overall"], *block["by_lead"], *block["by_horizon"]):
            if any(group[key] < 0 for key in METRIC_KEYS):
                raise EarthArtifactError("RMSE and MAE cannot be negative")
        # Every lead contains the same forecast-origin/grid elements. Cumulative
        # summaries must therefore agree with those 24 persisted lead metrics.
        for summary in [*block["by_horizon"], {**block["overall"], "lead_steps": 24}]:
            leads = block["by_lead"][:summary["lead_steps"]]
            expected = {
                "rmse": math.sqrt(sum(row["rmse"] ** 2 for row in leads) / len(leads)),
                "mae": sum(row["mae"] for row in leads) / len(leads),
            }
            if any(not math.isclose(summary[key], expected[key], rel_tol=1e-6, abs_tol=1e-9) for key in METRIC_KEYS):
                raise EarthArtifactError("Three-hourly cumulative metrics disagree with lead metrics")
        return block
    if not isinstance(by_lead, (list, tuple)) or len(by_lead) != len(LEAD_DAYS):
        raise EarthArtifactError("Split metrics require one entry per lead day")
    for index, row in enumerate(by_lead):
        if not isinstance(row, Mapping):
            raise EarthArtifactError("Lead day metrics must be mappings")
        if int(row.get("lead_day", -1)) != LEAD_DAYS[index]:
            raise EarthArtifactError("Lead day metrics are not ordered 1, 2, 3")
        block["by_lead"].append({
            "lead_day": int(LEAD_DAYS[index]),
            "rmse": _finite_float(row.get("rmse"), f"lead[{index}].rmse"),
            "mae": _finite_float(row.get("mae"), f"lead[{index}].mae"),
        })
    return block


def _finite_float(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise EarthArtifactError(f"{label} must be a number")
    parsed = float(value)
    if not math.isfinite(parsed):
        raise EarthArtifactError(f"{label} must be finite")
    return parsed


# ── payload ────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class EarthCheckpoint:
    """A validated Earth checkpoint ready to rebuild a model."""

    path: str
    payload: dict
    model_config: dict
    model_ref: dict
    dataset_binding: dict
    training_contract: dict
    normalization: dict
    run: dict
    metrics: dict

    @property
    def model_source(self) -> str:
        return str(self.model_ref.get("model_source") or MODEL_SOURCE_OFFICIAL)

    @property
    def uploaded_model(self) -> Optional[dict]:
        reference = self.model_ref.get("uploaded_model")
        return reference if isinstance(reference, dict) else None

    def model_identity(self) -> dict:
        """Public identity of the trained model, safe to return over HTTP."""
        identity = {
            "model_source": self.model_source,
            "model_architecture": self.model_ref.get("architecture"),
        }
        uploaded = self.uploaded_model
        if uploaded is not None:
            identity.update({
                "uploaded_model_id": uploaded.get("package_id"),
                "uploaded_model_name": uploaded.get("display_name"),
                "uploaded_model_version": uploaded.get("version"),
                "uploaded_model_content_hash": uploaded.get("content_hash"),
                "uploaded_model_source_embedded": bool(uploaded.get("source_text")),
            })
        return identity


def build_model_reference(
    *,
    model_source: str,
    model_config: Mapping[str, Any],
    uploaded_model: Optional[Mapping[str, Any]] = None,
) -> dict:
    """Build the ``model_ref`` block stored inside a checkpoint.

    For an uploaded model the reference carries the pinned identity **and the
    verified source text**, so prediction can rebuild the model after the original
    file is gone, and can prove the file it did find is the one that was trained.
    """
    if model_source == MODEL_SOURCE_OFFICIAL:
        reference: dict[str, Any] = {
            "model_source": MODEL_SOURCE_OFFICIAL,
            "architecture": model_config.get("architecture"),
            "implementation_id": model_config.get("implementation_id"),
        }
        return reference
    if model_source != MODEL_SOURCE_UPLOADED:
        raise EarthArtifactError(f"Unsupported Earth model source: {model_source}")
    if not isinstance(uploaded_model, Mapping):
        raise EarthArtifactError("An uploaded Earth model requires a stored model reference")
    source_text = uploaded_model.get("source_text")
    reference = {
        "model_source": MODEL_SOURCE_UPLOADED,
        "architecture": EARTH_UPLOADED_ARCHITECTURE,
        "implementation_id": model_config.get("implementation_id") or uploaded_model.get("package_id"),
        "uploaded_model": {
            "package_id": uploaded_model.get("package_id"),
            "display_name": uploaded_model.get("display_name"),
            "version": int(uploaded_model.get("version") or 0),
            "content_hash": uploaded_model.get("content_hash"),
            "source_path": uploaded_model.get("source_path"),
            # Plain text, never a pickled object: loading re-executes this source
            # only after its digest matches the recorded one.
            "source_text": source_text if isinstance(source_text, str) else None,
            "source_available": bool(isinstance(source_text, str) and source_text.strip()),
            "param_schema": _plain(dict(uploaded_model.get("param_schema") or {})),
            "custom_model_params": _plain(dict(uploaded_model.get("custom_model_params") or {})),
            "build_config": _plain(dict(uploaded_model.get("build_config") or {})),
            "input_channel_order": list(uploaded_model.get("input_channel_order") or []),
        },
    }
    for key in ("package_id", "content_hash"):
        value = reference["uploaded_model"][key]
        if not isinstance(value, str) or not value:
            raise EarthArtifactError(f"An uploaded Earth model requires a {key}")
    return reference


def build_checkpoint_payload(
    *,
    model: torch.nn.Module,
    input_channel_order: Sequence[str],
    linear_hidden_layers: int,
    dataset_binding: Mapping[str, Any],
    normalization: Mapping[str, Any],
    run: Mapping[str, Any],
    metrics: Mapping[str, Any],
    split_window_counts: Mapping[str, int],
    split_ratios: Mapping[str, float] | None = None,
    split_ranges: Mapping[str, Any] | None = None,
    task_id: Optional[int] = None,
    model_source: str = MODEL_SOURCE_OFFICIAL,
    uploaded_model: Optional[Mapping[str, Any]] = None,
) -> dict:
    """Assemble the complete checkpoint payload as plain, serialisable data."""
    order = require_earth_channel_order(input_channel_order)
    binding = _binding_payload(dataset_binding)
    dataset_id = binding["dataset_id"]
    three_hourly = dataset_id == EARTH_DATASET_3HOURLY_ID
    profile = earth_training_profile(dataset_id) if three_hourly else earth_training_profile()
    try:
        normalized_split_ratios = normalize_split_ratios(split_ratios)
    except TrainingSplitError as exc:
        raise EarthArtifactError(str(exc)) from exc
    has_manifest_ranges = bool(split_ranges)
    contract = {
        "target": EARTH_TARGET_CHANNEL,
        "target_unit": EARTH_TARGET_UNIT,
        "input_channel_order": order,
        "input_units": input_units(order),
        "tensor_layout": "BTCHW",
        "step_unit": profile["step_unit"],
        "window": profile["window"],
        "horizon": profile["horizon"],
        "strict_split_windows": True,
        "split_policy": "published_manifest_splits" if has_manifest_ranges else "legacy_compatibility",
        "split_window_counts": {str(key): int(value) for key, value in dict(split_window_counts).items()},
        "split_ratios": _plain(normalized_split_ratios),
        "split_ranges": _plain(dict(split_ranges or {})),
    }
    if three_hourly:
        contract.update({
            "profile_id": profile["profile_id"],
            "dataset_id": dataset_id,
            "step": 3, "frequency_hours": 3,
            "time_zone": "UTC",
            "timestamp_rule": THREE_HOURLY_TIMESTAMP_RULE,
            "time_aggregation": "three_hour_mean",
            "timestamp_offset_minutes": 90,
            "grid_shape": list(profile["grid_shape"]),
        })
    run_block = {str(key): _plain(value) for key, value in dict(run).items()}
    resolved_task_id = int(task_id if task_id is not None else run_block.get("task_id", 0))
    run_block["task_id"] = resolved_task_id
    model_config = earth_model_config(
        order, linear_hidden_layers,
        window=profile["window"], horizon=profile["horizon"],
        height=profile["grid_shape"][0], width=profile["grid_shape"][1],
        implementation_id=profile["implementation_id"],
    )
    if three_hourly and model_source == MODEL_SOURCE_UPLOADED:
        from training_backbones.earth_3hourly_uploaded_contract import CONTRACT_SCHEMA, IMPLEMENTATION_ID
        model_config.update(architecture=EARTH_UPLOADED_ARCHITECTURE, implementation_id=IMPLEMENTATION_ID,
                            contract_schema=CONTRACT_SCHEMA, spatial_tile_shape=[24, 48])
        contract.update(uploaded_model_schema=CONTRACT_SCHEMA, spatial_tile_shape=[24, 48], dtype="float32")
    model_ref = build_model_reference(
        model_source=model_source,
        model_config=model_config,
        uploaded_model=uploaded_model,
    )
    payload = {
        "artifact_schema": EARTH_3HOURLY_ARTIFACT_SCHEMA if three_hourly else EARTH_ARTIFACT_SCHEMA,
        "model_state_dict": state_dict_to_cpu(model),
        "model_config": model_config,
        "model_ref": model_ref,
        "dataset_binding": binding,
        "training_contract": contract,
        "normalization": _plain(dict(normalization)),
        "run": run_block,
        "metrics": _plain(dict(metrics)),
    }
    validate_checkpoint_payload(payload, expected_task_id=resolved_task_id)
    return payload


def _binding_payload(binding: Mapping[str, Any]) -> dict:
    if not isinstance(binding, Mapping):
        raise EarthArtifactError("dataset_binding must be a mapping")
    snapshot = binding.get("dataset_snapshot")
    if isinstance(snapshot, str):
        try:
            snapshot = json.loads(snapshot)
        except ValueError as exc:
            raise EarthArtifactError("dataset_snapshot is not valid JSON") from exc
    if not isinstance(snapshot, Mapping):
        raise EarthArtifactError("dataset_binding requires an object snapshot")
    identity = {
        "dataset_id": binding.get("dataset_id"),
        "dataset_version": binding.get("dataset_version"),
        "dataset_fingerprint": binding.get("dataset_fingerprint"),
        "dataset_identity_status": binding.get("dataset_identity_status"),
        "dataset_snapshot": _plain(dict(snapshot)),
    }
    for key in ("dataset_id", "dataset_version", "dataset_fingerprint"):
        if not isinstance(identity[key], str) or not identity[key]:
            raise EarthArtifactError(f"dataset_binding requires a non-empty {key}")
    return identity


def _plain(value: Any) -> Any:
    """Convert a value to something ``weights_only=True`` can read back.

    ``isinstance`` checks are not enough on their own: class instances that
    *subclass* a basic type (``torch.__version__`` is a ``TorchVersion``, a
    ``str`` subclass; ``numpy`` scalars subclass ``float``) are still rejected by
    the weights-only unpickler, so every value is rebuilt into an exact builtin.
    """
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, str):
        return str(value)
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        return float(value)
    if isinstance(value, np.datetime64):
        # Preserve subdaily UTC timestamps rather than the legacy date truncation.
        if value.dtype.name == "datetime64[D]":
            return str(value)
        return np.datetime_as_string(value, unit="s") + "Z"
    if isinstance(value, np.generic):
        return _plain(value.item())
    if isinstance(value, np.ndarray):
        return [_plain(item) for item in value.tolist()]
    if isinstance(value, Mapping):
        return {str(key): _plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_plain(item) for item in value]
    raise EarthArtifactError(f"Unsupported checkpoint value type: {type(value).__name__}")


# ── validation and loading ─────────────────────────────────────────────────

def validate_checkpoint_payload(
    payload: Mapping[str, Any],
    *,
    expected_binding: Optional[Mapping[str, Any]] = None,
    expected_task_id: Optional[int] = None,
    expected_channel_order: Optional[Sequence[str]] = None,
) -> dict:
    """Validate every contract field and return the normalized payload."""
    if not isinstance(payload, Mapping):
        raise EarthArtifactError("Checkpoint must be a mapping")
    artifact_schema = payload.get("artifact_schema")
    if artifact_schema not in (EARTH_ARTIFACT_SCHEMA, EARTH_3HOURLY_ARTIFACT_SCHEMA):
        raise EarthArtifactError("Unsupported Earth checkpoint schema")
    three_hourly = artifact_schema == EARTH_3HOURLY_ARTIFACT_SCHEMA
    metric_dataset_id = EARTH_DATASET_3HOURLY_ID if three_hourly else None
    profile = earth_training_profile(metric_dataset_id)

    state_dict = payload.get("model_state_dict")
    if not isinstance(state_dict, Mapping) or not state_dict:
        raise EarthArtifactError("Checkpoint has no model state dict")
    for key, value in state_dict.items():
        if not isinstance(value, torch.Tensor):
            raise EarthArtifactError(f"State dict entry {key} is not a tensor")
        if not torch.isfinite(value).all():
            raise EarthArtifactError(f"State dict entry {key} contains non-finite values")

    model_config = payload.get("model_config")
    if not isinstance(model_config, Mapping):
        raise EarthArtifactError("Checkpoint has no model config")
    model_ref = payload.get("model_ref")
    if not isinstance(model_ref, Mapping):
        # Older official-only checkpoints have no model_ref; treat them as official
        # DLinear so already completed tasks stay loadable and predictable.
        model_ref = {
            "model_source": MODEL_SOURCE_OFFICIAL,
            "architecture": model_config.get("architecture"),
        }
    model_source = str(model_ref.get("model_source") or MODEL_SOURCE_OFFICIAL)
    if model_source not in (MODEL_SOURCE_OFFICIAL, MODEL_SOURCE_UPLOADED):
        raise EarthArtifactError(f"Unsupported checkpoint model source: {model_source}")
    # Three-hourly checkpoints may carry an uploaded model reference, but only
    # when the independent three-hour Earth source contract has been validated.
    if model_source == MODEL_SOURCE_OFFICIAL:
        if model_config.get("architecture") != "dlinear":
            raise EarthArtifactError("Checkpoint model is not the official DLinear")
    else:
        uploaded = model_ref.get("uploaded_model")
        if not isinstance(uploaded, Mapping):
            raise EarthArtifactError("An uploaded Earth checkpoint has no model reference")
        for key in ("package_id", "content_hash"):
            value = uploaded.get(key)
            if not isinstance(value, str) or not value:
                raise EarthArtifactError(
                    f"The uploaded model reference requires a non-empty {key}"
                )
        if int(model_config.get("input_channels", -1)) < 1:
            raise EarthArtifactError("model_config input channel count is invalid")
        if not isinstance(uploaded.get("source_text"), str) or not uploaded["source_text"].strip():
            raise EarthArtifactError(
                "An uploaded Earth checkpoint must embed the verified model source so it "
                "can be rebuilt without the original file"
            )
        if list(uploaded.get("input_channel_order") or []) != list(model_config.get("input_channel_order") or []):
            raise EarthArtifactError(
                "The uploaded model reference channel order disagrees with the model config"
            )
    order = require_earth_channel_order(model_config.get("input_channel_order") or [])
    if int(model_config.get("input_channels", -1)) != len(order):
        raise EarthArtifactError("model_config input channel count is inconsistent")
    if list(model_config.get("selected_channels") or []) != list(order[1:]):
        raise EarthArtifactError("model_config selected channels are inconsistent")
    if bool(model_config.get("use_sphere")):
        raise EarthArtifactError("Earth checkpoints never use SPHERE")
    if (int(model_config.get("window", -1)), int(model_config.get("horizon", -1))) != (
        profile["window"], profile["horizon"],
    ):
        raise EarthArtifactError(f"model_config must fix window={profile['window']} and horizon={profile['horizon']}")
    height, width = int(model_config.get("height", -1)), int(model_config.get("width", -1))
    if height < 1 or width < 1:
        raise EarthArtifactError("model_config grid shape is invalid")
    expected_implementation = EARTH_3HOURLY_IMPLEMENTATION_ID
    if three_hourly and model_source == MODEL_SOURCE_UPLOADED:
        from training_backbones.earth_3hourly_uploaded_contract import (
            CONTRACT_SCHEMA, IMPLEMENTATION_ID, build_config,
        )
        from services.uploaded_model_source import hash_source_bytes
        expected_implementation = IMPLEMENTATION_ID
        if (model_config.get("architecture") != EARTH_UPLOADED_ARCHITECTURE
                or model_config.get("contract_schema") != CONTRACT_SCHEMA
                or model_config.get("spatial_tile_shape") != [24, 48]):
            raise EarthArtifactError("Three-hour uploaded model schema or tile shape is invalid")
        if (type(uploaded.get("version")) is not int or uploaded["version"] < 1
                or hash_source_bytes(uploaded["source_text"].encode("utf-8")) != uploaded["content_hash"]):
            raise EarthArtifactError("Three-hour uploaded source identity is invalid")
        try:
            expected_config = build_config(order, uploaded.get("custom_model_params"))
        except ValueError as exc:
            raise EarthArtifactError(str(exc)) from exc
        if uploaded.get("build_config") != expected_config:
            raise EarthArtifactError("Three-hour uploaded build config disagrees with the contract")
        training_contract = payload.get("training_contract") or {}
        if (training_contract.get("uploaded_model_schema") != CONTRACT_SCHEMA
                or training_contract.get("spatial_tile_shape") != [24, 48]
                or training_contract.get("dtype") != "float32"):
            raise EarthArtifactError("Three-hour uploaded execution contract is invalid")
    if three_hourly and (
        [height, width] != profile["grid_shape"]
        or model_config.get("implementation_id") != expected_implementation
        or model_ref.get("implementation_id") != expected_implementation
    ):
        raise EarthArtifactError("Three-hourly model grid or implementation is invalid")
    architecture_params = model_config.get("architecture_params")
    if architecture_params is not None and not isinstance(architecture_params, Mapping):
        raise EarthArtifactError("model_config architecture_params must be a mapping")
    hidden_layers = int((architecture_params or {}).get("linear_hidden_layers", 2))
    if hidden_layers < 1 or hidden_layers > 4:
        raise EarthArtifactError("model_config linear_hidden_layers is out of range")
    # An uploaded model's architecture is whatever its source defines; only the
    # mandatory input/output contract above is enforced for it.
    if model_source == MODEL_SOURCE_OFFICIAL and model_ref.get("architecture") != model_config.get("architecture"):
        raise EarthArtifactError("model_ref architecture disagrees with model_config")
    if model_source == MODEL_SOURCE_UPLOADED and model_ref.get("architecture") != EARTH_UPLOADED_ARCHITECTURE:
        raise EarthArtifactError("An uploaded checkpoint must be marked as the uploaded architecture")
    if expected_channel_order is not None and list(expected_channel_order) != order:
        raise EarthArtifactError("Checkpoint input channel order does not match the request")

    contract = payload.get("training_contract")
    if not isinstance(contract, Mapping):
        raise EarthArtifactError("Checkpoint has no training contract")
    if contract.get("target") != EARTH_TARGET_CHANNEL or contract.get("target_unit") != EARTH_TARGET_UNIT:
        raise EarthArtifactError("Checkpoint target must be TO3 in DU")
    if list(contract.get("input_channel_order") or []) != order:
        raise EarthArtifactError("Training contract channel order disagrees with the model")
    if list(contract.get("input_units") or []) != input_units(order):
        raise EarthArtifactError("Training contract input units are inconsistent")
    if contract.get("tensor_layout") != "BTCHW" or contract.get("step_unit") != profile["step_unit"]:
        raise EarthArtifactError("Training contract layout or step unit is unsupported")
    if (int(contract.get("window", -1)), int(contract.get("horizon", -1))) != (profile["window"], profile["horizon"]):
        raise EarthArtifactError("Training contract window/horizon disagrees with its dataset profile")
    if three_hourly:
        expected_fields = {
            "dataset_id": EARTH_DATASET_3HOURLY_ID,
            "profile_id": profile["profile_id"],
            "step": 3, "frequency_hours": 3, "time_zone": "UTC",
            "timestamp_rule": THREE_HOURLY_TIMESTAMP_RULE,
            "time_aggregation": "three_hour_mean", "timestamp_offset_minutes": 90,
            "grid_shape": profile["grid_shape"],
        }
        for key, expected in expected_fields.items():
            if contract.get(key) != expected:
                raise EarthArtifactError(f"Three-hourly training contract {key} is invalid")
    if contract.get("strict_split_windows") is not True:
        raise EarthArtifactError("Training contract must declare strict split windows")
    split_policy = contract.get("split_policy")
    if split_policy not in ("published_manifest_splits", "legacy_compatibility"):
        raise EarthArtifactError("Training contract split policy is unsupported")
    if three_hourly and split_policy != "published_manifest_splits":
        raise EarthArtifactError("Three-hourly checkpoints require published chronological split ranges")
    counts = contract.get("split_window_counts")
    if not isinstance(counts, Mapping) or not counts:
        raise EarthArtifactError("Training contract has no split window counts")
    for name, value in counts.items():
        if int(value) < 1:
            raise EarthArtifactError(f"Split window count for {name} is invalid")
    split_ranges = contract.get("split_ranges")
    if split_policy == "published_manifest_splits":
        if not isinstance(split_ranges, Mapping):
            raise EarthArtifactError("Training contract has no manifest split ranges")
        for name in ("train", "validation", "test"):
            entry = split_ranges.get(name)
            if not isinstance(entry, Mapping):
                raise EarthArtifactError(f"Training contract has no {name} manifest range")
            for key in ("date_start", "date_end", "window_count"):
                if key not in entry:
                    raise EarthArtifactError(f"Training contract {name} range is missing {key}")
            if int(entry["window_count"]) != int(counts.get(name, -1)):
                raise EarthArtifactError(f"Training contract {name} range count disagrees with split count")

    normalization = payload.get("normalization")
    if not isinstance(normalization, Mapping):
        raise EarthArtifactError("Checkpoint has no normalization block")
    validate_normalization(dict(normalization), order)

    binding = payload.get("dataset_binding")
    if not isinstance(binding, Mapping):
        raise EarthArtifactError("Checkpoint has no dataset binding")
    snapshot = binding.get("dataset_snapshot")
    if not isinstance(snapshot, Mapping):
        raise EarthArtifactError("Checkpoint dataset snapshot must be an object")
    if snapshot.get("planet") != "earth":
        raise EarthArtifactError("Checkpoint dataset binding is not an Earth release")
    bound_three_hourly = binding.get("dataset_id") == EARTH_DATASET_3HOURLY_ID
    if bound_three_hourly != three_hourly:
        raise EarthArtifactError("Daily and three-hourly checkpoint schemas cannot cross dataset profiles")
    if binding.get("dataset_id") != snapshot.get("dataset_id"):
        raise EarthArtifactError("Checkpoint dataset id disagrees with its snapshot")
    if binding.get("dataset_fingerprint") != snapshot.get("dataset_fingerprint"):
        raise EarthArtifactError("Checkpoint fingerprint disagrees with its snapshot")
    grid = snapshot.get("grid")
    if not isinstance(grid, Mapping):
        raise EarthArtifactError("Checkpoint snapshot has no grid")
    grid_shape = [int(value) for value in (grid.get("shape") or [])]
    if grid_shape != [height, width]:
        raise EarthArtifactError("Checkpoint grid shape disagrees with the model config")
    if three_hourly:
        _validate_threehourly_binding(binding, contract, normalization)
    if expected_binding is not None:
        _compare_binding(binding, expected_binding)

    run = payload.get("run")
    if not isinstance(run, Mapping):
        raise EarthArtifactError("Checkpoint has no run record")
    missing = [key for key in RUN_REQUIRED_KEYS if key not in run]
    if missing:
        raise EarthArtifactError(f"Run record is missing {missing[0]}")
    if run.get("run_complete") is not True:
        raise EarthArtifactError("Checkpoint run is not marked complete")
    if three_hourly:
        for key in ("task_id", "best_epoch", "epochs_completed"):
            if type(run.get(key)) is not int or run[key] < 1:
                raise EarthArtifactError(f"Three-hourly run {key} must be a positive integer")
        if run["best_epoch"] > run["epochs_completed"]:
            raise EarthArtifactError("Three-hourly best epoch exceeds the completed epochs")
        if run.get("seed") is not None and (type(run["seed"]) is not int or not 0 <= run["seed"] < 2**32):
            raise EarthArtifactError("Three-hourly run seed is invalid")
        for key in ("optimizer", "loss"):
            if not isinstance(run.get(key), str) or not run[key].strip():
                raise EarthArtifactError(f"Three-hourly run {key} must be a non-empty string")
        for key in ("device", "created_utc"):
            if run.get(key) is not None and not isinstance(run[key], str):
                raise EarthArtifactError(f"Three-hourly run {key} must be a string")
    if expected_task_id is not None and int(run.get("task_id", -1)) != int(expected_task_id):
        raise EarthArtifactError("Checkpoint belongs to a different task")

    metrics = payload.get("metrics")
    expected_metrics_schema = EARTH_3HOURLY_METRICS_SCHEMA if three_hourly else EARTH_METRICS_SCHEMA
    if not isinstance(metrics, Mapping) or metrics.get("schema") != expected_metrics_schema:
        raise EarthArtifactError("Checkpoint has no Earth metrics block")
    if metrics.get("unit") != EARTH_TARGET_UNIT or metrics.get("target") != EARTH_TARGET_CHANNEL:
        raise EarthArtifactError("Checkpoint metrics must be TO3 in DU")
    splits = metrics.get("splits")
    if not isinstance(splits, Mapping) or "test" not in splits or "validation" not in splits:
        raise EarthArtifactError("Checkpoint metrics require validation and test splits")
    if three_hourly:
        for name in ("validation", "test"):
            if not isinstance(splits[name], Mapping) or splits[name].get("window_count") != counts[name]:
                raise EarthArtifactError(f"Three-hourly {name} metric window count disagrees with the contract")
    validated = dict(payload)
    validated["model_state_dict"] = dict(state_dict)
    validated["model_config"] = dict(model_config)
    validated["model_ref"] = dict(model_ref)
    validated["training_contract"] = dict(contract)
    validated["dataset_binding"] = dict(binding)
    validated["run"] = dict(run)
    validated["normalization"] = dict(normalization)
    validated["metrics"] = {
        "schema": metrics["schema"],
        "target": metrics["target"],
        "unit": metrics["unit"],
        "aggregation": metrics.get("aggregation"),
        "splits": {
            name: _validated_split_metrics(splits.get(name), name, metric_dataset_id)
            for name in ("validation", "test")
        },
    }
    return validated


def _validated_split_metrics(metrics: Any, name: str, dataset_id: str | None = None) -> dict:
    """Strictly validate one split's metrics block read back from a checkpoint."""
    if not isinstance(metrics, Mapping):
        raise EarthArtifactError(f"Checkpoint metrics for {name} must be a mapping")
    counts = metrics.get("window_count")
    if isinstance(counts, bool) or not isinstance(counts, int) or counts < 1:
        raise EarthArtifactError(f"Checkpoint {name} window_count is invalid")
    return _checked_split_metrics(metrics, counts, dataset_id)


def _threehour_time(value: Any, label: str) -> np.datetime64:
    if (not isinstance(value, str) or re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", value) is None):
        raise EarthArtifactError(f"Three-hourly {label} must be a UTC timestamp")
    try:
        if not 2020 <= datetime.fromisoformat(value[:-1]).year <= 2021:
            raise ValueError("timestamp outside the published release years")
        parsed = np.datetime64(value.removesuffix("Z"), "ns")
    except (ValueError, TypeError) as exc:
        raise EarthArtifactError(f"Three-hourly {label} timestamp is invalid") from exc
    if np.isnat(parsed):
        raise EarthArtifactError(f"Three-hourly {label} timestamp is invalid")
    return parsed


def _validate_threehourly_binding(binding: Mapping, contract: Mapping, normalization: Mapping) -> None:
    """Keep cadence, chronological ranges and train-only statistics inseparable."""
    snapshot = binding["dataset_snapshot"]
    time = snapshot.get("time") or {}
    if not isinstance(time, Mapping):
        raise EarthArtifactError("Three-hourly checkpoint time must be a mapping")
    if (binding.get("dataset_version") != "v1"
            or snapshot.get("dataset_version") != binding.get("dataset_version")
            or binding.get("dataset_identity_status") != "verified"
            or snapshot.get("frequency_hours") != 3
            or snapshot.get("step_unit") != "hour" or snapshot.get("step") != 3
            or time.get("kind") != "datetime" or time.get("time_zone") != "UTC"
            or time.get("label") != "interval_center"):
        raise EarthArtifactError("Three-hourly checkpoint binding cadence or version is invalid")
    fingerprint = binding.get("dataset_fingerprint")
    if (not isinstance(fingerprint, str) or len(fingerprint) != 64
            or any(char not in "0123456789abcdef" for char in fingerprint)):
        raise EarthArtifactError("Three-hourly checkpoint requires a SHA-256 dataset fingerprint")
    ranges, counts = contract["split_ranges"], contract["split_window_counts"]
    published = snapshot.get("splits") or {}
    if not isinstance(published, Mapping):
        raise EarthArtifactError("Three-hourly checkpoint splits must be a mapping")
    previous_end = None
    for name in ("train", "validation", "test"):
        entry = ranges[name]
        first = _threehour_time(entry["date_start"], f"{name} start")
        last = _threehour_time(entry["date_end"], f"{name} end")
        span = last - first
        if (span < np.timedelta64(0, "h") or span % np.timedelta64(3, "h") != np.timedelta64(0, "h")
                or first - first.astype("datetime64[D]") != np.timedelta64(90, "m")
                or last - last.astype("datetime64[D]") != np.timedelta64(22 * 60 + 30, "m")):
            raise EarthArtifactError(f"Three-hourly {name} range must cover complete UTC days")
        if previous_end is not None and first - previous_end != np.timedelta64(3, "h"):
            raise EarthArtifactError("Three-hourly split ranges must be consecutive and non-overlapping")
        previous_end = last
        step_count = int(span // np.timedelta64(3, "h")) + 1
        if (int(counts[name]) != step_count - 56 - 24 + 1
                or entry.get("window_count") != counts[name]):
            raise EarthArtifactError(f"Three-hourly {name} window count disagrees with its time range")
        split = published.get(name)
        if (not isinstance(split, Mapping) or split.get("steps") != step_count
                or split.get("start") != str(first.astype("datetime64[D]"))
                or split.get("end") != str(last.astype("datetime64[D]"))):
            raise EarthArtifactError(f"Three-hourly {name} range disagrees with the bound manifest")
    for key, expected in {
        "frequency_hours": 3, "step_unit": "hour", "step": 3,
        "time_zone": "UTC", "timestamp_rule": THREE_HOURLY_TIMESTAMP_RULE,
    }.items():
        if normalization.get(key) != expected:
            raise EarthArtifactError(f"Three-hourly normalization {key} is invalid")
    train = ranges["train"]
    for normalization_key, range_key in (("fit_time_start", "date_start"), ("fit_time_end", "date_end")):
        if _threehour_time(normalization.get(normalization_key), normalization_key) != _threehour_time(train[range_key], range_key):
            raise EarthArtifactError("Three-hourly normalization must fit the complete training interval only")
    if normalization.get("fit_step_count") != published["train"]["steps"]:
        raise EarthArtifactError("Three-hourly normalization fitted step count disagrees with the train split")
    if (type(normalization.get("target_channel_index")) is not int
            or normalization["target_channel_index"] != 0
            or type(normalization.get("ddof")) is not int or normalization["ddof"] != 0
            or normalization.get("epsilon") != 1e-6):
        raise EarthArtifactError("Three-hourly normalization target index or population convention is invalid")
    constants = normalization.get("constant_channel_mask")
    if (not isinstance(constants, list) or len(constants) != len(contract["input_channel_order"])
            or any(type(value) is not bool for value in constants)):
        raise EarthArtifactError("Three-hourly normalization constant mask is invalid")


def _compare_binding(binding: Mapping[str, Any], expected: Mapping[str, Any]) -> None:
    for key in ("dataset_id", "dataset_version", "dataset_fingerprint"):
        expected_value = expected.get(key)
        if expected_value is None:
            continue
        if binding.get(key) != expected_value:
            if key == "dataset_fingerprint":
                raise EarthArtifactError(
                    "The artifact was trained on a different dataset release",
                    code="dataset_version_changed",
                )
            raise EarthArtifactError(f"Checkpoint {key} does not match the task")
    expected_snapshot = expected.get("dataset_snapshot")
    if isinstance(expected_snapshot, str):
        try:
            expected_snapshot = json.loads(expected_snapshot)
        except ValueError:
            expected_snapshot = None
    if isinstance(expected_snapshot, Mapping):
        expected_sha = expected_snapshot.get("data_sha256")
        actual_sha = (binding.get("dataset_snapshot") or {}).get("data_sha256")
        if expected_sha and expected_sha != actual_sha:
            raise EarthArtifactError(
                "The artifact was trained on a different dataset release",
                code="dataset_version_changed",
            )


def load_earth_training_artifact(
    path: Any,
    expected_binding: Optional[Mapping[str, Any]] = None,
    expected_hyperparameters: Optional[Mapping[str, Any]] = None,
    expected_task_id: Optional[int] = None,
) -> EarthCheckpoint:
    """Strictly load and validate an Earth checkpoint from disk."""
    artifact_path = Path(path)
    if not artifact_path.is_file():
        raise EarthArtifactError("The Earth checkpoint file is missing")
    try:
        payload = torch.load(artifact_path, map_location="cpu", weights_only=True)
    except EarthArtifactError:
        raise
    except Exception as exc:
        raise EarthArtifactError(f"The Earth checkpoint could not be read: {exc}") from exc
    expected_order = None
    if expected_hyperparameters is not None:
        selected = expected_hyperparameters.get("selected_channels")
        if selected is not None:
            expected_order = canonical_input_channels(selected)
    validated = validate_checkpoint_payload(
        payload,
        expected_binding=expected_binding,
        expected_task_id=expected_task_id,
        expected_channel_order=expected_order,
    )
    if expected_hyperparameters is not None:
        requested_id = expected_hyperparameters.get("training_dataset")
        actual_id = validated["dataset_binding"].get("dataset_id")
        if requested_id == EARTH_DATASET_3HOURLY_ID or actual_id == EARTH_DATASET_3HOURLY_ID:
            if requested_id is not None and requested_id != actual_id:
                raise EarthArtifactError("Checkpoint dataset profile does not match the task")
            for key in ("window", "horizon"):
                requested = expected_hyperparameters.get(key)
                if requested is not None and requested != validated["model_config"][key]:
                    raise EarthArtifactError(f"Checkpoint {key} does not match the task")
            model_ref = validated["model_ref"]
            source = model_ref.get("model_source", MODEL_SOURCE_OFFICIAL)
            if expected_hyperparameters.get("model_source", MODEL_SOURCE_OFFICIAL) != source:
                raise EarthArtifactError("Checkpoint model source does not match the task")
            if source == MODEL_SOURCE_UPLOADED:
                uploaded = model_ref["uploaded_model"]
                for task_key, reference_key in (
                    ("_uploaded_model_id", "package_id"), ("_uploaded_model_version", "version"),
                    ("_uploaded_model_content_hash", "content_hash"), ("custom_model_params", "custom_model_params"),
                ):
                    if task_key in expected_hyperparameters and expected_hyperparameters[task_key] != uploaded[reference_key]:
                        raise EarthArtifactError(f"Checkpoint {reference_key} does not match the task")
    return EarthCheckpoint(
        path=str(artifact_path),
        payload=validated,
        model_config=validated["model_config"],
        model_ref=validated["model_ref"],
        dataset_binding=validated["dataset_binding"],
        training_contract=validated["training_contract"],
        normalization=validated["normalization"],
        run=validated["run"],
        metrics=validated["metrics"],
    )


def build_earth_model_from_checkpoint(
    checkpoint: EarthCheckpoint,
) -> tuple[torch.nn.Module, tuple[str, ...]]:
    """Rebuild the model from the checkpoint and load its weights ``strict=True``.

    Returns ``(model, warnings)``. The official DLinear is rebuilt from its stored
    configuration. An uploaded model is rebuilt by executing the source text the
    checkpoint embedded - after checking the original file is still the verified
    one when it exists - so a missing or tampered file is a reported condition
    rather than a silent rebuild with different code.
    """
    warnings: tuple[str, ...] = ()
    if checkpoint.model_source == MODEL_SOURCE_UPLOADED:
        reference = checkpoint.uploaded_model or {}
        try:
            model, _config, warnings = build_uploaded_earth_model(
                reference=reference,
                input_channel_order=checkpoint.model_config.get("input_channel_order") or [],
                window=int(checkpoint.model_config.get("window", EARTH_WINDOW)),
                horizon=int(checkpoint.model_config.get("horizon", EARTH_HORIZON)),
                height=int(checkpoint.model_config.get("height", 36)),
                width=int(checkpoint.model_config.get("width", 72)),
                dataset_id=checkpoint.dataset_binding.get("dataset_id"),
            )
        except EarthModelBuildError as exc:
            raise EarthArtifactError(str(exc), code=exc.code) from exc
    else:
        model = forecaster_from_config(checkpoint.model_config)
    try:
        model.load_state_dict(checkpoint.payload["model_state_dict"], strict=True)
    except Exception as exc:
        raise EarthArtifactError(
            f"The Earth checkpoint weights do not fit the model: {exc}"
        ) from exc
    model.eval()
    return model, warnings


def verify_earth_model_reload_isolated(path: Any, *, timeout_seconds: float = 30.0) -> None:
    """Check executable checkpoint reload without running uploaded code in the parent."""
    context = multiprocessing.get_context("spawn")
    receive, send = context.Pipe(duplex=False)
    process = context.Process(target=_earth_model_reload_child, args=(str(path), send))
    try:
        process.start()
        send.close()
        process.join(timeout_seconds)
        if process.is_alive():
            process.terminate()
            process.join(1)
            if process.is_alive():
                process.kill()
                process.join(1)
            raise EarthArtifactError("Earth checkpoint model reload timed out")
        if not receive.poll():
            raise EarthArtifactError("Earth checkpoint model reload exited without a result")
        result = receive.recv()
        if not result["ok"]:
            raise EarthArtifactError(result["message"], code=result["code"])
    finally:
        receive.close()
        send.close()
        if process.pid is not None and not process.is_alive():
            process.close()


def _earth_model_reload_child(path: str, connection) -> None:
    try:
        torch.set_num_threads(2)
        checkpoint = load_earth_training_artifact(path)
        _verify_round_trip(Path(path), checkpoint.payload)
        connection.send({"ok": True})
    except Exception as exc:
        connection.send({"ok": False, "message": str(exc),
                         "code": getattr(exc, "code", "invalid_earth_training_artifact")})
    finally:
        connection.close()


# ── atomic save ────────────────────────────────────────────────────────────

def save_earth_artifact_atomic(
    payload: Mapping[str, Any],
    final_path: Any,
    *,
    strict_reload: bool = True,
) -> str:
    """Validate, write to a sibling temporary file, verify and atomically publish.

    The final path is never partially written: a crash leaves either the previous
    file or a ``.partial`` sibling, never a half-serialised checkpoint that would
    later look like a valid Artifact.
    """
    validate_checkpoint_payload(payload)
    target = Path(final_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + ".partial")
    if temporary.exists():
        # One explicit path, owned by this task; never a directory sweep.
        temporary.unlink()
    payload_to_save = {
        **{key: (_plain(value) if key != "model_state_dict" else value) for key, value in payload.items()},
        "model_state_dict": {key: value.detach().to("cpu").clone() for key, value in payload["model_state_dict"].items()},
    }
    try:
        torch.save(payload_to_save, temporary)
        if strict_reload:
            _verify_round_trip(temporary, payload_to_save)
        os.replace(temporary, target)
    except Exception:
        if temporary.exists():
            temporary.unlink()
        raise
    return str(target)


def _verify_round_trip(path: Path, expected: Mapping[str, Any]) -> None:
    """Reload the written file and compare the standardized output bit for bit.

    The reloaded model is compared against an independently constructed model of
    the same source and weights, so a checkpoint that does not reproduce its own
    output is caught before it replaces the published file.
    """
    checkpoint = load_earth_training_artifact(path)
    model, _warnings = build_earth_model_from_checkpoint(checkpoint)
    reference = _reference_model_from_payload(expected)
    window = int(expected["model_config"]["window"])
    channels = int(expected["model_config"]["input_channels"])
    height = int(expected["model_config"]["height"])
    width = int(expected["model_config"]["width"])
    if expected.get("artifact_schema") == EARTH_3HOURLY_ARTIFACT_SCHEMA:
        # Gridpoint temporal weights are independent of spatial tile dimensions.
        height, width = min(height, 24), min(width, 48)
    generator = torch.Generator().manual_seed(20200101)
    probe = torch.randn((2, window, channels, height, width), generator=generator)
    with torch.no_grad():
        first = _forward_payload_model(model, expected, probe)
        second = _forward_payload_model(reference, expected, probe)
    if not torch.equal(first, second):
        raise EarthArtifactError("The written checkpoint does not reproduce its own output")


def _reference_model_from_payload(payload: Mapping[str, Any]) -> torch.nn.Module:
    """Rebuild the model the payload describes, without reading the artifact back."""
    model_ref = payload.get("model_ref") or {}
    if str(model_ref.get("model_source") or MODEL_SOURCE_OFFICIAL) == MODEL_SOURCE_UPLOADED:
        reference = model_ref.get("uploaded_model") or {}
        model, _config, _warnings = build_uploaded_earth_model(
            reference=reference,
            input_channel_order=payload["model_config"].get("input_channel_order") or [],
            window=int(payload["model_config"].get("window", EARTH_WINDOW)),
            horizon=int(payload["model_config"].get("horizon", EARTH_HORIZON)),
            height=int(payload["model_config"].get("height", 36)),
            width=int(payload["model_config"].get("width", 72)),
            dataset_id=(
                EARTH_DATASET_3HOURLY_ID
                if payload.get("artifact_schema") == EARTH_3HOURLY_ARTIFACT_SCHEMA
                else None
            ),
        )
    else:
        model = forecaster_from_config(payload["model_config"])
    model.load_state_dict(payload["model_state_dict"], strict=True)
    model.eval()
    return model


def _forward_payload_model(
    model: torch.nn.Module, payload: Mapping[str, Any], probe: torch.Tensor
) -> torch.Tensor:
    """Run one model from a payload descriptor through the shared Earth interface."""
    model_ref = payload.get("model_ref") or {}
    model_source = str(model_ref.get("model_source") or MODEL_SOURCE_OFFICIAL)
    return earth_forward_for_model(
        model, probe, model_source=model_source,
        horizon=int(payload["model_config"]["horizon"]),
        height=int(probe.shape[-2]), width=int(probe.shape[-1]),
    )


def normalization_from_release(release, input_channel_order: Sequence[str]) -> dict:
    """Fit the published training normalization for a verified release."""
    order = require_earth_channel_order(input_channel_order)
    if release.metadata.get("dataset_id") == EARTH_DATASET_3HOURLY_ID:
        from services.earth_dataset import fit_threehour_normalization
        return fit_threehour_normalization(release, order)
    dates = np.asarray(release.dates, dtype="datetime64[D]")
    splits = (release.metadata.get("splits") or {})
    train = splits.get("train") or {}
    start = np.datetime64(str(train.get("start")), "D")
    end = np.datetime64(str(train.get("end")), "D")
    mask = (dates >= start) & (dates <= end)
    if not mask.any():
        raise EarthArtifactError("The release has no training dates to fit normalization on")
    cube = np.stack([np.asarray(release.fields[name], dtype="float32") for name in CHANNELS], axis=1)
    return fit_normalization(cube[mask], order, fit_dates=dates[mask])


def assert_release_matches_binding(release, binding: Mapping[str, Any]) -> None:
    """Fail when a verified release is not the release a task was bound to."""
    metadata = release.metadata
    fingerprint = binding.get("dataset_fingerprint")
    if fingerprint and fingerprint != metadata.get("dataset_fingerprint"):
        raise EarthArtifactError(
            "The dataset release changed since the task was created",
            code="dataset_version_changed",
        )
    version = binding.get("dataset_version")
    if version and version != metadata.get("dataset_version"):
        raise EarthArtifactError(
            "The dataset release version changed since the task was created",
            code="dataset_version_changed",
        )
    if binding.get("dataset_id") and binding["dataset_id"] != metadata.get("dataset_id"):
        raise EarthArtifactError("The dataset identity changed since the task was created")


def available_origin_range(
    release,
    *,
    window: int = EARTH_WINDOW,
    horizon: int = EARTH_HORIZON,
) -> dict:
    """Return the legal historical forecast origins and their three target dates.

    An origin is legal only when a full input window exists before it and a full
    reference window exists after it, both inside the published release. This is
    why future dates without published truth are not offered at all.
    """
    _require_daily_prediction_release(release)
    dates = np.asarray(release.dates, dtype="datetime64[D]")
    # A sample owns input indices [origin - window + 1, origin] and target
    # indices [origin + 1, origin + horizon], so the first legal origin sits at
    # index ``window - 1`` and the last one at
    # ``len(dates) - horizon - 1``.
    first = int(window - 1)
    last = int(len(dates) - horizon - 1)
    if last < first:
        raise EarthArtifactError("The release is too short for the Earth forecast contract")
    origins = dates[first:last + 1]
    return {
        "start": str(origins[0]),
        "end": str(origins[-1]),
        "count": int(len(origins)),
        "dates": [str(value) for value in origins],
        "window": int(window),
        "horizon": int(horizon),
        "input_offset_days": -int(window - 1),
        "target_offset_days": 1,
    }


def forecast_dates(release, origin: str, horizon: int = EARTH_HORIZON) -> list[str]:
    """Return the ``horizon`` consecutive target dates after ``origin``."""
    _require_daily_prediction_release(release)
    dates = np.asarray(release.dates, dtype="datetime64[D]")
    matches = np.flatnonzero(dates == np.datetime64(origin, "D"))
    if matches.size == 0:
        raise EarthArtifactError(
            "The forecast origin is not a date in the published dataset",
            code="invalid_earth_prediction_origin",
        )
    index = int(matches[0])
    if index + int(horizon) >= len(dates):
        raise EarthArtifactError(
            "The forecast origin has no published reference days after it",
            code="earth_prediction_origin_out_of_range",
        )
    if index < EARTH_WINDOW - 1:
        raise EarthArtifactError(
            "The forecast origin has no complete input window before it",
            code="earth_prediction_origin_out_of_range",
        )
    return [str(value) for value in dates[index + 1:index + 1 + int(horizon)]]


def origin_split(release, origin: str) -> str:
    """Return the published train/validation/test split containing an origin."""
    _require_daily_prediction_release(release)
    dates = np.asarray(release.dates, dtype="datetime64[D]")
    matches = np.flatnonzero(dates == np.datetime64(origin, "D"))
    if matches.size == 0:
        raise EarthArtifactError(
            "The forecast origin is not a date in the published dataset",
            code="invalid_earth_prediction_origin",
        )
    codes = release_split_codes(dates, release.metadata)
    labels = {0: "train", 1: "validation", 2: "test"}
    return labels[int(codes[int(matches[0])])]


def _require_daily_prediction_release(release) -> None:
    if (getattr(release, "metadata", None) or {}).get("dataset_id") == EARTH_DATASET_3HOURLY_ID:
        raise EarthArtifactError(
            "Three-hourly datetime prediction is not available through the daily date interface",
            code="dataset_prediction_not_supported",
        )


def _threehour_prediction_times(release) -> np.ndarray:
    """Keep timestamp indexing separate from the retained date-only interface."""
    metadata = getattr(release, "metadata", None) or {}
    time_metadata = metadata.get("time") or {}
    if (metadata.get("dataset_id") != EARTH_DATASET_3HOURLY_ID
            or metadata.get("frequency_hours") != 3
            or metadata.get("step_unit") != "hour" or metadata.get("step") != 3
            or time_metadata.get("kind") != "datetime"
            or time_metadata.get("time_zone") != "UTC"
            or time_metadata.get("label") != THREE_HOURLY_TIMESTAMP_RULE):
        raise EarthArtifactError("Prediction requires the fixed three-hour UTC interval-centre release")
    try:
        times = np.asarray(release.dates, dtype="datetime64[ns]")
    except (TypeError, ValueError, OverflowError) as exc:
        raise EarthArtifactError("The three-hour prediction time axis is invalid") from exc
    if (times.ndim != 1 or not len(times) or np.isnat(times).any()
            or np.any(np.diff(times) != np.timedelta64(3, "h"))
            or np.any((times - times.astype("datetime64[D]")) % np.timedelta64(3, "h")
                      != np.timedelta64(90, "m"))):
        raise EarthArtifactError("Prediction timestamps must be unique, continuous three-hour UTC interval centres")
    return times


def _threehour_iso_utc(timestamp) -> str:
    return np.datetime_as_string(np.datetime64(timestamp, "s"), unit="s") + "Z"


def _parse_threehour_origin(origin: str) -> np.datetime64:
    """Accept explicit UTC ISO timestamps and preserve subsecond precision."""
    if (not isinstance(origin, str) or re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)",
            origin) is None):
        raise EarthArtifactError(
            "forecast_origin must be an ISO datetime with an explicit UTC Z or +00:00 offset",
            code="invalid_earth_prediction_origin",
        )
    literal = origin[:-1] if origin.endswith("Z") else origin[:-6]
    try:
        # datetime rejects impossible calendar values; NumPy retains nanoseconds
        # so a fractional timestamp cannot silently match a whole-second sample.
        parsed = datetime.fromisoformat(literal)
        if not 2020 <= parsed.year <= 2021:
            raise EarthArtifactError("Origin is outside the published release years",
                                     code="earth_prediction_origin_out_of_range")
        return np.datetime64(literal, "ns")
    except EarthArtifactError:
        raise
    except (TypeError, ValueError, OverflowError) as exc:
        raise EarthArtifactError(
            "The forecast origin is not a valid UTC timestamp in the published release",
            code="invalid_earth_prediction_origin",
        ) from exc


def threehour_available_origin_range(release, *, strict_split=False) -> dict:
    """Offer every centre with 56 inputs ending at it and 24 following truths.

    Backtesting uses the complete release; the origin's published split remains
    a label and does not restrict historical selection to the test partition.
    """
    times = _threehour_prediction_times(release)
    first = EARTH_3HOURLY_WINDOW - 1
    stop = len(times) - EARTH_3HOURLY_HORIZON
    if stop <= first:
        raise EarthArtifactError(
            "The release has no origin with complete 56-step inputs and 24-step references",
            code="earth_prediction_origin_out_of_range",
        )
    indices = range(first, stop)
    if strict_split:
        codes = threehour_release_split_codes(release.dates, release.metadata)
        indices = [i for i in indices if np.all(codes[i - 55:i + 25] == codes[i])]
    timestamps = [_threehour_iso_utc(times[i]) for i in indices]
    if not timestamps:
        raise EarthArtifactError("No complete windows within the published splits", code="earth_prediction_origin_out_of_range")
    return {
        "kind": "datetime", "time_zone": "UTC", "frequency_hours": 3,
        "step_unit": "hour", "step": 3,
        "start": timestamps[0], "end": timestamps[-1], "count": len(timestamps),
        "dates": timestamps, "timestamps": timestamps,
        "window": EARTH_3HOURLY_WINDOW, "horizon": EARTH_3HOURLY_HORIZON,
        "input_offset_hours": -(EARTH_3HOURLY_WINDOW - 1) * 3,
        "target_offset_hours": 3,
    }


def threehour_origin_index(release, origin: str, *, strict_split=False) -> int:
    """Resolve a UTC origin without rounding to a day or a nearby sample."""
    times = _threehour_prediction_times(release)
    target = _parse_threehour_origin(origin)
    matches = np.flatnonzero(times == target)
    if matches.size != 1:
        subsecond = target - target.astype("datetime64[s]")
        seconds = int((target - target.astype("datetime64[m]")) / np.timedelta64(1, "s"))
        raise EarthArtifactError(
            "The forecast origin is not a timestamp in the published dataset",
            code=("invalid_earth_prediction_origin" if seconds or subsecond != np.timedelta64(0, "ns")
                  else "earth_prediction_origin_out_of_range"),
        )
    index = int(matches[0])
    if index < EARTH_3HOURLY_WINDOW - 1 or index + EARTH_3HOURLY_HORIZON >= len(times):
        raise EarthArtifactError(
            "The forecast origin has no complete 56-step input and 24-step reference window",
            code="earth_prediction_origin_out_of_range",
        )
    if strict_split:
        codes = threehour_release_split_codes(release.dates, release.metadata)
        if not np.all(codes[index - 55:index + 25] == codes[index]):
            raise EarthArtifactError("The uploaded model window crosses a published split",
                                     code="earth_prediction_origin_out_of_range")
    return index


def threehour_forecast_timestamps(release, origin: str) -> list[str]:
    """Return the 24 exact target centres at +3 through +72 hours."""
    index = threehour_origin_index(release, origin)
    times = _threehour_prediction_times(release)
    return [_threehour_iso_utc(value)
            for value in times[index + 1:index + 1 + EARTH_3HOURLY_HORIZON]]


def threehour_origin_split(release, origin: str) -> str:
    """Label the selected UTC origin using the verified release's split blocks."""
    index = threehour_origin_index(release, origin)
    try:
        codes = threehour_release_split_codes(release.dates, release.metadata)
    except (TypeError, ValueError) as exc:
        raise EarthArtifactError("The published three-hour split contract is invalid") from exc
    return {0: "train", 1: "validation", 2: "test"}[int(codes[index])]


__all__ = [
    "EarthArtifactError",
    "EarthCheckpoint",
    "ErrorAccumulator",
    "LEAD_DAYS",
    "assert_release_matches_binding",
    "available_origin_range",
    "build_checkpoint_payload",
    "build_earth_model_from_checkpoint",
    "build_metrics_block",
    "build_model_reference",
    "compute_earth_metrics",
    "forecast_dates",
    "load_earth_training_artifact",
    "normalization_from_release",
    "origin_split",
    "save_earth_artifact_atomic",
    "validate_checkpoint_payload",
    "threehour_available_origin_range",
    "threehour_forecast_timestamps",
    "threehour_origin_index",
    "threehour_origin_split",
]
