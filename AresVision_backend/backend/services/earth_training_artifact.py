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
import os
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
    validate_normalization,
)
from services.earth_training_contract import (
    EARTH_ARTIFACT_SCHEMA,
    EARTH_HORIZON,
    EARTH_IMPLEMENTATION_ID,
    EARTH_METRICS_SCHEMA,
    EARTH_TARGET_CHANNEL,
    EARTH_TARGET_UNIT,
    EARTH_UPLOADED_ARCHITECTURE,
    EARTH_WINDOW,
)
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

def compute_earth_metrics(predictions_du, targets_du) -> dict:
    """Return overall and per-lead RMSE/MAE in DU for ``[N, 3, 1, H, W]`` arrays.

    Every ``(forecast origin, lead day, grid cell)`` contributes equally, so the
    numbers are grid-uniform spatial errors, never an area-weighted global mean.
    """
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

    def __init__(self) -> None:
        self._squared = np.zeros(len(LEAD_DAYS), dtype="float64")
        self._absolute = np.zeros(len(LEAD_DAYS), dtype="float64")
        self._counts = np.zeros(len(LEAD_DAYS), dtype="float64")

    def update(self, predictions_du, targets_du) -> None:
        prediction = np.asarray(predictions_du, dtype="float64")
        target = np.asarray(targets_du, dtype="float64")
        if prediction.shape != target.shape or prediction.ndim != 5:
            raise EarthArtifactError("Accumulated batches must be [N, 3, 1, lat, lon]")
        if not np.isfinite(prediction).all() or not np.isfinite(target).all():
            raise EarthArtifactError("Metrics require finite predictions and references")
        error = prediction - target
        for index in range(min(len(LEAD_DAYS), prediction.shape[1])):
            lead_error = error[:, index]
            self._squared[index] += float((lead_error ** 2).sum())
            self._absolute[index] += float(np.abs(lead_error).sum())
            self._counts[index] += float(lead_error.size)

    def result(self) -> dict:
        if not np.all(self._counts > 0):
            raise EarthArtifactError("No valid samples were accumulated")
        by_lead = [
            {
                "lead_day": int(lead_day),
                "rmse": math.sqrt(float(self._squared[index] / self._counts[index])),
                "mae": float(self._absolute[index] / self._counts[index]),
            }
            for index, lead_day in enumerate(LEAD_DAYS)
        ]
        total = float(self._counts.sum())
        squared = float(self._squared.sum())
        absolute = float(self._absolute.sum())
        return {
            "overall": {"rmse": math.sqrt(squared / total), "mae": absolute / total},
            "by_lead": by_lead,
        }


def build_metrics_block(
    *,
    validation: Mapping[str, Any],
    test: Mapping[str, Any],
    validation_window_count: int,
    test_window_count: int,
) -> dict:
    """Assemble the persisted metrics block for one training run.

    The window count lives inside each split so a loaded checkpoint is
    self-describing: a reader never has to guess how many forecast origins the
    numbers were aggregated over.
    """
    block = {
        "schema": EARTH_METRICS_SCHEMA,
        "target": EARTH_TARGET_CHANNEL,
        "unit": EARTH_TARGET_UNIT,
        "aggregation": "forecast_origin_lead_grid_uniform",
        "splits": {
            "validation": _checked_split_metrics(validation, validation_window_count),
            "test": _checked_split_metrics(test, test_window_count),
        },
    }
    return block


def _checked_split_metrics(metrics: Mapping[str, Any], window_count: int) -> dict:
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
        "implementation_id": uploaded_model.get("package_id"),
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
    task_id: Optional[int] = None,
    model_source: str = MODEL_SOURCE_OFFICIAL,
    uploaded_model: Optional[Mapping[str, Any]] = None,
) -> dict:
    """Assemble the complete checkpoint payload as plain, serialisable data."""
    order = require_earth_channel_order(input_channel_order)
    binding = _binding_payload(dataset_binding)
    contract = {
        "target": EARTH_TARGET_CHANNEL,
        "target_unit": EARTH_TARGET_UNIT,
        "input_channel_order": order,
        "input_units": input_units(order),
        "tensor_layout": "BTCHW",
        "step_unit": "day",
        "window": EARTH_WINDOW,
        "horizon": EARTH_HORIZON,
        "strict_split_windows": True,
        "split_window_counts": {str(key): int(value) for key, value in dict(split_window_counts).items()},
    }
    run_block = {str(key): _plain(value) for key, value in dict(run).items()}
    resolved_task_id = int(task_id if task_id is not None else run_block.get("task_id", 0))
    run_block["task_id"] = resolved_task_id
    model_config = earth_model_config(
        order, linear_hidden_layers, implementation_id=EARTH_IMPLEMENTATION_ID
    )
    model_ref = build_model_reference(
        model_source=model_source,
        model_config=model_config,
        uploaded_model=uploaded_model,
    )
    payload = {
        "artifact_schema": EARTH_ARTIFACT_SCHEMA,
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
    if isinstance(value, np.generic):
        return _plain(value.item())
    if isinstance(value, np.ndarray):
        return [_plain(item) for item in value.tolist()]
    if isinstance(value, np.datetime64):
        return str(value.astype("datetime64[D]"))
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
    if payload.get("artifact_schema") != EARTH_ARTIFACT_SCHEMA:
        raise EarthArtifactError("Unsupported Earth checkpoint schema")

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
        EARTH_WINDOW, EARTH_HORIZON,
    ):
        raise EarthArtifactError("model_config must fix window=7 and horizon=3")
    height, width = int(model_config.get("height", -1)), int(model_config.get("width", -1))
    if height < 1 or width < 1:
        raise EarthArtifactError("model_config grid shape is invalid")
    hidden_layers = int((model_config.get("architecture_params") or {}).get("linear_hidden_layers", 2))
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
    if contract.get("tensor_layout") != "BTCHW" or contract.get("step_unit") != "day":
        raise EarthArtifactError("Training contract layout or step unit is unsupported")
    if (int(contract.get("window", -1)), int(contract.get("horizon", -1))) != (EARTH_WINDOW, EARTH_HORIZON):
        raise EarthArtifactError("Training contract must fix window=7 and horizon=3")
    if contract.get("strict_split_windows") is not True:
        raise EarthArtifactError("Training contract must declare strict split windows")
    counts = contract.get("split_window_counts")
    if not isinstance(counts, Mapping) or not counts:
        raise EarthArtifactError("Training contract has no split window counts")
    for name, value in counts.items():
        if int(value) < 1:
            raise EarthArtifactError(f"Split window count for {name} is invalid")

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
    if expected_task_id is not None and int(run.get("task_id", -1)) != int(expected_task_id):
        raise EarthArtifactError("Checkpoint belongs to a different task")

    metrics = payload.get("metrics")
    if not isinstance(metrics, Mapping) or metrics.get("schema") != EARTH_METRICS_SCHEMA:
        raise EarthArtifactError("Checkpoint has no Earth metrics block")
    if metrics.get("unit") != EARTH_TARGET_UNIT or metrics.get("target") != EARTH_TARGET_CHANNEL:
        raise EarthArtifactError("Checkpoint metrics must be TO3 in DU")
    splits = metrics.get("splits")
    if not isinstance(splits, Mapping) or "test" not in splits or "validation" not in splits:
        raise EarthArtifactError("Checkpoint metrics require validation and test splits")
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
            name: _validated_split_metrics(splits.get(name), name)
            for name in ("validation", "test")
        },
    }
    return validated


def _validated_split_metrics(metrics: Any, name: str) -> dict:
    """Strictly validate one split's metrics block read back from a checkpoint."""
    if not isinstance(metrics, Mapping):
        raise EarthArtifactError(f"Checkpoint metrics for {name} must be a mapping")
    counts = metrics.get("window_count")
    if isinstance(counts, bool) or not isinstance(counts, int) or counts < 1:
        raise EarthArtifactError(f"Checkpoint {name} window_count is invalid")
    return _checked_split_metrics(metrics, counts)


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
    return earth_forward_for_model(model, probe, model_source=model_source)


def normalization_from_release(release, input_channel_order: Sequence[str]) -> dict:
    """Fit the published training normalization for a verified release."""
    order = require_earth_channel_order(input_channel_order)
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
    dates = np.asarray(release.dates, dtype="datetime64[D]")
    # A sample owns input indices [i, i + window - 1] and target indices
    # [i + window, i + window + horizon - 1], so the forecast origin of the first
    # legal sample sits at index ``window`` and the last one at
    # ``len(dates) - horizon - 1``.
    first = int(window)
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
    "save_earth_artifact_atomic",
    "validate_checkpoint_payload",
]
