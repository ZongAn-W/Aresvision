from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

import netCDF4
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset


BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from config import MCD_DIR, MCD_RAW_3H_DIR  # noqa: E402
from services.dataset_identity import (  # noqa: E402
    require_training_dataset,
    resolve_dataset_id,
)
from services.ozone_units import normalize_ozone_column_units  # noqa: E402
from services.training_channels import (  # noqa: E402
    ARCHITECTURE_FLOAT_PARAMS,
    ARCHITECTURE_INTEGER_LIST_PARAMS,
    ARCHITECTURE_INTEGER_PARAMS,
    TRAINING_DATASET_MCD_OVERVIEW,
    TRAINING_DATASET_OPENMARS_MCD,
    extract_architecture_params,
)
from services.transfer_learning_strategy import apply_freeze_strategy  # noqa: E402
from training_backbones.model_zoo import (  # noqa: E402
    SpherePhaseWarpFrontEnd,
    build_forecaster,
    normalize_model_architecture,
    normalize_use_sphere,
)


CHANNEL_ORDER = ["U", "V", "D", "S", "T"]
TRAINING_DATASET_IDS = {
    TRAINING_DATASET_OPENMARS_MCD,
    TRAINING_DATASET_MCD_OVERVIEW,
}
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


class PreparedTrainingData:
    def __init__(
        self,
        x: torch.Tensor,
        ls: torch.Tensor,
        y: torch.Tensor,
        y_mean: float,
        y_std: float,
        height: int,
        width: int,
    ) -> None:
        self.x = x
        self.ls = ls
        self.y = y
        self.y_mean = float(y_mean)
        self.y_std = float(y_std)
        self.height = int(height)
        self.width = int(width)


def parse_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


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


def normalize_training_dataset(value: Any) -> str:
    """Legacy tolerant normalizer used by old task readers and inference.

    New training runs must resolve their dataset through
    ``require_training_dataset(resolve_dataset_id(...))`` in ``main()`` before any
    data is loaded; this helper only keeps historical reads working.
    """
    dataset = str(value or TRAINING_DATASET_OPENMARS_MCD).strip().lower()
    return dataset if dataset in TRAINING_DATASET_IDS else TRAINING_DATASET_OPENMARS_MCD


def _parse_int_list(value: Any, fallback: list[int]) -> list[int]:
    parsed = value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            parsed = value.replace(",", " ").split()
    if not isinstance(parsed, (list, tuple)):
        parsed = [parsed]

    result: list[int] = []
    for item in parsed:
        try:
            number = int(item)
        except (TypeError, ValueError):
            continue
        if number > 0:
            result.append(number)
    return result or list(fallback)


def natural_sort_key(value: Any) -> list[Any]:
    return [
        int(text) if text.isdigit() else text.lower()
        for text in re.split(r"([0-9]+)", str(value))
    ]


def _clean_array(value: Any) -> np.ndarray:
    array = np.asanyarray(value)
    if np.ma.isMaskedArray(array):
        array = array.filled(np.nan)
    return np.nan_to_num(
        np.asarray(array, dtype=np.float32),
        nan=0.0,
        posinf=0.0,
        neginf=0.0,
    )


def _read_ls_variable(dataset: Any, file_path: Path) -> np.ndarray:
    if "Ls" in dataset.variables:
        return _clean_array(dataset.variables["Ls"][:]).reshape(-1)
    if "ls" in dataset.variables:
        return _clean_array(dataset.variables["ls"][:]).reshape(-1)
    raise ValueError(f"Missing Ls variable in {file_path}")


def _unwrap_ls(values: Any) -> np.ndarray:
    raw = np.asarray(values, dtype=np.float32).reshape(-1)
    unwrapped = raw.copy()
    offset = 0.0
    for index in range(1, len(unwrapped)):
        if raw[index] < raw[index - 1] - 180.0:
            offset += 360.0
        unwrapped[index] += offset
    return unwrapped


def _merge_sol_hour(value: Any) -> np.ndarray:
    array = _clean_array(value)
    if array.ndim == 4:
        return array.reshape(array.shape[0] * array.shape[1], array.shape[2], array.shape[3])
    if array.ndim == 3:
        return array
    raise ValueError(f"Expected MCD variable to be 3D or 4D, got shape {array.shape}")


def _expand_mcd_ls(dataset: Any, file_path: Path, sample_var_name: str) -> np.ndarray:
    ls_values = _read_ls_variable(dataset, file_path)
    sample_shape = dataset.variables[sample_var_name].shape
    if len(sample_shape) < 4:
        target_count = int(sample_shape[0])
        if len(ls_values) < target_count:
            raise ValueError(f"Not enough Ls values in {file_path}")
        return ls_values[:target_count]

    sol_count, hour_count = int(sample_shape[0]), int(sample_shape[1])
    target_count = sol_count * hour_count
    if len(ls_values) == target_count:
        return ls_values
    if len(ls_values) < sol_count:
        raise ValueError(f"Not enough Ls values in {file_path}")

    expanded = np.zeros(target_count, dtype=np.float32)
    for index in range(sol_count):
        start = float(ls_values[index])
        if index < sol_count - 1:
            end = float(ls_values[index + 1])
            if end < start:
                end += 360.0
        else:
            step = float(ls_values[1] - ls_values[0]) if sol_count > 1 else 0.5
            if step <= 0:
                step += 360.0
            end = start + step
        expanded[index * hour_count : (index + 1) * hour_count] = np.linspace(
            start,
            end,
            hour_count,
            endpoint=False,
        )
    return expanded % 360.0


def _load_openmars(openmars_dir: Path) -> tuple[np.ndarray, np.ndarray]:
    ozone_parts: list[np.ndarray] = []
    ls_parts: list[np.ndarray] = []
    for file_path in sorted(Path(openmars_dir).glob("*.nc"), key=natural_sort_key):
        with netCDF4.Dataset(str(file_path)) as dataset:
            if "o3col" not in dataset.variables:
                continue
            ozone = _clean_array(dataset.variables["o3col"][:])
            if ozone.ndim == 4:
                ozone = np.nanmean(ozone, axis=1)
            if ozone.ndim != 3:
                raise ValueError(f"Invalid OpenMars o3col shape in {file_path}: {ozone.shape}")
            ozone_parts.append(ozone)
            ls_parts.append(_read_ls_variable(dataset, file_path))

    if not ozone_parts:
        raise FileNotFoundError(f"No OpenMars .nc files found in {openmars_dir}")

    ozone = _clean_array(np.concatenate(ozone_parts, axis=0))
    ls_values = _clean_array(np.concatenate(ls_parts, axis=0)).reshape(-1)
    time_count = min(int(ozone.shape[0]), int(ls_values.shape[0]))
    if time_count <= 0:
        raise ValueError("OpenMars timeline is empty")
    return ozone[:time_count], ls_values[:time_count]


def _load_mcd_features(
    mcd_dir: Path,
    selected_channels: list[str],
    openmars_ls: np.ndarray,
) -> dict[str, np.ndarray]:
    from scipy.interpolate import interp1d

    if not selected_channels:
        return {}

    feature_parts = {MCD_VARS_MAP[channel][1]: [] for channel in selected_channels}
    ls_parts: list[np.ndarray] = []
    first_variable = MCD_VARS_MAP[selected_channels[0]][0]

    for file_path in sorted(Path(mcd_dir).glob("*.nc"), key=natural_sort_key):
        with netCDF4.Dataset(str(file_path)) as dataset:
            if first_variable not in dataset.variables:
                continue
            missing = [
                MCD_VARS_MAP[channel][0]
                for channel in selected_channels
                if MCD_VARS_MAP[channel][0] not in dataset.variables
            ]
            if missing:
                raise ValueError(f"MCD file {file_path} is missing variables: {missing}")
            for channel in selected_channels:
                variable_name, short_name = MCD_VARS_MAP[channel]
                feature_parts[short_name].append(_merge_sol_hour(dataset.variables[variable_name][:]))
            ls_parts.append(_expand_mcd_ls(dataset, file_path, first_variable))

    if not ls_parts:
        raise ValueError(f"No usable MCD files found for channels {selected_channels}")

    mcd_ls = _unwrap_ls(np.concatenate(ls_parts, axis=0))
    sort_index = np.argsort(mcd_ls)
    sorted_ls = mcd_ls[sort_index]
    target_ls = _unwrap_ls(openmars_ls)
    features: dict[str, np.ndarray] = {}
    for channel in selected_channels:
        short_name = MCD_VARS_MAP[channel][1]
        combined = _clean_array(np.concatenate(feature_parts[short_name], axis=0))[sort_index]
        features[short_name] = _clean_array(
            interp1d(
                sorted_ls,
                combined,
                axis=0,
                bounds_error=False,
                fill_value="extrapolate",
            )(target_ls)
        )
    return features


def _load_mcd_overview(
    overview_dir: Path,
    selected_channels: list[str],
) -> tuple[np.ndarray, np.ndarray, dict[str, np.ndarray]]:
    ozone_parts: list[np.ndarray] = []
    ls_parts: list[np.ndarray] = []
    feature_parts = {MCD_VARS_MAP[channel][1]: [] for channel in selected_channels}

    for file_path in sorted(Path(overview_dir).glob("*.nc"), key=natural_sort_key):
        with netCDF4.Dataset(str(file_path)) as dataset:
            if "o3col" not in dataset.variables:
                raise ValueError(f"MCD overview file {file_path} is missing o3col")
            ozone = _clean_array(dataset.variables["o3col"][:])
            if ozone.ndim != 3:
                raise ValueError(f"Invalid MCD overview o3col shape in {file_path}: {ozone.shape}")
            ozone_parts.append(ozone)
            ls_parts.append(_read_ls_variable(dataset, file_path))

            for channel in selected_channels:
                variable_name, short_name = MCD_VARS_MAP[channel]
                if variable_name not in dataset.variables:
                    raise ValueError(f"MCD overview file {file_path} is missing variable: {variable_name}")
                feature = _clean_array(dataset.variables[variable_name][:])
                if feature.ndim != 3:
                    raise ValueError(
                        f"Invalid MCD overview {variable_name} shape in {file_path}: {feature.shape}"
                    )
                feature_parts[short_name].append(feature)

    if not ozone_parts:
        raise FileNotFoundError(f"No MCD overview .nc files found in {overview_dir}")

    ozone = _clean_array(np.concatenate(ozone_parts, axis=0))
    ls_values = _clean_array(np.concatenate(ls_parts, axis=0)).reshape(-1)
    features = {
        short_name: _clean_array(np.concatenate(parts, axis=0))
        for short_name, parts in feature_parts.items()
    }
    time_count = min(
        [int(ozone.shape[0]), int(ls_values.shape[0])]
        + [int(feature.shape[0]) for feature in features.values()]
    )
    if time_count <= 0:
        raise ValueError("MCD overview timeline is empty")
    return (
        ozone[:time_count],
        ls_values[:time_count],
        {name: feature[:time_count] for name, feature in features.items()},
    )


def _read_raw_mcd_ls_variable(dataset: Any, file_path: Path) -> np.ndarray:
    for name in ("LS", "Ls", "ls"):
        if name in dataset.variables:
            return _clean_array(dataset.variables[name][:]).reshape(-1)
    raise ValueError(f"Missing LS variable in raw MCD file {file_path}")


def _fit_raw_mcd_lat_grid(data: np.ndarray, lat_values: Any) -> np.ndarray:
    field = _clean_array(data)
    if field.ndim != 3:
        raise ValueError(f"Expected raw MCD field to be 3D, got shape {field.shape}")

    lat = np.asarray(lat_values, dtype=np.float32).reshape(-1)
    if field.shape[1] == RAW_MCD_TARGET_LAT.shape[0]:
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
    interpolated = np.empty(
        (field.shape[0], RAW_MCD_TARGET_LAT.shape[0], field.shape[2]),
        dtype=np.float32,
    )
    flat = field_sorted.transpose(0, 2, 1).reshape(-1, field.shape[1])
    out_flat = np.empty((flat.shape[0], RAW_MCD_TARGET_LAT.shape[0]), dtype=np.float32)
    for index, row in enumerate(flat):
        out_flat[index] = np.interp(RAW_MCD_TARGET_LAT, lat_sorted, row).astype(np.float32)
    interpolated = out_flat.reshape(field.shape[0], field.shape[2], RAW_MCD_TARGET_LAT.shape[0]).transpose(0, 2, 1)
    return interpolated[:, :, :72]


def _load_raw_3h_mcd(
    raw_dir: Path,
    selected_channels: list[str],
) -> tuple[np.ndarray, np.ndarray, dict[str, np.ndarray]]:
    ozone_parts: list[np.ndarray] = []
    ls_parts: list[np.ndarray] = []
    feature_parts = {MCD_VARS_MAP[channel][1]: [] for channel in selected_channels}

    for file_path in sorted(Path(raw_dir).glob("*.nc"), key=natural_sort_key):
        with netCDF4.Dataset(str(file_path)) as dataset:
            if "O3COL" not in dataset.variables:
                continue
            if "lat" not in dataset.variables:
                raise ValueError(f"Raw MCD file {file_path} is missing lat")

            lat_values = dataset.variables["lat"][:]
            ozone = normalize_ozone_column_units(
                _fit_raw_mcd_lat_grid(dataset.variables["O3COL"][:], lat_values),
                getattr(dataset.variables["O3COL"], "units", None),
                allow_mcd_legacy_heuristic=True,
            )
            ozone_parts.append(_clean_array(ozone))
            ls_parts.append(_read_raw_mcd_ls_variable(dataset, file_path))

            for channel in selected_channels:
                variable_name, short_name = MCD_VARS_MAP[channel]
                raw_name = RAW_MCD_FIELD_MAP.get(variable_name)
                if raw_name is None:
                    feature_parts[short_name].append(np.zeros_like(ozone, dtype=np.float32))
                    continue
                if raw_name not in dataset.variables:
                    raise ValueError(f"Raw MCD file {file_path} is missing variable: {raw_name}")
                feature_parts[short_name].append(
                    _fit_raw_mcd_lat_grid(dataset.variables[raw_name][:], lat_values)
                )

    if not ozone_parts:
        raise FileNotFoundError(f"No raw 3h MCD .nc files found in {raw_dir}")

    ozone = _clean_array(np.concatenate(ozone_parts, axis=0))
    ls_values = _clean_array(np.concatenate(ls_parts, axis=0)).reshape(-1)
    features = {
        short_name: _clean_array(np.concatenate(parts, axis=0))
        for short_name, parts in feature_parts.items()
    }
    time_count = min(
        [int(ozone.shape[0]), int(ls_values.shape[0])]
        + [int(feature.shape[0]) for feature in features.values()]
    )
    if time_count <= 0:
        raise ValueError("Raw 3h MCD timeline is empty")
    return (
        ozone[:time_count],
        ls_values[:time_count],
        {name: feature[:time_count] for name, feature in features.items()},
    )


def _load_mcd_full_training_dataset(
    data_dir: Path,
    selected_channels: list[str],
) -> tuple[np.ndarray, np.ndarray, dict[str, np.ndarray]]:
    has_raw_files = False
    for file_path in sorted(Path(data_dir).glob("*.nc"), key=natural_sort_key):
        with netCDF4.Dataset(str(file_path)) as dataset:
            if "O3COL" in dataset.variables:
                has_raw_files = True
                break
    if has_raw_files:
        return _load_raw_3h_mcd(data_dir, selected_channels)
    return _load_mcd_overview(data_dir, selected_channels)


def _prepare_training_data(
    openmars_dir: Any,
    mcd_dir: Any,
    mcd_overview_dir: Any,
    selected_channels: Any,
    window: int,
    horizon: int,
    training_dataset: Any = TRAINING_DATASET_OPENMARS_MCD,
) -> PreparedTrainingData:
    from sklearn.preprocessing import StandardScaler

    selected = parse_selected_channels(selected_channels)
    dataset = normalize_training_dataset(training_dataset)
    window = int(window)
    horizon = int(horizon)
    if window <= 0 or horizon <= 0:
        raise ValueError("window and horizon must be positive")

    if dataset == TRAINING_DATASET_MCD_OVERVIEW:
        ozone, ls_values, features = _load_mcd_full_training_dataset(Path(mcd_overview_dir), selected)
    else:
        ozone, ls_values = _load_openmars(Path(openmars_dir))
        features = _load_mcd_features(Path(mcd_dir), selected, ls_values)

    feature_names = [MCD_VARS_MAP[channel][1] for channel in selected]
    feature_arrays = [ozone] + [features[name] for name in feature_names]
    time_count = min(
        [int(ls_values.shape[0])]
        + [int(feature.shape[0]) for feature in feature_arrays]
    )
    height = min(int(feature.shape[1]) for feature in feature_arrays)
    width = min(int(feature.shape[2]) for feature in feature_arrays)
    if time_count <= 0 or height <= 0 or width <= 0:
        raise ValueError("Loaded data has invalid dimensions")

    feature_arrays = [
        _clean_array(feature[:time_count, :height, :width])
        for feature in feature_arrays
    ]
    ozone = feature_arrays[0]
    ls_values = _clean_array(ls_values[:time_count]).reshape(-1)
    raw_inputs = np.stack(feature_arrays, axis=-1)
    sample_count = time_count - window - horizon + 1
    if sample_count <= 0:
        raise ValueError(
            "Not enough time steps for requested window and horizon: "
            f"time={time_count}, window={window}, horizon={horizon}"
        )

    split_time_index = int(0.8 * sample_count) + window
    split_time_index = max(1, min(time_count, split_time_index))
    scaled_inputs = np.zeros_like(raw_inputs, dtype=np.float32)
    for channel_index in range(raw_inputs.shape[-1]):
        scaler = StandardScaler()
        scaler.fit(raw_inputs[:split_time_index, ..., channel_index].reshape(split_time_index, -1))
        scaled_inputs[..., channel_index] = scaler.transform(
            raw_inputs[..., channel_index].reshape(time_count, -1)
        ).reshape(time_count, height, width)

    target_training_part = ozone[:split_time_index]
    target_mean = float(target_training_part.mean())
    target_std = float(target_training_part.std())
    scaled_target = (ozone - target_mean) / (target_std + 1e-6)

    input_sequences: list[np.ndarray] = []
    ls_sequences: list[np.ndarray] = []
    target_sequences: list[np.ndarray] = []
    for index in range(sample_count):
        input_sequences.append(scaled_inputs[index : index + window])
        ls_sequences.append(ls_values[index : index + window])
        target_sequences.append(scaled_target[index + window : index + window + horizon])

    x_tensor = torch.tensor(np.asarray(input_sequences)).permute(0, 1, 4, 2, 3).float()
    ls_tensor = torch.tensor(np.asarray(ls_sequences)).float()
    y_tensor = torch.tensor(np.asarray(target_sequences)).unsqueeze(2).float()
    return PreparedTrainingData(
        x=x_tensor,
        ls=ls_tensor,
        y=y_tensor,
        y_mean=target_mean,
        y_std=target_std,
        height=height,
        width=width,
    )


def prepare_training_tensors(
    openmars_dir: Any,
    mcd_dir: Any,
    mcd_overview_dir: Any,
    selected_channels: Any,
    window: int,
    horizon: int,
    training_dataset: Any = TRAINING_DATASET_OPENMARS_MCD,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, int, int]:
    prepared = _prepare_training_data(
        openmars_dir=openmars_dir,
        mcd_dir=mcd_dir,
        mcd_overview_dir=mcd_overview_dir,
        selected_channels=selected_channels,
        window=window,
        horizon=horizon,
        training_dataset=training_dataset,
    )
    return prepared.x, prepared.ls, prepared.y, prepared.height, prepared.width


def get_model_input_dim(
    model_architecture: Any,
    selected_channels: Any,
    use_sphere: Any,
) -> int:
    normalize_model_architecture(model_architecture)
    extra_channel_count = len(parse_selected_channels(selected_channels))
    return 1 + (2 * extra_channel_count if parse_bool(use_sphere) else extra_channel_count)


def apply_transfer_learning(
    model: nn.Module,
    hyperparameters: dict[str, Any],
    device: torch.device,
) -> str | None:
    if not parse_bool(hyperparameters.get("transfer_learning", False)):
        return None

    load_mode = str(hyperparameters.get("transfer_load_mode", "strict")).strip().lower()
    if load_mode != "strict":
        raise ValueError("Only strict transfer loading is supported")

    weight_path = os.environ.get("ARESVISION_TRANSFER_WEIGHT_PATH", "").strip()
    if not weight_path:
        raise ValueError("Transfer learning is enabled but ARESVISION_TRANSFER_WEIGHT_PATH is missing")

    state_dict = torch.load(weight_path, map_location=device, weights_only=True)
    model.load_state_dict(state_dict, strict=True)
    freeze_report = apply_freeze_strategy(model, hyperparameters.get("freeze_mode", "none"))
    print(
        f"[Transfer] Loaded strict weights from {Path(weight_path).name}; "
        f"freeze_mode={freeze_report['mode']}; "
        f"trainable_params={freeze_report['trainable_parameter_count']}/"
        f"{freeze_report['total_parameter_count']}",
        flush=True,
    )
    return weight_path


def build_official_model(
    hyperparameters: dict[str, Any],
    input_channels: int,
    height: int,
    width: int,
    device: torch.device,
) -> nn.Module:
    architecture = normalize_model_architecture(hyperparameters.get("model_architecture"))
    selected_channels = parse_selected_channels(hyperparameters.get("selected_channels"))
    hidden_dims = _parse_int_list(
        hyperparameters.get("stlstm_hidden_dims", [64, 64, 64]),
        [64, 64, 64],
    )
    model = build_forecaster(
        architecture=architecture,
        input_channels=int(input_channels),
        selected_channels=selected_channels,
        hidden_dims=hidden_dims,
        height=int(height),
        width=int(width),
        window=int(hyperparameters.get("window", 3)),
        horizon=int(hyperparameters.get("horizon", 3)),
        use_sphere=normalize_use_sphere(hyperparameters),
        architecture_params=extract_architecture_params(hyperparameters),
    ).to(device)
    apply_transfer_learning(model, hyperparameters, device)
    return model


def _assert_prediction_shape(prediction: Any, target: Any, context: str) -> None:
    actual_shape = tuple(getattr(prediction, "shape", ()))
    expected_shape = tuple(getattr(target, "shape", ()))
    if actual_shape != expected_shape:
        raise ValueError(
            f"{context} prediction shape mismatch: "
            f"expected shape {expected_shape}, actual shape {actual_shape}"
        )


def _split_training_data(
    prepared: PreparedTrainingData,
) -> tuple[TensorDataset, TensorDataset]:
    if len(prepared.x) < 2:
        raise ValueError("At least two training samples are required")
    split_index = int(0.8 * len(prepared.x))
    split_index = min(max(1, split_index), len(prepared.x) - 1)
    return (
        TensorDataset(
            prepared.x[:split_index],
            prepared.ls[:split_index],
            prepared.y[:split_index],
        ),
        TensorDataset(
            prepared.x[split_index:],
            prepared.ls[split_index:],
            prepared.y[split_index:],
        ),
    )


def _evaluate_metrics(
    target_scaled: np.ndarray,
    prediction_scaled: np.ndarray,
    target_mean: float,
    target_std: float,
) -> dict[str, float]:
    import sklearn.metrics as sk_metrics

    target = target_scaled.flatten() * (target_std + 1e-6) + target_mean
    prediction = prediction_scaled.flatten() * (target_std + 1e-6) + target_mean
    mse = float(sk_metrics.mean_squared_error(target, prediction))
    rmse = float(np.sqrt(mse))
    try:
        r2 = float(sk_metrics.r2_score(target, prediction))
    except Exception:
        r2 = 0.0
    mape = float(np.mean(np.abs((target - prediction) / (np.abs(target) + 1e-8))) * 100.0)
    smape = float(
        np.mean(
            2.0
            * np.abs(prediction - target)
            / (np.abs(target) + np.abs(prediction) + 1e-8)
        )
        * 100.0
    )
    return {"mse": mse, "rmse": rmse, "r2": r2, "mape": mape, "smape": smape}


def _build_parser() -> argparse.ArgumentParser:
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
    parser.add_argument("--model_architecture", type=str, default="predrnnv2")
    parser.add_argument("--use_sphere", type=str, default="false")
    parser.add_argument("--stlstm_hidden_dims", type=str, default="[64, 64, 64]")
    parser.add_argument("--transfer_learning", type=str, default="false")
    parser.add_argument("--transfer_source_type", type=str, default="")
    parser.add_argument("--transfer_load_mode", type=str, default="strict")
    parser.add_argument("--freeze_mode", type=str, default="none")
    parser.add_argument("--finetune_learning_rate", type=float, default=None)

    for key in ARCHITECTURE_INTEGER_PARAMS:
        parser.add_argument(f"--{key}", type=int, default=None)
    for key in ARCHITECTURE_FLOAT_PARAMS:
        parser.add_argument(f"--{key}", type=float, default=None)
    for key in ARCHITECTURE_INTEGER_LIST_PARAMS:
        parser.add_argument(f"--{key}", type=str, default=None)
    return parser


def _normalize_parsed_hyperparameters(args: argparse.Namespace) -> dict[str, Any]:
    hyperparameters = vars(args).copy()
    hyperparameters["selected_channels"] = parse_selected_channels(args.selected_channels)
    hyperparameters["stlstm_hidden_dims"] = _parse_int_list(
        args.stlstm_hidden_dims,
        [64, 64, 64],
    )
    hyperparameters["use_sphere"] = parse_bool(args.use_sphere)
    hyperparameters["transfer_learning"] = parse_bool(args.transfer_learning)
    for key in ARCHITECTURE_INTEGER_LIST_PARAMS:
        value = hyperparameters.get(key)
        if value is not None:
            hyperparameters[key] = _parse_int_list(value, ARCHITECTURE_INTEGER_LIST_PARAMS[key])
    return hyperparameters


def main() -> None:
    args, _unknown = _build_parser().parse_known_args()
    # Strict entry point: an unknown or not yet supported dataset must fail here,
    # before any data directory is touched.
    args.training_dataset = require_training_dataset(
        resolve_dataset_id(None, {"training_dataset": args.training_dataset})
    )
    hyperparameters = _normalize_parsed_hyperparameters(args)
    epochs = max(1, int(args.epochs))
    batch_size = max(1, int(args.batch_size))
    patience = max(0, int(args.early_stopping_patience))
    seed = max(0, int(args.seed))
    torch.manual_seed(seed)
    np.random.seed(seed)

    openmars_dir = Path(
        os.environ.get("ARESVISION_OPENMARS_DIR", str(BACKEND_DIR / "data" / "openmars"))
    )
    mcd_dir = Path(MCD_DIR)
    overview_dir = Path(
        os.environ.get(
            "MCD_RAW_3H_DIR",
            os.environ.get(
                "ARESVISION_MCD_RAW_3H_DIR",
                str(MCD_RAW_3H_DIR),
            ),
        )
    )
    prepared = _prepare_training_data(
        openmars_dir=openmars_dir,
        mcd_dir=mcd_dir,
        mcd_overview_dir=overview_dir,
        selected_channels=hyperparameters["selected_channels"],
        window=args.window,
        horizon=args.horizon,
        training_dataset=args.training_dataset,
    )
    train_dataset, validation_dataset = _split_training_data(prepared)
    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True)
    validation_loader = DataLoader(validation_dataset, batch_size=batch_size, shuffle=False)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = build_official_model(
        hyperparameters,
        input_channels=int(prepared.x.shape[2]),
        height=prepared.height,
        width=prepared.width,
        device=device,
    )
    criterion = nn.SmoothL1Loss()
    trainable_parameters = [parameter for parameter in model.parameters() if parameter.requires_grad]
    if not trainable_parameters:
        raise ValueError("Official model has no trainable parameters")
    optimizer_learning_rate = (
        args.finetune_learning_rate
        if hyperparameters["transfer_learning"]
        and args.finetune_learning_rate is not None
        and args.finetune_learning_rate > 0
        else args.learning_rate
    )
    optimizer = torch.optim.Adam(trainable_parameters, lr=float(optimizer_learning_rate))

    print(f"Training Device: {device}", flush=True)
    print(
        f"OfficialModel={hyperparameters['model_architecture']}, "
        f"TrainingDataset={normalize_training_dataset(args.training_dataset)}, "
        f"Channels={hyperparameters['selected_channels']}, "
        f"UseSphere={hyperparameters['use_sphere']}",
        flush=True,
    )
    print("\n[Step 3] Start Training...", flush=True)

    best_validation_loss = float("inf")
    patience_counter = 0
    for epoch in range(1, epochs + 1):
        model.train()
        training_loss_sum = 0.0
        for batch_index, (inputs, ls_values, targets) in enumerate(train_loader, start=1):
            inputs = inputs.to(device)
            ls_values = ls_values.to(device)
            targets = targets.to(device)
            optimizer.zero_grad()
            predictions = model(inputs, ls_values)
            _assert_prediction_shape(
                predictions,
                targets,
                f"training epoch {epoch} batch {batch_index}",
            )
            loss = criterion(predictions, targets)
            loss.backward()
            optimizer.step()
            training_loss_sum += float(loss.item())
            if batch_index % 20 == 0 or batch_index == len(train_loader):
                print(
                    f"Epoch {epoch}/{epochs} Batch {batch_index}/{len(train_loader)} "
                    f"Loss={loss.item():.4f}",
                    flush=True,
                )

        model.eval()
        validation_loss_sum = 0.0
        with torch.no_grad():
            for inputs, ls_values, targets in validation_loader:
                inputs = inputs.to(device)
                ls_values = ls_values.to(device)
                targets = targets.to(device)
                predictions = model(inputs, ls_values)
                _assert_prediction_shape(predictions, targets, f"validation epoch {epoch}")
                validation_loss_sum += float(criterion(predictions, targets).item())

        training_loss = training_loss_sum / max(1, len(train_loader))
        validation_loss = validation_loss_sum / max(1, len(validation_loader))
        print(
            f"Epoch {epoch}/{epochs} Loss={training_loss:.4f} "
            f"Val Loss={validation_loss:.4f}",
            flush=True,
        )

        if patience > 0:
            if validation_loss < best_validation_loss:
                best_validation_loss = validation_loss
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
    target_batches: list[np.ndarray] = []
    prediction_batches: list[np.ndarray] = []
    with torch.no_grad():
        for batch_index, (inputs, ls_values, targets) in enumerate(validation_loader, start=1):
            predictions = model(inputs.to(device), ls_values.to(device))
            _assert_prediction_shape(
                predictions,
                targets.to(device),
                f"metrics batch {batch_index}",
            )
            prediction_batches.append(predictions.cpu().numpy())
            target_batches.append(targets.numpy())
    if not target_batches:
        raise ValueError("No validation batches available for metrics")

    metrics = _evaluate_metrics(
        np.concatenate(target_batches, axis=0),
        np.concatenate(prediction_batches, axis=0),
        prepared.y_mean,
        prepared.y_std,
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
