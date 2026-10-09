"""Bounded, reproducible post-training diagnostics on a task's Earth test split.

Only one spatial tile and a bounded set of input windows are resident at once.
Physical metrics and the residual histogram cover every lead/grid element of
the selected test windows. Scatter points are a further bounded sample. Saved
full-test checkpoint metrics remain explicitly separate from both samples.
The HTTP layer must invoke this synchronous service inside its compute gate.
"""

from __future__ import annotations

from collections import OrderedDict
from contextlib import contextmanager
import copy
import hashlib
import json
import math
import threading
from typing import Any

import numpy as np
import torch
import xarray as xr

from services.dataset_identity import DatasetRequestError, EARTH_DATASET_3HOURLY_ID
from services.earth_dataset import (
    EarthThreeHourlyWindows, _threehour_path, _threehour_values, validate_normalization,
)
from services.earth_model_source import EarthModelBuildError, earth_forward_for_model
from services.earth_prediction_service import (
    _load_checkpoint, _model_source_warnings, _require_completed_earth_task,
    _sync_release, _threehour_checkpoint_sha, _validate_checkpoint_split_ranges,
)
from services.earth_training_artifact import (
    EarthArtifactError, ErrorAccumulator, METRIC_POLICY, METRIC_UNITS,
    build_earth_model_from_checkpoint,
)
from services.netcdf_read_lock import netcdf_read_lock
from services.uploaded_model_source import UploadedModelSourceError

DIAGNOSTIC_VERSION = "earth_test_diagnostics_v1"
DEFAULT_SAMPLE_WINDOWS = 4
MAX_SAMPLE_WINDOWS = 8
DEFAULT_SCATTER_POINTS = 5000
MAX_SCATTER_POINTS = 20000
DEFAULT_SEED = 42
DEFAULT_PFI_REPEATS = 3
MAX_PFI_REPEATS = 5
MAX_PFI_WINDOWS = 8
TILE_SHAPE = (24, 48)
BATCH_SIZE = 2
RESIDUAL_DEFINITION = "prediction-reference"


def _error(code: str, message: str, status: int = 409):
    return DatasetRequestError(code, message, status_code=status)


def _integer(name, value, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        raise _error("invalid_earth_diagnostic_parameters",
                     f"{name} must be an integer between {minimum} and {maximum}", 422)
    return value


def select_window_indices(available: int, requested: int, seed: int) -> list[int]:
    """Uniform, sorted, seeded sample without replacement; never expand windows."""
    if available < 1:
        raise _error("earth_diagnostics_no_valid_windows", "The task test partition has no complete windows")
    return sorted(int(value) for value in np.random.default_rng(seed).choice(
        available, min(available, requested), replace=False))


def permutation_mappings(window_count: int, repeats: int, seed: int) -> list[list[int]]:
    """Random cycles are derangements: every window receives another whole window.

    Generate once per request and reuse across channels and all spatial tiles.
    A cyclic permutation avoids identity draws, including with just two windows.
    """
    if window_count < 2:
        return []
    rng = np.random.default_rng(seed)
    mappings = []
    for _ in range(repeats):
        cycle = rng.permutation(window_count)
        mapping = np.empty(window_count, dtype="int64")
        mapping[cycle] = np.roll(cycle, -1)
        mappings.append(mapping.tolist())
    return mappings


class EarthDiagnosticsCache:
    """Process-local bounded JSON snapshots; callers receive independent copies."""

    def __init__(self, max_entries=8, max_bytes=16 * 1024 * 1024):
        self.max_entries, self.max_bytes = max_entries, max_bytes
        self._entries = OrderedDict()
        self._bytes = 0
        self._lock = threading.RLock()

    def get(self, key):
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            self._entries.move_to_end(key)
            return copy.deepcopy(entry[0])

    def put(self, key, result):
        size = len(json.dumps(result, allow_nan=False).encode("utf-8"))
        if self.max_entries < 1 or size > self.max_bytes:
            return
        with self._lock:
            prior = self._entries.pop(key, None)
            if prior is not None:
                self._bytes -= prior[1]
            self._entries[key] = (copy.deepcopy(result), size)
            self._bytes += size
            while self._entries and (len(self._entries) > self.max_entries or self._bytes > self.max_bytes):
                _, (_, removed) = self._entries.popitem(last=False)
                self._bytes -= removed

    def clear(self):
        with self._lock:
            self._entries.clear()
            self._bytes = 0


EARTH_DIAGNOSTICS_CACHE = EarthDiagnosticsCache()


def build_earth_diagnostics_cache_key(*, task_id, checkpoint_sha256, dataset_binding,
                                     training_contract, normalization, model_identity,
                                     selected_indices, parameters):
    identity = {
        "algorithm": DIAGNOSTIC_VERSION, "planet": "earth", "task_id": int(task_id),
        "checkpoint_sha256": checkpoint_sha256,
        "dataset": dataset_binding, "model": model_identity,
        "test_split": {"policy": training_contract.get("split_policy"),
                       "task_split": training_contract.get("task_split"),
                       "range": training_contract["split_ranges"]["test"]},
        "window": training_contract["window"], "horizon": training_contract["horizon"],
        "channels": training_contract["input_channel_order"], "normalization": normalization,
        "selected_indices": list(selected_indices), "parameters": parameters,
        "tile_shape": list(TILE_SHAPE), "batch_size": BATCH_SIZE,
        "metric_policy": METRIC_POLICY,
    }
    encoded = json.dumps(identity, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _utc(timestamp):
    return np.datetime_as_string(np.datetime64(timestamp, "s"), unit="s") + "Z"


def _scope(dataset, selected, *, seed, name="sampled_test_windows"):
    release = dataset._release
    starts = [dataset._offset + index for index in selected]
    origin_indices = [start + dataset.window - 1 for start in starts]
    times = np.asarray(release.dates, dtype="datetime64[ns]")
    windows = [{"test_window_index": index, "raw_start": start,
                "forecast_origin": _utc(times[origin]),
                "input_start": _utc(times[start]), "input_end": _utc(times[origin]),
                "target_start": _utc(times[origin + 1]),
                "target_end": _utc(times[origin + dataset.horizon])}
               for index, start, origin in zip(selected, starts, origin_indices)]
    points = len(selected) * dataset.horizon * len(dataset.lat) * len(dataset.lon)
    return {
        "name": name, "split": "test", "window_count": len(selected),
        "available_window_count": len(dataset), "window": dataset.window, "horizon": dataset.horizon,
        "windows": windows, "selected_window_indices": list(selected),
        "time_range": {"input_start": windows[0]["input_start"], "input_end": windows[-1]["input_end"],
                       "target_start": windows[0]["target_start"], "target_end": windows[-1]["target_end"],
                       "origin_start": windows[0]["forecast_origin"], "origin_end": windows[-1]["forecast_origin"]},
        "time_zone": "UTC", "frequency_hours": 3,
        "grid_shape": [len(dataset.lat), len(dataset.lon)],
        "spatial_coverage": {"coverage": "global", "all_grid_cells": True,
                             "latitude_range": [float(dataset.lat[0]), float(dataset.lat[-1])],
                             "longitude_range": [float(dataset.lon[0]), float(dataset.lon[-1])],
                             "grid_cells_per_lead": len(dataset.lat) * len(dataset.lon)},
        "valid_points": points, "expected_points": points,
        "sampling": {"method": "seeded_uniform_windows_without_replacement",
                     "seed": seed, "ordering": "chronological", "selected_indices": list(selected),
                     "spatial": "all_grid_cells", "leads": "all_configured_leads",
                     "maximum_windows": MAX_SAMPLE_WINDOWS, "missing_value_policy": "reject"},
        "aggregation": "forecast_origin_lead_grid_uniform",
    }


@contextmanager
def _open_verified_dataset(release):
    """All netCDF operations share the project's process-wide read lock."""
    path = _threehour_path(release)
    with netcdf_read_lock():
        ds = xr.open_dataset(path, engine="netcdf4", mask_and_scale=False)
    try:
        with netcdf_read_lock():
            if (not np.array_equal(ds.time.values, release.dates)
                    or not np.array_equal(ds.lat.values, release.latitude)
                    or not np.array_equal(ds.lon.values, release.longitude)):
                raise _error("dataset_version_changed", "Earth diagnostic coordinates or timestamps changed")
        yield ds
    finally:
        with netcdf_read_lock():
            ds.close()


def _read_tile(ds, dataset, selected, lat, lon):
    """Read at most one tile, with raw TO3 targets and task-normalized inputs."""
    _threehour_path(dataset._release)
    height, width = min(TILE_SHAPE[0], len(dataset.lat) - lat), min(TILE_SHAPE[1], len(dataset.lon) - lon)
    spatial = {"lat_slice": slice(lat, lat + height), "lon_slice": slice(lon, lon + width)}
    order = dataset.input_channels
    mean, scale = validate_normalization(dataset.normalization, order)
    inputs = np.empty((len(selected), dataset.window, len(order), height, width), dtype="float32")
    reference = np.empty((len(selected), dataset.horizon, 1, height, width), dtype="float32")
    with netcdf_read_lock():
        for row, index in enumerate(selected):
            first = dataset._offset + index
            forecast, stop = first + dataset.window, first + dataset.window + dataset.horizon
            for channel_index, channel in enumerate(order):
                for start in range(first, forecast, 8):
                    end = min(start + 8, forecast)
                    values = _threehour_values(ds, channel, start, end, **spatial)
                    with np.errstate(over="ignore", invalid="ignore"):
                        inputs[row, start - first:end - first, channel_index] = (
                            (values.astype("float64") - mean[channel_index]) / scale[channel_index]).astype("float32")
            for start in range(forecast, stop, 8):
                end = min(start + 8, stop)
                reference[row, start - forecast:end - forecast, 0] = _threehour_values(ds, "TO3", start, end, **spatial)
    if not np.isfinite(inputs).all() or not np.isfinite(reference).all():
        raise _error("earth_diagnostics_non_finite_data", "Earth diagnostic input or reference contains non-finite values")
    return inputs, reference


def _predict_tile(model, inputs, checkpoint, device):
    output = earth_forward_for_model(
        model, torch.from_numpy(np.ascontiguousarray(inputs)).to(device),
        model_source=checkpoint.model_source, horizon=checkpoint.training_contract["horizon"],
        height=inputs.shape[-2], width=inputs.shape[-1],
    )
    expected = (len(inputs), checkpoint.training_contract["horizon"], 1, *inputs.shape[-2:])
    if not isinstance(output, torch.Tensor) or tuple(output.shape) != expected or not torch.isfinite(output).all():
        raise _error("invalid_earth_training_artifact", "Earth diagnostic model output has invalid shape or non-finite values")
    index = checkpoint.training_contract["input_channel_order"].index("TO3")
    with np.errstate(over="ignore", invalid="ignore"):
        prediction = output.detach().cpu().numpy().astype("float64") * float(checkpoint.normalization["scale"][index])
        prediction += float(checkpoint.normalization["mean"][index])
    if not np.isfinite(prediction).all():
        raise _error("invalid_earth_training_artifact", "Earth diagnostic model produced non-finite DU values")
    return prediction


def _tile_batches(ds, dataset, selected, model, checkpoint, device):
    for lat in range(0, len(dataset.lat), TILE_SHAPE[0]):
        for lon in range(0, len(dataset.lon), TILE_SHAPE[1]):
            for offset in range(0, len(selected), BATCH_SIZE):
                indices = selected[offset:offset + BATCH_SIZE]
                inputs, reference = _read_tile(ds, dataset, indices, lat, lon)
                prediction = _predict_tile(model, inputs, checkpoint, device)
                yield offset, lat, lon, prediction, reference


class _ScatterSampler:
    """Select uniformly spaced, seeded global stream positions in bounded memory.

    Point identity is the deterministic tile/batch/N/lead/lat/lon iteration order.
    Sorted positions permit every batch to be sampled by vectorized search.
    """

    def __init__(self, total, maximum, seed):
        self.total = total
        count = min(total, maximum)
        rng = np.random.default_rng(seed)
        # One random point in each disjoint equal-size stream stratum.
        starts = np.arange(count, dtype="int64") * total // count
        ends = (np.arange(count, dtype="int64") + 1) * total // count
        self.positions = starts + np.floor(rng.random(count) * (ends - starts)).astype("int64")
        self.offset = 0
        self.prediction, self.reference = [], []
        self.bounds = [math.inf, -math.inf]

    def update(self, prediction, reference):
        pred, truth = prediction.reshape(-1), reference.reshape(-1)
        begin = int(np.searchsorted(self.positions, self.offset, side="left"))
        end = int(np.searchsorted(self.positions, self.offset + pred.size, side="left"))
        local = self.positions[begin:end] - self.offset
        self.prediction.extend(float(value) for value in pred[local])
        self.reference.extend(float(value) for value in truth[local])
        self.bounds[0] = min(self.bounds[0], float(pred.min()), float(truth.min()))
        self.bounds[1] = max(self.bounds[1], float(pred.max()), float(truth.max()))
        self.offset += pred.size

    def result(self, seed):
        if self.offset != self.total or len(self.prediction) != len(self.positions):
            raise _error("earth_diagnostics_incomplete", "Scatter sampling did not cover its declared stream")
        return {"reference": self.reference, "prediction": self.prediction, "point_count": len(self.positions),
                "unit": "DU", "x_label": "Reference TO3 (DU)", "y_label": "Prediction TO3 (DU)",
                "reference_line": {"x": list(self.bounds), "y": list(self.bounds), "label": "y=x"},
                "scope": "sampled_points_from_selected_test_windows", "metric_scope": "selected_test_windows_all_grid_leads",
                "metrics_scope": "selected_test_windows_all_grid_leads",
                "sampling": {"method": "seeded_stratified_stream_positions", "seed": seed,
                             "stream_order": "tile_lat_tile_lon_batch_window_lead_lat_lon",
                             "maximum_points": len(self.positions), "population_points": self.total,
                             "stream_positions": self.positions.tolist()}}


def _full_test_metrics(checkpoint):
    test = copy.deepcopy((checkpoint.metrics.get("splits") or {}).get("test"))
    # Existing checkpoint loading enforces the v1/v2 metrics contract; v1 missing
    # metrics remain absent rather than being derived from sampled diagnostics.
    return {"scope": "full_test", "source": "verified_checkpoint_test_metrics", "available": test is not None,
            "status": "available" if test is not None else "not_provided", "metrics": test,
            "unit": "DU", "target": "TO3", "schema": checkpoint.metrics.get("schema"),
            "metric_units": copy.deepcopy(checkpoint.metrics.get("metric_units", METRIC_UNITS)),
            "metric_policy": copy.deepcopy(checkpoint.metrics.get("metric_policy")),
            "split_policy": checkpoint.training_contract.get("split_policy"),
            "test_range": copy.deepcopy(checkpoint.training_contract["split_ranges"]["test"]),
            "aggregation": checkpoint.metrics.get("aggregation")}


def compute_earth_diagnostics(task: Any, registry: Any, *, sample_windows=DEFAULT_SAMPLE_WINDOWS,
                              scatter_points=DEFAULT_SCATTER_POINTS, histogram_bins=40, seed=DEFAULT_SEED,
                              pfi_repeats=DEFAULT_PFI_REPEATS, include_pfi=True, pfi_windows=None,
                              device=None, cache=None) -> dict:
    """Compute/reuse task diagnostics, requiring the caller's shared compute gate.

    ``pfi_windows=None`` uses the same diagnostic sample up to eight windows.
    Passing a smaller count chooses a seeded subset of that sample. Every PFI
    baseline and permutation always uses the identical windows, grid and leads.
    """
    sample_windows = _integer("sample_windows", sample_windows, 1, MAX_SAMPLE_WINDOWS)
    scatter_points = _integer("scatter_points", scatter_points, 1, MAX_SCATTER_POINTS)
    histogram_bins = _integer("histogram_bins", histogram_bins, 5, 100)
    seed = _integer("seed", seed, 0, 2**32 - 1)
    pfi_repeats = _integer("pfi_repeats", pfi_repeats, 1, MAX_PFI_REPEATS)
    if type(include_pfi) is not bool:
        raise _error("invalid_earth_diagnostic_parameters", "include_pfi must be boolean", 422)
    if pfi_windows is not None:
        pfi_windows = _integer("pfi_windows", pfi_windows, 1, MAX_PFI_WINDOWS)
    _require_completed_earth_task(task)
    if getattr(task, "dataset_id", None) != EARTH_DATASET_3HOURLY_ID:
        raise _error("dataset_prediction_not_supported", "Earth diagnostics require the active three-hour dataset")
    sha = _threehour_checkpoint_sha(task)
    checkpoint = _load_checkpoint(task)
    if _threehour_checkpoint_sha(task) != sha:
        raise _error("invalid_earth_training_artifact", "The Earth checkpoint changed during diagnostic loading")
    release = _sync_release(registry, checkpoint.dataset_binding)
    _validate_checkpoint_split_ranges(checkpoint, release)
    contract = checkpoint.training_contract
    try:
        dataset = EarthThreeHourlyWindows.from_release(
            release, split="test", window=contract["window"], horizon=contract["horizon"],
            selected_channels=contract["input_channel_order"], normalization=checkpoint.normalization,
            task_split=contract.get("task_split"),
        )
    except ValueError as exc:
        raise _error("invalid_earth_training_artifact", str(exc)) from exc
    selected = select_window_indices(len(dataset), sample_windows, seed)
    pfi_count = min(len(selected), pfi_windows if pfi_windows is not None else MAX_PFI_WINDOWS)
    pfi_positions = select_window_indices(len(selected), pfi_count, (seed + 1) % 2**32)
    pfi_selected = [selected[position] for position in pfi_positions]
    parameters = {"sample_windows": sample_windows, "scatter_points": scatter_points,
                  "histogram_bins": histogram_bins, "seed": seed, "include_pfi": include_pfi,
                  "pfi_windows": pfi_windows, "pfi_repeats": pfi_repeats}
    key = build_earth_diagnostics_cache_key(
        task_id=task.id, checkpoint_sha256=sha, dataset_binding=checkpoint.dataset_binding,
        training_contract=contract, normalization=checkpoint.normalization,
        model_identity=checkpoint.model_identity(), selected_indices=selected, parameters=parameters)
    resolved_cache = EARTH_DIAGNOSTICS_CACHE if cache is None else cache
    cached = resolved_cache.get(key)
    if cached is not None:
        cached["cache"]["hit"] = True
        cached["warnings"] = _model_source_warnings(checkpoint)
        return cached
    scope = _scope(dataset, selected, seed=seed)
    accumulator = ErrorAccumulator(dataset_id=EARTH_DATASET_3HOURLY_ID, horizon=dataset.horizon)
    baseline = ErrorAccumulator(dataset_id=EARTH_DATASET_3HOURLY_ID, horizon=dataset.horizon)
    sampler = _ScatterSampler(scope["expected_points"], scatter_points, seed)
    residual_min, residual_max, residual_sum, residual_squared = math.inf, -math.inf, 0.0, 0.0
    first_pass_digest, second_pass_digest = hashlib.sha256(), hashlib.sha256()
    count = 0
    try:
        model, warnings = build_earth_model_from_checkpoint(checkpoint)
        resolved_device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        model.to(resolved_device).eval()
        with torch.inference_mode(), _open_verified_dataset(release) as ds:
            for offset, lat, lon, prediction, reference in _tile_batches(ds, dataset, selected, model, checkpoint, resolved_device):
                accumulator.update(prediction, reference)
                if include_pfi:
                    local = [position - offset for position in pfi_positions if offset <= position < offset + len(prediction)]
                    if local:
                        baseline.update(prediction[local], reference[local])
                sampler.update(prediction, reference)
                residual = prediction - reference
                if not np.isfinite(residual).all():
                    raise _error("earth_diagnostics_non_finite_data", "Earth diagnostics produced non-finite DU residuals")
                first_pass_digest.update(np.ascontiguousarray(residual).tobytes())
                residual_min, residual_max = min(residual_min, float(residual.min())), max(residual_max, float(residual.max()))
                residual_sum += float(residual.sum())
                residual_squared += float(np.square(residual).sum())
                count += residual.size
            if count != scope["expected_points"] or count < 1:
                raise _error("earth_diagnostics_incomplete", "Diagnostic valid point count disagrees with the declared scope")
            if residual_min == residual_max:
                edges = np.linspace(residual_min - 0.5, residual_max + 0.5, histogram_bins + 1)
            else:
                edges = np.linspace(residual_min, residual_max, histogram_bins + 1)
            counts = np.zeros(histogram_bins, dtype="int64")
            # A second streaming pass produces exact bins for the selected range
            # without retaining predictions, truth or residual volumes.
            for _, _, _, prediction, reference in _tile_batches(ds, dataset, selected, model, checkpoint, resolved_device):
                residual = prediction - reference
                if not np.isfinite(residual).all():
                    raise _error("earth_diagnostics_non_finite_data", "Histogram residuals are non-finite")
                if float(residual.min()) < edges[0] or float(residual.max()) > edges[-1]:
                    raise _error("earth_diagnostics_model_not_reproducible", "Earth model outputs changed between histogram passes")
                second_pass_digest.update(np.ascontiguousarray(residual).tobytes())
                counts += np.histogram(residual, bins=edges)[0]
            if first_pass_digest.digest() != second_pass_digest.digest():
                raise _error("earth_diagnostics_model_not_reproducible", "Earth model outputs changed between histogram passes")
            if int(counts.sum()) != count:
                raise _error("earth_diagnostics_incomplete", "Histogram counts do not cover all selected test elements")
            pfi = _compute_pfi(ds, dataset, pfi_selected, model, checkpoint, resolved_device,
                               baseline if pfi_selected == selected else None,
                               pfi_repeats, seed) if include_pfi else None
        _sync_release(registry, checkpoint.dataset_binding)
        if _threehour_checkpoint_sha(task) != sha:
            raise _error("invalid_earth_training_artifact", "The Earth checkpoint changed during diagnostics")
        # Reload also verifies the uploaded source against its pinned digest at
        # publication time, as historical prediction does before cache use.
        _load_checkpoint(task)
        metrics = {**accumulator.result(), "unit": "DU", "target": "TO3",
                   "metric_units": dict(METRIC_UNITS), "metric_policy": dict(METRIC_POLICY),
                   "scope": "selected_test_windows_all_grid_leads", "window_count": len(selected),
                   "valid_points": count, "aggregation": "forecast_origin_lead_grid_uniform"}
        mean = residual_sum / count
        result = {
            "algorithm_version": DIAGNOSTIC_VERSION, "planet": "earth", "task_id": int(task.id),
            "status": "completed", "unit": "DU", "target_unit": "DU", "target": "TO3",
            "dataset_id": EARTH_DATASET_3HOURLY_ID,
            "dataset_version": checkpoint.dataset_binding["dataset_version"],
            "dataset_fingerprint": checkpoint.dataset_binding["dataset_fingerprint"],
            "checkpoint_sha256": sha, "model": checkpoint.model_identity(),
            "model_source": checkpoint.model_source, "window": dataset.window, "horizon": dataset.horizon,
            "input_channel_order": list(dataset.input_channels), "input_units": contract["input_units"],
            "scope": scope, "full_test_metrics": _full_test_metrics(checkpoint), "sample_metrics": metrics,
            "scatter": sampler.result(seed),
            "histogram": {"edges": edges.tolist(), "counts": counts.tolist(), "unit": "DU",
                          "residual_definition": RESIDUAL_DEFINITION,
                          "scope": "selected_test_windows_all_grid_leads", "valid_points": count,
                          "calculation": "two_pass_streaming_all_selected_grid_lead_elements",
                          "summary": {"mean": mean, "std": math.sqrt(max(0.0, residual_squared / count - mean * mean)),
                                      "min": residual_min, "max": residual_max, "count": count}},
            "pfi": pfi, "warnings": list(warnings) + _model_source_warnings(checkpoint),
            "cache": {"key": key, "hit": False, "algorithm_version": DIAGNOSTIC_VERSION,
                      "scope": "process_local_bounded_snapshot"},
            "parameters": parameters,
        }
        resolved_cache.put(key, result)
        return result
    except DatasetRequestError:
        raise
    except (EarthArtifactError, EarthModelBuildError, UploadedModelSourceError) as exc:
        raise _error(getattr(exc, "code", "invalid_earth_training_artifact"), str(exc)) from exc
    except (ValueError, KeyError, OSError, RuntimeError) as exc:
        raise _error("earth_diagnostics_failed", str(exc)) from exc


def _compute_pfi(ds, dataset, selected, model, checkpoint, device, baseline, repeats, seed):
    pfi_scope = _scope(dataset, selected, seed=seed)
    pfi_scope["sampling"]["method"] = "seeded_subset_of_diagnostic_test_windows"
    pfi_scope["sampling"]["maximum_windows"] = MAX_PFI_WINDOWS
    pfi_scope["sampling"].update(diagnostic_selection_seed=seed,
                                 subset_selection_seed=(seed + 1) % 2**32,
                                 permutation_seed=seed)
    common = {"scope": pfi_scope, "sampling": pfi_scope["sampling"], "unit": "DU",
              "baseline_metric": "rmse", "importance_definition": "permuted_rmse-baseline_rmse",
              "seed": seed, "repeats": repeats,
              "permutation": "whole_window_channel_derangement_shared_across_spatial_tiles",
              "interpretation": "Sensitivity of the current model on these sampled test windows; negative importance is retained."}
    if len(selected) < 2:
        return {**common, "status": "unavailable", "reason": "At least two valid test windows are required for meaningful permutation.",
                "reason_code": "earth_pfi_insufficient_windows", "items": [], "baseline_value": None,
                "window_count": len(selected), "valid_points": pfi_scope["valid_points"]}
    recompute_baseline = baseline is None
    if recompute_baseline:
        baseline = ErrorAccumulator(dataset_id=EARTH_DATASET_3HOURLY_ID, horizon=dataset.horizon)
    mappings = permutation_mappings(len(selected), repeats, seed)
    accumulators = [[ErrorAccumulator(dataset_id=EARTH_DATASET_3HOURLY_ID, horizon=dataset.horizon)
                     for _ in mappings] for _ in dataset.input_channels]
    channel_varies = [False] * len(dataset.input_channels)
    for lat in range(0, len(dataset.lat), TILE_SHAPE[0]):
        for lon in range(0, len(dataset.lon), TILE_SHAPE[1]):
            inputs, reference = _read_tile(ds, dataset, selected, lat, lon)
            if recompute_baseline:
                # A smaller PFI subset also needs its own batch composition.
                # Arbitrary uploaded models can depend on other batch members.
                for offset in range(0, len(selected), BATCH_SIZE):
                    stop = min(offset + BATCH_SIZE, len(selected))
                    baseline.update(_predict_tile(model, inputs[offset:stop], checkpoint, device), reference[offset:stop])
            for channel, rows in enumerate(accumulators):
                channel_varies[channel] |= bool(np.any(inputs[1:, :, channel] != inputs[:1, :, channel]))
                for repeat, mapping in enumerate(mappings):
                    for offset in range(0, len(selected), BATCH_SIZE):
                        stop = min(offset + BATCH_SIZE, len(selected))
                        permuted = inputs[offset:stop].copy()
                        # All T,H,W positions come from the same source window.
                        permuted[:, :, channel] = inputs[np.asarray(mapping[offset:stop]), :, channel]
                        prediction = _predict_tile(model, permuted, checkpoint, device)
                        rows[repeat].update(prediction, reference[offset:stop])
    baseline_rmse = float(baseline.result()["overall"]["rmse"])
    items = []
    for channel, rows, meaningful in zip(dataset.input_channels, accumulators, channel_varies):
        if not meaningful:
            items.append({"feature": channel, "channel": channel, "name": channel,
                          "status": "unavailable", "reason_code": "earth_pfi_identical_channel_windows",
                          "reason": "This channel is identical across the selected windows; a meaningful permutation cannot be computed.",
                          "importance": None, "importance_mean": None, "mean": None,
                          "std": None, "importance_std": None, "baseline_rmse": baseline_rmse,
                          "permuted_rmse_mean": None, "unit": "DU", "repeats": []})
            continue
        values = [float(acc.result()["overall"]["rmse"]) for acc in rows]
        deltas = [value - baseline_rmse for value in values]
        items.append({"feature": channel, "channel": channel, "name": channel, "status": "completed",
                      "importance": float(np.mean(deltas)), "mean": float(np.mean(deltas)),
                      "importance_mean": float(np.mean(deltas)), "baseline_rmse": baseline_rmse,
                      "std": float(np.std(deltas, ddof=0)), "importance_std": float(np.std(deltas, ddof=0)),
                      "permuted_rmse_mean": float(np.mean(values)), "unit": "DU",
                      "repeats": [{"repeat": index + 1, "rmse": value, "permuted_rmse": value, "delta_rmse": delta}
                                  for index, (value, delta) in enumerate(zip(values, deltas))]})
    result = {**common, "status": "completed" if any(channel_varies) else "unavailable", "baseline_value": baseline_rmse,
            "baseline_rmse": baseline_rmse, "items": items, "source_window_mappings": mappings,
            "window_count": len(selected), "valid_points": pfi_scope["valid_points"]}
    if not any(channel_varies):
        result.update(reason_code="earth_pfi_identical_windows",
                      reason="Every input channel is identical across these test windows; meaningful permutation cannot be computed.")
    return result


# Backwards-compatible spelling for callers using the initial design name.
build_earth_diagnostics = compute_earth_diagnostics

__all__ = ["compute_earth_diagnostics", "build_earth_diagnostics",
           "build_earth_diagnostics_cache_key", "EarthDiagnosticsCache",
           "EARTH_DIAGNOSTICS_CACHE", "select_window_indices", "permutation_mappings"]
