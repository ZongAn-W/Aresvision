from __future__ import annotations

import argparse
import importlib.machinery
import importlib.util
import json
import os
import sys
import uuid
from pathlib import Path
from typing import Any, Optional

import netCDF4
import numpy as np
import sklearn.metrics as sk_metrics
import torch
import torch.nn as nn
from scipy.interpolate import interp1d
from sklearn.preprocessing import StandardScaler
from torch.utils.data import DataLoader, TensorDataset

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from config import MCD_DIR, MCD_RAW_3H_DIR, MOLA_TOPOGRAPHY_PATH
from services.ozone_units import normalize_ozone_column_units
from services.transfer_learning_strategy import apply_freeze_strategy
from training_backbones.uploaded_model_contract import (
    attach_uploaded_model_contract,
    expand_topography_batch,
    run_uploaded_model,
    uploaded_model_requires_ls,
    uploaded_model_requires_topography,
    validate_ls_tensor,
)
from training_backbones.mola_topography import (
    prepare_topography_grid,
    validate_rectilinear_grid,
)

CHANNEL_ORDER = ["U", "V", "D", "S", "T"]
TRAINING_DATASET_OPENMARS_MCD = "openmars_mcd"
TRAINING_DATASET_MCD_OVERVIEW = "mcd_overview"
TRAINING_DATASET_IDS = {TRAINING_DATASET_OPENMARS_MCD, TRAINING_DATASET_MCD_OVERVIEW}
MCD_VARS_MAP = {
    "U": ("U_Wind", "u"),
    "V": ("V_Wind", "v"),
    "D": ("Dust_Optical_Depth", "dustq"),
    "S": ("Solar_Flux_DN", "fluxsurf_dn_sw"),
    "T": ("Temperature", "temp"),
}
RAW_MCD_FIELD_MAP = {
    "U_Wind": "U",
    "V_Wind": "V",
    "Solar_Flux_DN": "FSDS",
    "Temperature": "T",
}
RAW_MCD_TARGET_LAT = np.arange(87.5, -90.0, -5.0, dtype=np.float32)


def parse_json_arg(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return dict(value)
    if not isinstance(value, str):
        return {}

    stripped = value.strip()
    if not stripped:
        return {}

    try:
        parsed = json.loads(stripped)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def parse_bool(value: Any) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def normalize_training_dataset(value: Any) -> str:
    dataset = str(value or TRAINING_DATASET_OPENMARS_MCD).strip().lower()
    return dataset if dataset in TRAINING_DATASET_IDS else TRAINING_DATASET_OPENMARS_MCD


def parse_selected_channels(value: Any) -> list[str]:
    if value is None:
        raw_items: list[Any] = []
    elif isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("["):
            try:
                parsed = json.loads(stripped)
            except Exception:
                parsed = stripped
            raw_items = parsed if isinstance(parsed, list) else stripped.replace("+", ",").split(",")
        else:
            raw_items = stripped.replace("+", ",").split(",")
    elif isinstance(value, (list, tuple, set)):
        raw_items = list(value)
    else:
        raw_items = []

    selected = {str(item).strip().upper() for item in raw_items if str(item).strip()}
    return [channel for channel in CHANNEL_ORDER if channel in selected]


def build_uploaded_model_config(
    in_channels: int,
    window: int,
    horizon: int,
    height: int,
    width: int,
    selected_channels: Any,
    custom_model_params: Any,
    param_schema: Any,
) -> dict[str, Any]:
    selected = parse_selected_channels(selected_channels)
    custom_params = parse_json_arg(custom_model_params)
    schema = parse_json_arg(param_schema)

    config: dict[str, Any] = {
        "in_channels": int(in_channels),
        "window": int(window),
        "horizon": int(horizon),
        "height": int(height),
        "width": int(width),
        "selected_channels": selected,
    }
    for key, param in schema.items():
        if not isinstance(param, dict):
            continue
        config[key] = custom_params.get(key, param.get("default"))
    return config


def load_uploaded_model(model_path: Path, config: dict[str, Any]) -> nn.Module:
    path = Path(model_path)
    module_name = f"aresvision_uploaded_runner_{uuid.uuid4().hex}"
    loader = importlib.machinery.SourceFileLoader(module_name, str(path))
    spec = importlib.util.spec_from_loader(module_name, loader)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load uploaded model from {path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
        build_model = getattr(module, "build_model", None)
        if not callable(build_model):
            raise TypeError("Uploaded model must export build_model(config)")
        model_spec = getattr(module, "MODEL_SPEC", None)
        model = build_model(config)
    finally:
        sys.modules.pop(module_name, None)

    if not isinstance(model, nn.Module):
        raise TypeError("build_model(config) must return torch.nn.Module")
    return attach_uploaded_model_contract(model, model_spec)


def assert_prediction_shape(prediction: Any, target: Any, context: str) -> None:
    actual_shape = tuple(getattr(prediction, "shape", ()))
    expected_shape = tuple(getattr(target, "shape", ()))
    if actual_shape != expected_shape:
        raise ValueError(
            f"{context} prediction shape mismatch: "
            f"expected shape {expected_shape}, actual shape {actual_shape}"
        )


def apply_transfer_learning(model: nn.Module, args: Any, device: torch.device) -> Optional[str]:
    if not parse_bool(getattr(args, "transfer_learning", False)):
        return None

    if str(getattr(args, "transfer_load_mode", "strict")).strip().lower() != "strict":
        raise ValueError("Only strict transfer loading is supported")

    weight_path = os.environ.get("ARESVISION_TRANSFER_WEIGHT_PATH", "").strip()
    if not weight_path:
        raise ValueError("Transfer learning is enabled but ARESVISION_TRANSFER_WEIGHT_PATH is missing")
    state_dict = torch.load(weight_path, map_location=device, weights_only=True)
    model.load_state_dict(state_dict, strict=True)
    freeze_report = apply_freeze_strategy(model, getattr(args, "freeze_mode", "none"))
    print(
        f"[Transfer] Loaded strict weights from {Path(weight_path).name}; "
        f"freeze_mode={freeze_report['mode']}; "
        f"trainable_params={freeze_report['trainable_parameter_count']}/"
        f"{freeze_report['total_parameter_count']}",
        flush=True,
    )
    return weight_path


def natural_sort_key(value: Any) -> list[Any]:
    import re

    return [
        int(text) if text.isdigit() else text.lower()
        for text in re.split(r"([0-9]+)", str(value))
    ]


def unwrap_ls(ls_in: Any) -> np.ndarray:
    values = np.asarray(ls_in, dtype=np.float32).reshape(-1)
    out = values.copy()
    offset = 0.0
    for idx in range(1, len(out)):
        if values[idx] < values[idx - 1] - 180.0:
            offset += 360.0
        out[idx] += offset
    return out


def _clean_array(value: Any) -> np.ndarray:
    array = np.asanyarray(value)
    if np.ma.isMaskedArray(array):
        array = array.filled(np.nan)
    return np.nan_to_num(np.asarray(array, dtype=np.float32), nan=0.0, posinf=0.0, neginf=0.0)


def _ls_array(value: Any) -> np.ndarray:
    array = np.asanyarray(value)
    if np.ma.isMaskedArray(array):
        array = array.filled(np.nan)
    return np.asarray(array, dtype=np.float32).reshape(-1)


def _read_ls_variable(
    dataset: Any,
    file_path: Path,
    *,
    required: bool = True,
) -> Optional[np.ndarray]:
    if "Ls" in dataset.variables:
        return _ls_array(dataset.variables["Ls"][:])
    if "ls" in dataset.variables:
        return _ls_array(dataset.variables["ls"][:])
    if not required:
        return None
    raise ValueError(f"Missing Ls variable in {file_path}")


def _read_spatial_coordinates(
    dataset: Any,
    file_path: Path,
    *,
    required: bool = True,
) -> Optional[tuple[np.ndarray, np.ndarray]]:
    lat_name = "lat" if "lat" in dataset.variables else None
    if lat_name is None and "latitude" in dataset.variables:
        lat_name = "latitude"
    lon_name = "lon" if "lon" in dataset.variables else None
    if lon_name is None and "longitude" in dataset.variables:
        lon_name = "longitude"
    missing = []
    if lat_name is None:
        missing.append("latitude")
    if lon_name is None:
        missing.append("longitude")
    if missing:
        if not required:
            return None
        raise ValueError(f"Missing spatial coordinates {missing} in {file_path}")
    latitude, longitude = validate_rectilinear_grid(
        dataset.variables[lat_name][:],
        dataset.variables[lon_name][:],
        context=f"dataset grid in {file_path}",
        require_global_longitude=True,
    )
    return latitude.astype(np.float32), longitude.astype(np.float32)


def _require_matching_grid(
    expected: tuple[np.ndarray, np.ndarray],
    actual: tuple[np.ndarray, np.ndarray],
    file_path: Path,
) -> None:
    same_latitude = (
        expected[0].shape == actual[0].shape
        and np.allclose(expected[0], actual[0], rtol=0.0, atol=1e-4)
    )
    same_longitude = (
        expected[1].shape == actual[1].shape
        and np.allclose(expected[1], actual[1], rtol=0.0, atol=1e-4)
    )
    if not same_latitude or not same_longitude:
        raise ValueError(
            f"Spatial grid mismatch in {file_path}: expected "
            f"({len(expected[0])}, {len(expected[1])}), got "
            f"({len(actual[0])}, {len(actual[1])})"
        )


def _merge_sol_hour(data: Any) -> np.ndarray:
    array = _clean_array(data)
    if array.ndim == 4:
        return array.reshape(array.shape[0] * array.shape[1], array.shape[2], array.shape[3])
    if array.ndim == 3:
        return array
    raise ValueError(f"Expected MCD variable to be 3D or 4D, got shape {array.shape}")


def _expand_mcd_ls(dataset: Any, file_path: Path, sample_var_name: str) -> np.ndarray:
    ls_values = _read_ls_variable(dataset, file_path)
    if ls_values is None:
        raise ValueError(f"Missing Ls variable in {file_path}")
    sample_shape = dataset.variables[sample_var_name].shape
    if len(sample_shape) >= 4:
        sol_count, hour_count = int(sample_shape[0]), int(sample_shape[1])
        target_count = sol_count * hour_count
        if len(ls_values) == target_count:
            return ls_values
        if len(ls_values) < sol_count:
            raise ValueError(f"Not enough Ls values in {file_path}")

        expanded = np.zeros(target_count, dtype=np.float32)
        for idx in range(sol_count):
            ls_start = float(ls_values[idx])
            if idx < sol_count - 1:
                ls_end = float(ls_values[idx + 1])
                if ls_end < ls_start:
                    ls_end += 360.0
            else:
                step = float(ls_values[1] - ls_values[0]) if sol_count > 1 else 0.5
                if step <= 0:
                    step += 360.0
                ls_end = ls_start + step
            expanded[idx * hour_count : (idx + 1) * hour_count] = np.linspace(
                ls_start,
                ls_end,
                hour_count,
                endpoint=False,
            )
        return expanded % 360.0

    target_count = int(sample_shape[0])
    if len(ls_values) < target_count:
        raise ValueError(f"Not enough Ls values in {file_path}")
    return ls_values[:target_count]


def _validate_file_ls_length(
    ls_values: Optional[np.ndarray],
    frame_count: int,
    file_path: Path,
    *,
    required: bool,
) -> Optional[np.ndarray]:
    if ls_values is None:
        return None
    actual_count = int(ls_values.shape[0])
    if actual_count == int(frame_count):
        return ls_values
    if required:
        raise ValueError(
            f"Ls length mismatch in {file_path}: expected {int(frame_count)}, got {actual_count}"
        )
    return None


def _load_openmars(
    openmars_dir: Path,
    *,
    require_ls: bool = True,
    require_coordinates: bool = True,
) -> tuple[
    np.ndarray,
    Optional[np.ndarray],
    Optional[np.ndarray],
    Optional[np.ndarray],
]:
    o3_list: list[np.ndarray] = []
    ls_list: list[np.ndarray] = []
    ls_missing = False
    spatial_grid: Optional[tuple[np.ndarray, np.ndarray]] = None
    spatial_shape: Optional[tuple[int, int]] = None
    coordinates_complete = True
    for file_path in sorted(Path(openmars_dir).glob("*.nc"), key=natural_sort_key):
        with netCDF4.Dataset(str(file_path)) as dataset:
            if "o3col" not in dataset.variables:
                continue
            o3 = _clean_array(dataset.variables["o3col"][:])
            if o3.ndim == 4:
                o3 = np.nanmean(o3, axis=1)
            if o3.ndim != 3:
                raise ValueError(f"Invalid OpenMars o3col shape in {file_path}: {o3.shape}")
            file_shape = (int(o3.shape[1]), int(o3.shape[2]))
            if spatial_shape is None:
                spatial_shape = file_shape
            elif spatial_shape != file_shape:
                raise ValueError(
                    f"OpenMars spatial shape mismatch in {file_path}: "
                    f"expected {spatial_shape}, got {file_shape}"
                )
            file_grid = _read_spatial_coordinates(
                dataset,
                file_path,
                required=require_coordinates,
            )
            if file_grid is None:
                coordinates_complete = False
            else:
                if file_shape != (len(file_grid[0]), len(file_grid[1])):
                    raise ValueError(
                        f"OpenMars spatial shape mismatch in {file_path}: "
                        f"field {o3.shape[1:]}, coordinates "
                        f"({len(file_grid[0])}, {len(file_grid[1])})"
                    )
                if spatial_grid is None:
                    spatial_grid = file_grid
                else:
                    _require_matching_grid(spatial_grid, file_grid, file_path)
            o3_list.append(o3)
            ls_values = _validate_file_ls_length(
                _read_ls_variable(dataset, file_path, required=require_ls),
                int(o3.shape[0]),
                file_path,
                required=require_ls,
            )
            if ls_values is None:
                ls_missing = True
            else:
                ls_list.append(ls_values)

    if not o3_list:
        raise FileNotFoundError(f"No OpenMars .nc files found in {openmars_dir}")
    if require_coordinates and spatial_grid is None:
        raise ValueError(f"No OpenMars spatial grid found in {openmars_dir}")

    y_raw = _clean_array(np.concatenate(o3_list, axis=0))
    ls_raw = None if ls_missing or not ls_list else np.concatenate(ls_list, axis=0).astype(np.float32)
    time_count = int(y_raw.shape[0])
    if ls_raw is not None:
        time_count = min(time_count, int(ls_raw.shape[0]))
    if time_count <= 0:
        raise ValueError("OpenMars timeline is empty")
    return (
        y_raw[:time_count],
        None if ls_raw is None else ls_raw[:time_count],
        spatial_grid[0] if coordinates_complete and spatial_grid is not None else None,
        spatial_grid[1] if coordinates_complete and spatial_grid is not None else None,
    )


def _load_mcd_features(
    mcd_dir: Path,
    selected_channels: list[str],
    om_ls_raw: Optional[np.ndarray],
    target_latitude: Optional[np.ndarray],
    target_longitude: Optional[np.ndarray],
    target_shape: tuple[int, int],
    *,
    require_coordinates: bool = True,
) -> dict[str, np.ndarray]:
    if not selected_channels:
        return {}
    if om_ls_raw is None:
        raise ValueError("Missing Ls data required to align selected MCD features")

    mcd_data = {MCD_VARS_MAP[channel][1]: [] for channel in selected_channels}
    mcd_ls: list[np.ndarray] = []
    first_var = MCD_VARS_MAP[selected_channels[0]][0]

    for file_path in sorted(Path(mcd_dir).glob("*.nc"), key=natural_sort_key):
        with netCDF4.Dataset(str(file_path)) as dataset:
            if first_var not in dataset.variables:
                continue
            missing = [
                MCD_VARS_MAP[channel][0]
                for channel in selected_channels
                if MCD_VARS_MAP[channel][0] not in dataset.variables
            ]
            if missing:
                raise ValueError(f"MCD file {file_path} is missing variables: {missing}")
            file_grid = _read_spatial_coordinates(
                dataset,
                file_path,
                required=require_coordinates,
            )
            if target_latitude is not None and target_longitude is not None and file_grid is not None:
                _require_matching_grid(
                    (target_latitude, target_longitude),
                    file_grid,
                    file_path,
                )
            for channel in selected_channels:
                var_name, short_name = MCD_VARS_MAP[channel]
                merged = _merge_sol_hour(dataset.variables[var_name][:])
                if tuple(merged.shape[1:]) != target_shape:
                    raise ValueError(
                        f"MCD spatial shape mismatch in {file_path}: "
                        f"expected {target_shape}, got {tuple(merged.shape[1:])}"
                    )
                mcd_data[short_name].append(merged)
            mcd_ls.append(_expand_mcd_ls(dataset, file_path, first_var))

    if not mcd_ls:
        raise ValueError(f"No usable MCD files found for channels {selected_channels}")

    mcd_ls_continuous = unwrap_ls(np.concatenate(mcd_ls, axis=0))
    om_ls_continuous = unwrap_ls(om_ls_raw)
    sort_idx = np.argsort(mcd_ls_continuous)
    mcd_ls_continuous = mcd_ls_continuous[sort_idx]

    vars_dict: dict[str, np.ndarray] = {}
    for channel in selected_channels:
        short_name = MCD_VARS_MAP[channel][1]
        combined = _clean_array(np.concatenate(mcd_data[short_name], axis=0))[sort_idx]
        vars_dict[short_name] = _clean_array(
            interp1d(
                mcd_ls_continuous,
                combined,
                axis=0,
                bounds_error=False,
                fill_value="extrapolate",
            )(om_ls_continuous)
        )
    return vars_dict


def _load_mcd_overview(
    mcd_overview_dir: Path,
    selected_channels: list[str],
    *,
    require_ls: bool = True,
    require_coordinates: bool = True,
) -> tuple[
    np.ndarray,
    Optional[np.ndarray],
    dict[str, np.ndarray],
    Optional[np.ndarray],
    Optional[np.ndarray],
]:
    y_parts: list[np.ndarray] = []
    ls_parts: list[np.ndarray] = []
    feature_parts = {MCD_VARS_MAP[channel][1]: [] for channel in selected_channels}
    ls_missing = False
    spatial_grid: Optional[tuple[np.ndarray, np.ndarray]] = None
    spatial_shape: Optional[tuple[int, int]] = None
    coordinates_complete = True

    for file_path in sorted(Path(mcd_overview_dir).glob("*.nc"), key=natural_sort_key):
        with netCDF4.Dataset(str(file_path)) as dataset:
            if "o3col" not in dataset.variables:
                raise ValueError(f"MCD overview file {file_path} is missing o3col")
            y = _clean_array(dataset.variables["o3col"][:])
            if y.ndim != 3:
                raise ValueError(f"Invalid MCD overview o3col shape in {file_path}: {y.shape}")
            file_shape = (int(y.shape[1]), int(y.shape[2]))
            if spatial_shape is None:
                spatial_shape = file_shape
            elif spatial_shape != file_shape:
                raise ValueError(
                    f"MCD overview spatial shape mismatch in {file_path}: "
                    f"expected {spatial_shape}, got {file_shape}"
                )
            file_grid = _read_spatial_coordinates(
                dataset,
                file_path,
                required=require_coordinates,
            )
            if file_grid is None:
                coordinates_complete = False
            else:
                if file_shape != (len(file_grid[0]), len(file_grid[1])):
                    raise ValueError(
                        f"MCD overview spatial shape mismatch in {file_path}: "
                        f"field {y.shape[1:]}, coordinates "
                        f"({len(file_grid[0])}, {len(file_grid[1])})"
                    )
                if spatial_grid is None:
                    spatial_grid = file_grid
                else:
                    _require_matching_grid(spatial_grid, file_grid, file_path)
            y_parts.append(y)
            ls_values = _validate_file_ls_length(
                _read_ls_variable(dataset, file_path, required=require_ls),
                int(y.shape[0]),
                file_path,
                required=require_ls,
            )
            if ls_values is None:
                ls_missing = True
            else:
                ls_parts.append(ls_values)

            for channel in selected_channels:
                var_name, short_name = MCD_VARS_MAP[channel]
                if var_name not in dataset.variables:
                    raise ValueError(f"MCD overview file {file_path} is missing variable: {var_name}")
                data = _clean_array(dataset.variables[var_name][:])
                if data.ndim != 3:
                    raise ValueError(f"Invalid MCD overview {var_name} shape in {file_path}: {data.shape}")
                feature_parts[short_name].append(data)

    if not y_parts:
        raise FileNotFoundError(f"No MCD overview .nc files found in {mcd_overview_dir}")
    if require_coordinates and spatial_grid is None:
        raise ValueError(f"No MCD overview spatial grid found in {mcd_overview_dir}")

    y_raw = _clean_array(np.concatenate(y_parts, axis=0))
    ls_raw = None if ls_missing or not ls_parts else np.concatenate(ls_parts, axis=0).astype(np.float32)
    vars_dict = {
        short_name: _clean_array(np.concatenate(parts, axis=0))
        for short_name, parts in feature_parts.items()
    }
    time_lengths = [int(y_raw.shape[0])] + [int(v.shape[0]) for v in vars_dict.values()]
    if ls_raw is not None:
        time_lengths.append(int(ls_raw.shape[0]))
    time_count = min(time_lengths)
    if time_count <= 0:
        raise ValueError("MCD overview timeline is empty")
    return (
        y_raw[:time_count],
        None if ls_raw is None else ls_raw[:time_count],
        {name: value[:time_count] for name, value in vars_dict.items()},
        spatial_grid[0] if coordinates_complete and spatial_grid is not None else None,
        spatial_grid[1] if coordinates_complete and spatial_grid is not None else None,
    )


def _read_raw_mcd_ls_variable(
    dataset: Any,
    file_path: Path,
    *,
    required: bool = True,
) -> Optional[np.ndarray]:
    for name in ("LS", "Ls", "ls"):
        if name in dataset.variables:
            return _ls_array(dataset.variables[name][:])
    if not required:
        return None
    raise ValueError(f"Missing LS variable in raw MCD file {file_path}")


def _fit_raw_mcd_lat_grid(data: Any, lat_values: Any) -> np.ndarray:
    field = _clean_array(data)
    if field.ndim != 3:
        raise ValueError(f"Expected raw MCD field to be 3D, got shape {field.shape}")

    lat = np.asarray(lat_values, dtype=np.float32).reshape(-1)
    if field.shape[1] == RAW_MCD_TARGET_LAT.shape[0]:
        if lat.shape[0] == field.shape[1] and lat[0] < lat[-1]:
            return field[:, ::-1, :72]
        return field[:, :, :72]

    if field.shape[1] == RAW_MCD_TARGET_LAT.shape[0] + 1 and lat.shape[0] == field.shape[1]:
        diffs = np.diff(lat)
        if np.allclose(np.abs(diffs), 5.0, atol=1e-3):
            if lat[0] > lat[-1]:
                return ((field[:, :-1, :] + field[:, 1:, :]) * 0.5).astype(np.float32)[:, :, :72]
            return ((field[:, :-1, :] + field[:, 1:, :]) * 0.5).astype(np.float32)[:, ::-1, :72]

    order = np.argsort(lat)
    lat_sorted = lat[order]
    field_sorted = field[:, order, :]
    flat = field_sorted.transpose(0, 2, 1).reshape(-1, field.shape[1])
    out_flat = np.empty((flat.shape[0], RAW_MCD_TARGET_LAT.shape[0]), dtype=np.float32)
    for index, row in enumerate(flat):
        out_flat[index] = np.interp(RAW_MCD_TARGET_LAT, lat_sorted, row).astype(np.float32)
    return out_flat.reshape(field.shape[0], field.shape[2], RAW_MCD_TARGET_LAT.shape[0]).transpose(0, 2, 1)[:, :, :72]


def _load_raw_3h_mcd(
    raw_dir: Path,
    selected_channels: list[str],
    *,
    require_ls: bool = True,
    require_coordinates: bool = True,
) -> tuple[
    np.ndarray,
    Optional[np.ndarray],
    dict[str, np.ndarray],
    Optional[np.ndarray],
    Optional[np.ndarray],
]:
    y_parts: list[np.ndarray] = []
    ls_parts: list[np.ndarray] = []
    feature_parts = {MCD_VARS_MAP[channel][1]: [] for channel in selected_channels}
    ls_missing = False
    spatial_grid: Optional[tuple[np.ndarray, np.ndarray]] = None
    coordinates_complete = True

    for file_path in sorted(Path(raw_dir).glob("*.nc"), key=natural_sort_key):
        with netCDF4.Dataset(str(file_path)) as dataset:
            if "O3COL" not in dataset.variables:
                continue
            if "lat" not in dataset.variables:
                raise ValueError(f"Raw MCD file {file_path} is missing lat")

            lat_values = dataset.variables["lat"][:]
            source_grid = _read_spatial_coordinates(
                dataset,
                file_path,
                required=require_coordinates,
            )
            if source_grid is None:
                coordinates_complete = False
            else:
                file_grid = (
                    RAW_MCD_TARGET_LAT.copy(),
                    np.asarray(source_grid[1], dtype=np.float32)[:72],
                )
                if spatial_grid is None:
                    spatial_grid = file_grid
                else:
                    _require_matching_grid(spatial_grid, file_grid, file_path)
            y = normalize_ozone_column_units(
                _fit_raw_mcd_lat_grid(dataset.variables["O3COL"][:], lat_values),
                getattr(dataset.variables["O3COL"], "units", None),
                allow_mcd_legacy_heuristic=True,
            )
            y_parts.append(_clean_array(y))
            ls_values = _validate_file_ls_length(
                _read_raw_mcd_ls_variable(dataset, file_path, required=require_ls),
                int(y.shape[0]),
                file_path,
                required=require_ls,
            )
            if ls_values is None:
                ls_missing = True
            else:
                ls_parts.append(ls_values)

            for channel in selected_channels:
                var_name, short_name = MCD_VARS_MAP[channel]
                raw_name = RAW_MCD_FIELD_MAP.get(var_name)
                if raw_name is None:
                    feature_parts[short_name].append(np.zeros_like(y, dtype=np.float32))
                    continue
                if raw_name not in dataset.variables:
                    raise ValueError(f"Raw MCD file {file_path} is missing variable: {raw_name}")
                feature_parts[short_name].append(_fit_raw_mcd_lat_grid(dataset.variables[raw_name][:], lat_values))

    if not y_parts:
        raise FileNotFoundError(f"No raw 3h MCD .nc files found in {raw_dir}")
    if require_coordinates and spatial_grid is None:
        raise ValueError(f"No raw 3h MCD spatial grid found in {raw_dir}")

    y_raw = _clean_array(np.concatenate(y_parts, axis=0))
    ls_raw = None if ls_missing or not ls_parts else np.concatenate(ls_parts, axis=0).astype(np.float32)
    vars_dict = {
        short_name: _clean_array(np.concatenate(parts, axis=0))
        for short_name, parts in feature_parts.items()
    }
    time_lengths = [int(y_raw.shape[0])] + [int(v.shape[0]) for v in vars_dict.values()]
    if ls_raw is not None:
        time_lengths.append(int(ls_raw.shape[0]))
    time_count = min(time_lengths)
    if time_count <= 0:
        raise ValueError("Raw 3h MCD timeline is empty")
    return (
        y_raw[:time_count],
        None if ls_raw is None else ls_raw[:time_count],
        {name: value[:time_count] for name, value in vars_dict.items()},
        spatial_grid[0] if coordinates_complete and spatial_grid is not None else None,
        spatial_grid[1] if coordinates_complete and spatial_grid is not None else None,
    )


def _load_mcd_full_training_dataset(
    data_dir: Path,
    selected_channels: list[str],
    *,
    require_ls: bool = True,
    require_coordinates: bool = True,
) -> tuple[
    np.ndarray,
    Optional[np.ndarray],
    dict[str, np.ndarray],
    Optional[np.ndarray],
    Optional[np.ndarray],
]:
    has_raw_files = False
    for file_path in sorted(Path(data_dir).glob("*.nc"), key=natural_sort_key):
        with netCDF4.Dataset(str(file_path)) as dataset:
            if "O3COL" in dataset.variables:
                has_raw_files = True
                break
    if has_raw_files:
        return _load_raw_3h_mcd(
            data_dir,
            selected_channels,
            require_ls=require_ls,
            require_coordinates=require_coordinates,
        )
    return _load_mcd_overview(
        data_dir,
        selected_channels,
        require_ls=require_ls,
        require_coordinates=require_coordinates,
    )


def prepare_tensors(
    openmars_dir: Any,
    mcd_dir: Any,
    selected_channels: Any,
    window: int,
    horizon: int,
    training_dataset: Any = TRAINING_DATASET_OPENMARS_MCD,
    mcd_overview_dir: Any | None = None,
    return_ls: bool = False,
    return_coordinates: bool = False,
    require_coordinates: Optional[bool] = None,
):
    selected = parse_selected_channels(selected_channels)
    dataset = normalize_training_dataset(training_dataset)
    window = int(window)
    horizon = int(horizon)
    if window <= 0 or horizon <= 0:
        raise ValueError("window and horizon must be positive")
    coordinates_required = (
        bool(return_coordinates)
        if require_coordinates is None
        else bool(require_coordinates)
    )

    if dataset == TRAINING_DATASET_MCD_OVERVIEW:
        overview_dir = Path(mcd_overview_dir or (BACKEND_DIR / "data" / "mcd_overview"))
        (
            y_raw,
            ls_raw,
            vars_dict,
            target_latitude,
            target_longitude,
        ) = _load_mcd_full_training_dataset(
            overview_dir,
            selected,
            require_ls=False,
            require_coordinates=coordinates_required,
        )
    else:
        (
            y_raw,
            om_ls_raw,
            target_latitude,
            target_longitude,
        ) = _load_openmars(
            Path(openmars_dir),
            require_ls=bool(selected),
            require_coordinates=coordinates_required,
        )
        ls_raw = om_ls_raw
        target_shape = (int(y_raw.shape[1]), int(y_raw.shape[2]))
        vars_dict = _load_mcd_features(
            Path(mcd_dir),
            selected,
            om_ls_raw,
            target_latitude,
            target_longitude,
            target_shape,
            require_coordinates=coordinates_required,
        )
    feature_names = [MCD_VARS_MAP[channel][1] for channel in selected]
    features = [y_raw] + [vars_dict[name] for name in feature_names]

    min_time = min(int(feature.shape[0]) for feature in features)
    if ls_raw is not None:
        min_time = min(min_time, int(ls_raw.shape[0]))
    target_shape = (int(y_raw.shape[1]), int(y_raw.shape[2]))
    if target_latitude is not None and target_longitude is not None:
        coordinate_shape = (len(target_latitude), len(target_longitude))
        if coordinate_shape != target_shape:
            raise ValueError(
                "Loaded target spatial shape does not match target coordinates: "
                f"field {target_shape}, coordinates {coordinate_shape}"
            )
    mismatched_shapes = [
        tuple(feature.shape[1:])
        for feature in features
        if tuple(feature.shape[1:]) != target_shape
    ]
    if mismatched_shapes:
        raise ValueError(
            "Loaded feature spatial shape does not match target coordinates: "
            f"target {target_shape}, feature shapes {mismatched_shapes}"
        )
    if min_time <= 0 or target_shape[0] <= 0 or target_shape[1] <= 0:
        raise ValueError("Loaded data has invalid dimensions")

    features = [
        _clean_array(feature[:min_time])
        for feature in features
    ]
    y_raw = features[0]
    x_raw = np.stack(features, axis=-1)
    total_time, height, width, channel_count = x_raw.shape
    sample_count = total_time - window - horizon + 1
    if sample_count <= 0:
        raise ValueError(
            "Not enough time steps for requested window and horizon: "
            f"time={total_time}, window={window}, horizon={horizon}"
        )

    split_idx = int(0.8 * sample_count) + window
    split_idx = max(1, min(total_time, split_idx))
    x_scaled = np.zeros_like(x_raw, dtype=np.float32)
    for channel_idx in range(channel_count):
        scaler = StandardScaler()
        scaler.fit(x_raw[:split_idx, ..., channel_idx].reshape(split_idx, -1))
        x_scaled[..., channel_idx] = scaler.transform(
            x_raw[..., channel_idx].reshape(total_time, -1)
        ).reshape(total_time, height, width)

    y_train_part = y_raw[:split_idx]
    y_mean = float(y_train_part.mean())
    y_std = float(y_train_part.std())
    y_scaled = (y_raw - y_mean) / (y_std + 1e-6)

    x_seq: list[np.ndarray] = []
    y_seq: list[np.ndarray] = []
    ls_seq: list[np.ndarray] = []
    for idx in range(sample_count):
        x_seq.append(x_scaled[idx : idx + window])
        y_seq.append(y_scaled[idx + window : idx + window + horizon])
        if ls_raw is not None:
            ls_seq.append(ls_raw[idx : idx + window])

    x_torch = torch.tensor(np.array(x_seq)).permute(0, 1, 4, 2, 3).float()
    y_torch = torch.tensor(np.array(y_seq)).unsqueeze(2).float()
    if return_ls:
        ls_torch = torch.tensor(np.array(ls_seq), dtype=torch.float32) if ls_raw is not None else None
        if return_coordinates:
            return (
                x_torch,
                y_torch,
                ls_torch,
                y_mean,
                y_std,
                height,
                width,
                None if target_latitude is None else target_latitude.astype(np.float32),
                None if target_longitude is None else target_longitude.astype(np.float32),
            )
        return x_torch, y_torch, ls_torch, y_mean, y_std, height, width
    if return_coordinates:
        return (
            x_torch,
            y_torch,
            y_mean,
            y_std,
            height,
            width,
            None if target_latitude is None else target_latitude.astype(np.float32),
            None if target_longitude is None else target_longitude.astype(np.float32),
        )
    return x_torch, y_torch, y_mean, y_std, height, width


def _split_train_test(
    x_torch: torch.Tensor,
    y_torch: torch.Tensor,
    ls_torch: Optional[torch.Tensor] = None,
) -> tuple[TensorDataset, TensorDataset]:
    if len(x_torch) < 2:
        raise ValueError("At least two training samples are required")
    split = int(0.8 * len(x_torch))
    split = min(max(1, split), len(x_torch) - 1)
    if ls_torch is None:
        return (
            TensorDataset(x_torch[:split], y_torch[:split]),
            TensorDataset(x_torch[split:], y_torch[split:]),
        )
    return (
        TensorDataset(x_torch[:split], ls_torch[:split], y_torch[:split]),
        TensorDataset(x_torch[split:], ls_torch[split:], y_torch[split:]),
    )


def _forward_uploaded_batch(
    model: nn.Module,
    batch: Any,
    device: torch.device,
    context: str,
    topography_grid: Optional[torch.Tensor] = None,
) -> tuple[torch.Tensor, torch.Tensor]:
    if len(batch) == 2:
        x_batch, target = batch
        ls_batch = None
    elif len(batch) == 3:
        x_batch, ls_batch, target = batch
    else:
        raise ValueError(
            f"{context} batch must contain (x, y) or (x, ls, y), got {len(batch)} tensors"
        )

    x_device = x_batch.to(device)
    target_device = target.to(device)
    ls_device = ls_batch.to(device) if ls_batch is not None else None
    topography_batch = None
    if uploaded_model_requires_topography(model):
        topography_batch = expand_topography_batch(
            x_device,
            topography_grid,
            context,
        )
    prediction = run_uploaded_model(
        model,
        x_device,
        ls=ls_device,
        topography=topography_batch,
        context=context,
    )
    assert_prediction_shape(prediction, target_device, context)
    return prediction, target_device


def _evaluate_metrics(
    y_true_scaled: np.ndarray,
    y_pred_scaled: np.ndarray,
    y_mean: float,
    y_std: float,
) -> dict[str, float]:
    y_true = y_true_scaled.flatten() * (y_std + 1e-6) + y_mean
    y_pred = y_pred_scaled.flatten() * (y_std + 1e-6) + y_mean
    mse = float(sk_metrics.mean_squared_error(y_true, y_pred))
    rmse = float(np.sqrt(mse))
    try:
        r2 = float(sk_metrics.r2_score(y_true, y_pred))
    except Exception:
        r2 = 0.0
    mape = float(np.mean(np.abs((y_true - y_pred) / (np.abs(y_true) + 1e-8))) * 100.0)
    smape = float(
        np.mean(
            2.0
            * np.abs(y_pred - y_true)
            / (np.abs(y_true) + np.abs(y_pred) + 1e-8)
        )
        * 100.0
    )
    return {"mse": mse, "rmse": rmse, "r2": r2, "mape": mape, "smape": smape}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch_size", type=int, default=32)
    parser.add_argument("--learning_rate", type=float, default=0.001)
    parser.add_argument("--window", type=int, default=3)
    parser.add_argument("--horizon", type=int, default=3)
    parser.add_argument("--early_stopping_patience", type=int, default=0)
    parser.add_argument("--selected_channels", type=str, default="")
    parser.add_argument("--training_dataset", type=str, default=TRAINING_DATASET_OPENMARS_MCD)
    parser.add_argument("--seed", type=int, default=11)
    parser.add_argument("--output_path", type=str, required=True)
    parser.add_argument("--uploaded_model_path", type=str, required=True)
    parser.add_argument("--uploaded_model_param_schema", type=str, default="{}")
    parser.add_argument("--custom_model_params", type=str, default="{}")
    parser.add_argument("--transfer_learning", type=str, default="false")
    parser.add_argument("--transfer_source_type", type=str, default="")
    parser.add_argument("--transfer_load_mode", type=str, default="strict")
    parser.add_argument("--freeze_mode", type=str, default="none")
    parser.add_argument("--finetune_learning_rate", type=float, default=None)
    args, _unknown = parser.parse_known_args()

    epochs = max(1, int(args.epochs))
    batch_size = max(1, int(args.batch_size))
    patience = max(0, int(args.early_stopping_patience))
    seed = max(0, int(args.seed))
    torch.manual_seed(seed)
    np.random.seed(seed)

    selected_channels = parse_selected_channels(args.selected_channels)
    training_dataset = normalize_training_dataset(args.training_dataset)
    openmars_dir = Path(os.environ.get("ARESVISION_OPENMARS_DIR", str(BACKEND_DIR / "data" / "openmars")))
    mcd_dir = Path(MCD_DIR)
    mcd_overview_dir = Path(
        os.environ.get(
            "MCD_RAW_3H_DIR",
            os.environ.get(
                "ARESVISION_MCD_RAW_3H_DIR",
                str(MCD_RAW_3H_DIR),
            ),
        )
    )
    (
        x_torch,
        y_torch,
        ls_torch,
        y_mean,
        y_std,
        height,
        width,
        target_latitude,
        target_longitude,
    ) = prepare_tensors(
        openmars_dir,
        mcd_dir,
        selected_channels,
        args.window,
        args.horizon,
        training_dataset=training_dataset,
        mcd_overview_dir=mcd_overview_dir,
        return_ls=True,
        return_coordinates=True,
        require_coordinates=False,
    )

    param_schema = parse_json_arg(args.uploaded_model_param_schema)
    custom_params = parse_json_arg(args.custom_model_params)
    config = build_uploaded_model_config(
        in_channels=int(x_torch.shape[2]),
        window=args.window,
        horizon=args.horizon,
        height=height,
        width=width,
        selected_channels=selected_channels,
        custom_model_params=custom_params,
        param_schema=param_schema,
    )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = load_uploaded_model(Path(args.uploaded_model_path), config).to(device)
    model_ls = None
    if uploaded_model_requires_ls(model):
        model_ls = validate_ls_tensor(
            x_torch,
            ls_torch,
            "uploaded training dataset",
        )
    model_topography = None
    if uploaded_model_requires_topography(model):
        model_topography = prepare_topography_grid(
            target_latitude,
            target_longitude,
            asset_path=MOLA_TOPOGRAPHY_PATH,
        ).to(device)
        expand_topography_batch(
            x_torch[:1].to(device),
            model_topography,
            "uploaded training dataset",
        )

    train_dataset, test_dataset = _split_train_test(x_torch, y_torch, model_ls)
    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True)
    test_loader = DataLoader(test_dataset, batch_size=batch_size, shuffle=False)

    apply_transfer_learning(model, args, device)
    criterion = nn.SmoothL1Loss()
    trainable_params = [param for param in model.parameters() if param.requires_grad]
    optimizer_lr = args.finetune_learning_rate if args.finetune_learning_rate and args.finetune_learning_rate > 0 else args.learning_rate
    optimizer = torch.optim.Adam(trainable_params, lr=float(optimizer_lr)) if trainable_params else None

    print(f"Training Device: {device}", flush=True)
    print(
        f"UploadedModel={args.uploaded_model_path}, TrainingDataset={training_dataset}, Config={config}",
        flush=True,
    )
    print("\n[Step 3] Start Training...", flush=True)

    best_val_loss = float("inf")
    patience_counter = 0
    for epoch in range(1, epochs + 1):
        model.train()
        loss_sum = 0.0
        for batch_idx, batch in enumerate(train_loader, start=1):
            if optimizer is not None:
                optimizer.zero_grad()
            pred, target = _forward_uploaded_batch(
                model,
                batch,
                device,
                f"training epoch {epoch} batch {batch_idx}",
                topography_grid=model_topography,
            )
            loss = criterion(pred, target)
            if optimizer is not None:
                loss.backward()
                optimizer.step()
            loss_sum += float(loss.item())
            if batch_idx % 20 == 0 or batch_idx == len(train_loader):
                print(
                    f"Epoch {epoch}/{epochs} Batch {batch_idx}/{len(train_loader)} "
                    f"Loss={loss.item():.4f}",
                    flush=True,
                )

        model.eval()
        val_loss_sum = 0.0
        with torch.no_grad():
            for batch_idx, batch in enumerate(test_loader, start=1):
                pred, target = _forward_uploaded_batch(
                    model,
                    batch,
                    device,
                    f"validation epoch {epoch} batch {batch_idx}",
                    topography_grid=model_topography,
                )
                val_loss_sum += float(criterion(pred, target).item())
        train_loss = loss_sum / max(1, len(train_loader))
        val_loss = val_loss_sum / max(1, len(test_loader))
        print(f"Epoch {epoch}/{epochs} Loss={train_loss:.4f} Val Loss={val_loss:.4f}", flush=True)

        if patience > 0:
            if val_loss < best_val_loss:
                best_val_loss = val_loss
                patience_counter = 0
            else:
                patience_counter += 1
                if patience_counter >= patience:
                    print(
                        "[Early Stopping] Val loss did not improve for "
                        f"{patience} epochs. Stopped at epoch {epoch}.",
                        flush=True,
                    )
                    break

    model.eval()
    true_batches: list[np.ndarray] = []
    pred_batches: list[np.ndarray] = []
    with torch.no_grad():
        for batch_idx, batch in enumerate(test_loader, start=1):
            pred, target = _forward_uploaded_batch(
                model,
                batch,
                device,
                f"metrics batch {batch_idx}",
                topography_grid=model_topography,
            )
            pred_batches.append(pred.cpu().numpy())
            true_batches.append(target.cpu().numpy())
    if not true_batches:
        raise ValueError("No test batches available for metrics")

    metrics = _evaluate_metrics(
        np.concatenate(true_batches, axis=0),
        np.concatenate(pred_batches, axis=0),
        y_mean,
        y_std,
    )
    print("\nMetrics:", flush=True)
    print(f"MSE: {metrics['mse']:.4f}", flush=True)
    print(f"RMSE: {metrics['rmse']:.4f}", flush=True)
    print(f"R-Squared: {metrics['r2']:.4f}", flush=True)
    print(f"MAPE: {metrics['mape']:.4f}%", flush=True)
    print(f"SMAPE: {metrics['smape']:.4f}%", flush=True)

    output_path = Path(args.output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), output_path)
    print(f"Model saved: {output_path}", flush=True)


if __name__ == "__main__":
    main()
