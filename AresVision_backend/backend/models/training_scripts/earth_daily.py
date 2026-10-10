"""Independent Earth MERRA-2 training entry point for the official DLinear model.

This script deliberately does not touch any Mars data path: it reads a verified
daily or three-hour release through the dataset registry, builds its dataset
profile's windows with training-only normalization, trains the official
DLinear, evaluates validation and test in DU and writes one versioned checkpoint.

The parent process passes everything through ``ARESVISION_EARTH_TRAINING_SPEC``
rather than the command line, so dataset identity, the release fingerprint and
the snapshot never become CLI arguments. Only ``--output_path`` is parsed here.

Progress output keeps the existing parent-side format::

    Epoch 1/10 Batch 1/45 Loss=0.123456
    Epoch 1/10 Loss=0.110000 Val Loss=0.120000
    Earth best epoch: 1
    Earth metrics unit: DU
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path
from typing import Any, Optional

import numpy as np
import torch
import torch.nn as nn

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.dataset_registry import DatasetRegistry  # noqa: E402
from services.dataset_identity import DatasetRequestError, EARTH_DATASET_3HOURLY_ID  # noqa: E402
from services.earth_dataset import (  # noqa: E402
    EarthOzoneWindows, EarthThreeHourlyWindows, build_threehour_training_cache,
    fit_threehour_normalization, THREE_HOURLY_GRID_SHAPE,
)
from training_backbones.earth_3hourly_uploaded_contract import (  # noqa: E402
    FULL_GRID_CONTRACT_SCHEMA, contract_profile,
)
from services.earth_training_artifact import (  # noqa: E402
    EarthArtifactError,
    ErrorAccumulator,
    assert_release_matches_binding,
    build_checkpoint_payload,
    build_earth_model_from_checkpoint,
    build_metrics_block,
    load_earth_training_artifact,
    normalization_from_release,
    save_earth_artifact_atomic,
)
from services.earth_training_contract import (  # noqa: E402
    EARTH_HORIZON,
    EARTH_TRAINING_SPEC_SCHEMA,
    EARTH_WINDOW,
    normalize_earth_training_hyperparameters,
    earth_training_profile,
    split_window_counts,
)
from services.earth_model_source import (  # noqa: E402
    MODEL_SOURCE_OFFICIAL,
    MODEL_SOURCE_UPLOADED,
    EarthModelBuildError,
    ModelSourcePlan,
    build_earth_model_for_plan,
    earth_forward_for_model,
)

SPEC_ENV_VAR = "ARESVISION_EARTH_TRAINING_SPEC"
PROGRESS_EVERY_BATCHES = 20
GRID_HORIZON_INDEX = 1
THREE_HOUR_TILE_SHAPE = (24, 48)


class EarthTrainingError(RuntimeError):
    """A training failure that must not publish a completed artifact."""


def resolve_device(requested: Optional[str] = None) -> torch.device:
    """Pick the execution device; tests may pin it explicitly."""
    if requested:
        return torch.device(requested)
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed % (2**32))
    torch.manual_seed(seed)


def _uses_full_grid(spec: dict) -> bool:
    reference = spec.get('uploaded_model') or {}
    full_grid = reference.get('contract_schema') == FULL_GRID_CONTRACT_SCHEMA
    if full_grid and (spec['dataset_binding']['dataset_id'] != EARTH_DATASET_3HOURLY_ID
                      or spec['hyperparameters'].get('model_source') != MODEL_SOURCE_UPLOADED):
        raise EarthTrainingError('The full-grid contract requires an uploaded three-hour Earth model')
    return full_grid


def _build_loaders(
    spec: dict,
    registry: DatasetRegistry,
    batch_size: int,
    seed: int,
    cache_root: Optional[Path] = None,
    device: Optional[torch.device] = None,
):
    """Build the three split datasets sharing one training-fitted normalization."""
    binding = spec["dataset_binding"]
    full_grid = _uses_full_grid(spec)
    max_batch_size = contract_profile(FULL_GRID_CONTRACT_SCHEMA)['max_batch_size']
    if full_grid and (type(batch_size) is not int or not 1 <= batch_size <= max_batch_size):
        raise EarthTrainingError(f'Full-grid Earth training batch_size must be an integer between 1 and {max_batch_size}')
    print('Earth preparation: loading verified dataset and checking task binding', flush=True)
    hyperparameters = normalize_earth_training_hyperparameters(
        spec["hyperparameters"], dataset_id=binding["dataset_id"]
    )
    profile = earth_training_profile(binding["dataset_id"], hyperparameters)
    release = registry.get_earth_snapshot(binding["dataset_id"])
    assert_release_matches_binding(release, binding)

    selected = hyperparameters["selected_channels"]
    # Fit on the frozen task train interval (manifest for legacy tasks), then
    # independently build windows inside each partition.
    task_split = spec.get("task_split")
    if "task_split" in spec:
        from services.earth_task_split import validate_earth_task_split
        validate_earth_task_split(task_split, release.dates, profile["window"], profile["horizon"], hyperparameters)
    window_type = EarthThreeHourlyWindows if binding["dataset_id"] == EARTH_DATASET_3HOURLY_ID else EarthOzoneWindows
    if window_type is EarthThreeHourlyWindows:
        normalization = fit_threehour_normalization(
            release, ["TO3", *selected], task_split=task_split,
            progress=lambda message: print(message, flush=True),
        )
    else:
        normalization = normalization_from_release(release, ["TO3", *selected], task_split=task_split)
    splits = {
        name: window_type.from_release(
            release,
            split=name,
            window=profile["window"],
            horizon=profile["horizon"],
            selected_channels=selected,
            normalization=normalization,
            **({"task_split": task_split} if window_type is EarthThreeHourlyWindows else {}),
        )
        for name in ("train", "validation", "test")
    }
    counts = {name: len(dataset) for name, dataset in splits.items()}
    if window_type is EarthThreeHourlyWindows:
        from config import EARTH_TRAINING_CACHE_DIR
        cache_path = build_threehour_training_cache(
            release, ["TO3", *selected], normalization,
            cache_root if cache_root is not None else EARTH_TRAINING_CACHE_DIR,
            full_grid=full_grid, progress=lambda message: print(message, flush=True),
        )
        for dataset in splits.values():
            dataset.use_training_cache(cache_path)
    split_ranges = {
        name: {
            "date_start": (np.datetime_as_string(dataset.dates[0], unit="s") + "Z"
                           if window_type is EarthThreeHourlyWindows else str(dataset.dates[0])),
            "date_end": (np.datetime_as_string(dataset.dates[-1], unit="s") + "Z"
                         if window_type is EarthThreeHourlyWindows else str(dataset.dates[-1])),
            "window_count": int(len(dataset)),
        }
        for name, dataset in splits.items()
    }
    if task_split is not None:
        split_ranges = task_split["ranges"]
    generator = torch.Generator()
    generator.manual_seed(seed)
    wrapper = _SpatialTileDataset if window_type is EarthThreeHourlyWindows and not full_grid else _ArrayDataset
    pin_memory = device is not None and device.type == 'cuda'
    train_loader = torch.utils.data.DataLoader(
        wrapper(splits["train"]),
        batch_size=batch_size,
        shuffle=True,
        num_workers=0,
        pin_memory=pin_memory,
        generator=generator,
    )
    validation_loader = torch.utils.data.DataLoader(
        wrapper(splits["validation"]),
        batch_size=batch_size,
        shuffle=False,
        num_workers=0,
        pin_memory=pin_memory,
    )
    test_loader = torch.utils.data.DataLoader(
        wrapper(splits["test"]),
        batch_size=batch_size,
        shuffle=False,
        num_workers=0,
        pin_memory=pin_memory,
    )
    spatial_mode = 'spatial_tile' if wrapper is _SpatialTileDataset else 'full_grid'
    print(
        f'Earth preparation complete: spatial mode={spatial_mode}, '
        f'train samples={len(train_loader.dataset)}, batches={len(train_loader)}',
        flush=True,
    )
    return {
        "release": release,
        "profile": profile,
        "normalization": normalization,
        "input_channel_order": ["TO3", *selected],
        "splits": splits,
        "counts": counts,
        "split_ranges": split_ranges,
        "task_split": task_split,
        "train_loader": train_loader,
        "validation_loader": validation_loader,
        "test_loader": test_loader,
        "full_grid": full_grid,
    }


class _ArrayDataset(torch.utils.data.Dataset):
    """Convert only the requested window; never expand all overlapping windows."""

    def __init__(self, source: EarthOzoneWindows):
        self.source = source

    def __len__(self) -> int:
        return len(self.source)

    def __getitem__(self, index):
        inputs, targets = self.source[index]
        return torch.from_numpy(inputs), torch.from_numpy(targets)

    def __getitems__(self, indices):
        if not hasattr(self.source, 'read_windows'):
            return [self[index] for index in indices]
        requests = [(index, slice(None), slice(None)) for index in indices]
        return [(torch.from_numpy(inputs), torch.from_numpy(targets))
                for inputs, targets in self.source.read_windows(requests)]


class _SpatialTileDataset(_ArrayDataset):
    """Read disjoint tiles for the shared, spatially independent DLinear weights.

    A batch is a batch of spatial tiles. Temporal sample counts still refer to
    forecast windows; evaluation visits every cell of every window exactly once.
    """

    def __init__(self, source):
        super().__init__(source)
        self.tiles = [
            (slice(lat, lat + THREE_HOUR_TILE_SHAPE[0]),
             slice(lon, lon + THREE_HOUR_TILE_SHAPE[1]))
            for lat in range(0, 240, THREE_HOUR_TILE_SHAPE[0])
            for lon in range(0, 480, THREE_HOUR_TILE_SHAPE[1])
        ]

    def __len__(self):
        return len(self.source) * len(self.tiles)

    def __getitem__(self, index):
        window_index, tile_index = divmod(index, len(self.tiles))
        latitude, longitude = self.tiles[tile_index]
        inputs, targets = self.source.read_window(
            window_index, lat_slice=latitude, lon_slice=longitude
        )
        return torch.from_numpy(inputs), torch.from_numpy(targets)

    def __getitems__(self, indices):
        if not hasattr(self.source, 'read_windows'):
            return [self[index] for index in indices]
        requests = []
        for index in indices:
            window, tile = divmod(index, len(self.tiles))
            latitude, longitude = self.tiles[tile]
            requests.append((window, latitude, longitude))
        return [(torch.from_numpy(inputs), torch.from_numpy(targets))
                for inputs, targets in self.source.read_windows(requests)]


def _require_finite_gradients(model):
    parameters = [(name, parameter) for name, parameter in model.named_parameters()
                  if parameter.grad is not None]
    if not parameters:
        return
    flags = torch.stack([torch.isfinite(parameter.grad).all() for _, parameter in parameters])
    if not flags.all():
        invalid = flags.detach().cpu().tolist().index(False)
        raise EarthTrainingError(f"Non-finite gradient for {parameters[invalid][0]}")


def _forward_batch(model, inputs, *, model_source, horizon):
    return earth_forward_for_model(
        model, inputs, model_source=model_source, horizon=horizon,
        height=inputs.shape[-2], width=inputs.shape[-1],
    )


def _evaluate_split(
    model: nn.Module,
    loader,
    dataset: EarthOzoneWindows,
    device: torch.device,
    *,
    loss_function: nn.Module,
    model_source: str = MODEL_SOURCE_OFFICIAL,
) -> tuple[dict, float]:
    """Return DU metrics plus the mean normalized MSE for a whole partition."""
    model.eval()
    dataset_id = (getattr(getattr(dataset, "_release", None), "metadata", {}) or {}).get("dataset_id")
    horizon = getattr(dataset, "horizon", EARTH_HORIZON)
    accumulator = ErrorAccumulator(dataset_id=dataset_id, horizon=horizon)
    total_loss = 0.0
    total_loss_elements = 0
    with torch.no_grad():
        for inputs, targets in loader:
            inputs = inputs.to(device, non_blocking=device.type == 'cuda')
            targets = targets.to(device, non_blocking=device.type == 'cuda')
            output = _forward_batch(model, inputs, model_source=model_source, horizon=horizon)
            if not torch.isfinite(output).all():
                raise EarthTrainingError("Non-finite model output during evaluation")
            loss = loss_function(output, targets)
            if not torch.isfinite(loss):
                raise EarthTrainingError("Non-finite evaluation loss")
            elements = int(output.numel())
            total_loss += float(loss.item()) * elements
            total_loss_elements += elements
            prediction_du = dataset.denormalize_ozone(output[:, :, 0]).detach().cpu().numpy()
            target_du = dataset.denormalize_ozone(targets[:, :, 0]).detach().cpu().numpy()
            accumulator.update(prediction_du[:, :, None], target_du[:, :, None])
    if total_loss_elements == 0:
        raise EarthTrainingError("Evaluation loader produced no batches")
    return accumulator.result(), total_loss / total_loss_elements


def run_training(
    spec: dict,
    output_path: Path,
    registry: DatasetRegistry,
    device: Optional[str] = None,
    cache_root: Optional[Path] = None,
) -> dict:
    """Train, evaluate and publish one Earth checkpoint.

    Returns a small result summary. Raises on any failure; the caller treats a
    non-zero exit code as a failed task and no artifact is published.
    """
    if not isinstance(spec, dict):
        raise EarthTrainingError("Training spec must be an object")
    if spec.get("schema") != EARTH_TRAINING_SPEC_SCHEMA:
        raise EarthTrainingError("Unsupported Earth training spec schema")
    task_id = spec.get("task_id")
    if not isinstance(task_id, int) or task_id < 1:
        raise EarthTrainingError("Training spec has no valid task id")
    binding = spec.get("dataset_binding")
    if not isinstance(binding, dict):
        raise EarthTrainingError("Training spec has no dataset binding")

    hyperparameters = normalize_earth_training_hyperparameters(
        spec["hyperparameters"], dataset_id=binding["dataset_id"]
    )
    profile = earth_training_profile(binding["dataset_id"], hyperparameters)
    if spec.get("training_profile") is not None and spec["training_profile"] != profile:
        raise EarthTrainingError("Training spec profile disagrees with the dataset")
    epochs = hyperparameters["epochs"]
    batch_size = hyperparameters["batch_size"]
    learning_rate = hyperparameters["learning_rate"]
    seed = hyperparameters["seed"]
    patience = hyperparameters["early_stopping_patience"]
    hidden_layers = hyperparameters["linear_hidden_layers"]

    # The server pinned the model source and, for an uploaded model, its exact
    # verified reference. Nothing here re-reads the user's current upload, so a new
    # version published after this task was created cannot change the trained code.
    raw_source = str(spec.get("hyperparameters", {}).get("model_source") or "official").strip().lower()
    model_source = MODEL_SOURCE_UPLOADED if raw_source == "uploaded" else MODEL_SOURCE_OFFICIAL
    uploaded_reference = spec.get("uploaded_model")
    if model_source == MODEL_SOURCE_UPLOADED and not isinstance(uploaded_reference, dict):
        raise EarthTrainingError(
            "This Earth task was pinned to an uploaded model but the training spec has "
            "no model reference"
        )
    if model_source == MODEL_SOURCE_UPLOADED:
        # The pinned reference carries the parameters that were validated at task
        # creation. Request-level values only fill gaps, so a later request can never
        # retroactively change what a pinned reference already fixed.
        uploaded_reference = dict(uploaded_reference)
        request_params = spec.get("hyperparameters", {}).get("custom_model_params")
        if isinstance(request_params, dict):
            merged = dict(request_params)
            merged.update(uploaded_reference.get("custom_model_params") or {})
            uploaded_reference["custom_model_params"] = merged

    seed_everything(seed)
    resolved_device = resolve_device(device)
    prepared = _build_loaders(spec, registry, batch_size, seed, cache_root=cache_root, device=resolved_device)
    order = prepared["input_channel_order"]
    dataset_by_name = prepared["splits"]
    train_dataset = dataset_by_name["train"]

    plan = ModelSourcePlan(
        model_source=model_source,
        input_channel_order=order,
        linear_hidden_layers=hidden_layers,
        uploaded_model=uploaded_reference if model_source == MODEL_SOURCE_UPLOADED else None,
        dataset_id=binding["dataset_id"],
        window=profile['window'], horizon=profile['horizon'],
    )
    try:
        model, model_build_config, model_warnings = build_earth_model_for_plan(plan)
    except EarthModelBuildError as exc:
        raise EarthTrainingError(str(exc)) from exc
    model = model.to(resolved_device)
    for warning in model_warnings:
        print(f"Earth model warning: {warning}", flush=True)
    loss_function = nn.MSELoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)

    model_label = (
        f"uploaded:{uploaded_reference.get('display_name')}"
        f"@v{uploaded_reference.get('version')}"
        if model_source == MODEL_SOURCE_UPLOADED
        else "official:dlinear"
    )
    print(f"Training Device: {resolved_device}", flush=True)
    print(
        f"EarthModel={model_label}, Dataset={binding['dataset_id']}@{binding['dataset_version']}, "
        f"Channels={','.join(order)}, Window={profile['window']}, Horizon={profile['horizon']}",
        flush=True,
    )
    if model_source == MODEL_SOURCE_UPLOADED:
        print(
            f"Earth uploaded model source sha256="
            f"{str(uploaded_reference.get('content_hash'))[:12]}… "
            f"(pinned at task creation)",
            flush=True,
        )
    print(
        "Earth split windows: "
        + ", ".join(f"{name}={count}" for name, count in prepared["counts"].items()),
        flush=True,
    )
    print(f"Earth normalization fitted on: {train_dataset.normalization['fit_date_start']} "
          f"to {train_dataset.normalization['fit_date_end']}", flush=True)

    history = {"train": [], "val": []}
    best_validation_loss: Optional[float] = None
    best_epoch = 0
    best_state: Optional[dict] = None
    epochs_completed = 0
    stopped_early = False
    epochs_without_improvement = 0
    start_time = time.time()

    for epoch in range(1, epochs + 1):
        model.train()
        running_loss = 0.0
        loss_elements = 0
        total_batches = len(prepared["train_loader"])
        for batch_index, (inputs, targets) in enumerate(prepared["train_loader"], start=1):
            inputs = inputs.to(resolved_device, non_blocking=resolved_device.type == 'cuda')
            targets = targets.to(resolved_device, non_blocking=resolved_device.type == 'cuda')
            optimizer.zero_grad(set_to_none=True)
            output = _forward_batch(model, inputs, model_source=model_source, horizon=profile["horizon"])
            if not torch.isfinite(output).all():
                raise EarthTrainingError("Non-finite model output during training")
            loss = loss_function(output, targets)
            if not torch.isfinite(loss):
                raise EarthTrainingError("Non-finite training loss")
            loss.backward()
            _require_finite_gradients(model)
            optimizer.step()
            elements = int(output.numel())
            running_loss += float(loss.item()) * elements
            loss_elements += elements
            if batch_index % PROGRESS_EVERY_BATCHES == 0 or batch_index == total_batches:
                print(
                    f"Epoch {epoch}/{epochs} Batch {batch_index}/{total_batches} "
                    f"Loss={loss.item():.6f}",
                    flush=True,
                )

        training_loss = running_loss / max(loss_elements, 1)
        validation_metrics, validation_loss = _evaluate_split(
            model,
            prepared["validation_loader"],
            dataset_by_name["validation"],
            resolved_device,
            loss_function=loss_function,
            model_source=model_source,
        )
        epochs_completed = epoch
        print(
            f"Epoch {epoch}/{epochs} Loss={training_loss:.6f} "
            f"Val Loss={validation_loss:.6f}",
            flush=True,
        )
        if len(history["train"]) < epoch:
            history["train"].append(training_loss)
            history["val"].append(validation_loss)

        improved = best_validation_loss is None or validation_loss < best_validation_loss
        if improved:
            best_validation_loss = validation_loss
            best_epoch = epoch
            best_state = {
                key: value.detach().to("cpu").clone()
                for key, value in model.state_dict().items()
            }
            epochs_without_improvement = 0
        else:
            epochs_without_improvement += 1
            if patience > 0 and epochs_without_improvement >= patience:
                print(
                    f"[Early Stopping] Val loss did not improve for {patience} epochs. "
                    f"Stopped at epoch {epoch}.",
                    flush=True,
                )
                stopped_early = True
                break

    if best_state is None:
        raise EarthTrainingError("Training produced no best weights")
    print(f"Earth best epoch: {best_epoch}", flush=True)

    model.load_state_dict(best_state, strict=True)
    model.to(resolved_device)
    validation_metrics, validation_loss = _evaluate_split(
        model,
        prepared["validation_loader"],
        dataset_by_name["validation"],
        resolved_device,
        loss_function=loss_function,
        model_source=model_source,
    )
    test_metrics, test_loss = _evaluate_split(
        model,
        prepared["test_loader"],
        dataset_by_name["test"],
        resolved_device,
        loss_function=loss_function,
        model_source=model_source,
    )
    print("Earth metrics unit: DU", flush=True)
    print(
        f"Earth validation RMSE={validation_metrics['overall']['rmse']:.6f} "
        f"MAE={validation_metrics['overall']['mae']:.6f}",
        flush=True,
    )
    print(
        f"Earth test RMSE={test_metrics['overall']['rmse']:.6f} "
        f"MAE={test_metrics['overall']['mae']:.6f}",
        flush=True,
    )
    for row in test_metrics["by_lead"]:
        print(
            f"Earth test lead {row.get('lead_hours', row.get('lead_day'))} "
            f"{'hours' if 'lead_hours' in row else 'day'}: RMSE={row['rmse']:.6f} "
            f"MAE={row['mae']:.6f}",
            flush=True,
        )
    for row in test_metrics.get("by_horizon", []):
        print(f"Earth test cumulative {row['horizon_hours']} hours: "
              f"RMSE={row['rmse']:.6f} MAE={row['mae']:.6f}", flush=True)

    metrics = build_metrics_block(
        validation=validation_metrics,
        test=test_metrics,
        validation_window_count=prepared["counts"]["validation"],
        test_window_count=prepared["counts"]["test"],
        dataset_id=binding["dataset_id"],
        horizon=profile['horizon'],
    )
    run = {
        "task_id": task_id,
        "seed": seed,
        "optimizer": "Adam",
        "loss": "normalized_mse_grid_uniform",
        "hyperparameters": hyperparameters,
        "best_epoch": best_epoch,
        "epochs_completed": epochs_completed,
        "best_validation_loss": float(best_validation_loss),
        "final_validation_loss": float(validation_loss),
        "final_test_loss": float(test_loss),
        "stopped_early": bool(stopped_early),
        "run_complete": True,
        "created_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "python_version": sys.version.split()[0],
        "torch_version": torch.__version__,
        "device": str(resolved_device),
        "duration_seconds": round(time.time() - start_time, 3),
    }
    if binding["dataset_id"] == EARTH_DATASET_3HOURLY_ID:
        if prepared["full_grid"]:
            run["memory_strategy"] = "normalized_memmap_full_grid"
            run["spatial_grid_shape"] = list(THREE_HOURLY_GRID_SHAPE)
            run["batch_unit"] = "global_time_window"
        else:
            run["memory_strategy"] = "normalized_memmap_spatial_tiles"
            run["spatial_tile_shape"] = list(THREE_HOUR_TILE_SHAPE)
            run["batch_unit"] = "spatial_tile"
        run["missing_value_policy"] = "reject_selected_channel_missing_values"
    uploaded_block = None
    if model_source == MODEL_SOURCE_UPLOADED:
        uploaded_block = {
            "package_id": uploaded_reference.get("package_id"),
            "display_name": uploaded_reference.get("display_name"),
            "version": uploaded_reference.get("version"),
            "content_hash": uploaded_reference.get("content_hash"),
            "source_path": uploaded_reference.get("source_path"),
            "source_text": uploaded_reference.get("source_text"),
            "param_schema": uploaded_reference.get("param_schema") or {},
            "custom_model_params": uploaded_reference.get("custom_model_params") or {},
            "build_config": model_build_config,
            "contract_schema": uploaded_reference.get("contract_schema"),
            "input_channel_order": order,
        }
    payload = build_checkpoint_payload(
        model=model,
        input_channel_order=order,
        linear_hidden_layers=hidden_layers,
        dataset_binding=binding,
        normalization=prepared["normalization"],
        run=run,
        metrics=metrics,
        split_window_counts=prepared["counts"],
        split_ratios={
            "train_ratio": hyperparameters["train_ratio"],
            "validation_ratio": hyperparameters["validation_ratio"],
            "test_ratio": hyperparameters["test_ratio"],
        },
        split_ranges=prepared["split_ranges"],
        task_split=prepared["task_split"],
        task_id=task_id,
        model_source=model_source,
        uploaded_model=uploaded_block,
    )
    saved_path = save_earth_artifact_atomic(payload, output_path, strict_reload=True)
    # Final proof on the published file: reload it strictly and reproduce the
    # first test batch, so a corrupt write can never be reported as success.
    checkpoint = load_earth_training_artifact(
        saved_path, expected_binding=binding, expected_task_id=task_id
    )
    reloaded, reload_warnings = build_earth_model_from_checkpoint(checkpoint)
    for warning in reload_warnings:
        print(f"Earth reload warning: {warning}", flush=True)
    reloaded.to(resolved_device)
    sample_inputs, _ = next(iter(prepared["test_loader"]))
    sample_inputs = sample_inputs.to(resolved_device)
    with torch.no_grad():
        before = _forward_batch(model, sample_inputs, model_source=model_source, horizon=profile["horizon"])
        after = _forward_batch(reloaded, sample_inputs, model_source=model_source, horizon=profile["horizon"])
    if not torch.equal(before, after):
        raise EarthTrainingError("The published checkpoint does not reproduce the trained model")
    print(f"Model saved: {saved_path}", flush=True)
    print("Earth training completed", flush=True)
    return {
        "output_path": saved_path,
        "best_epoch": best_epoch,
        "epochs_completed": epochs_completed,
        "split_window_counts": prepared["counts"],
        "metrics": checkpoint.metrics,
        "model_source": model_source,
        "model_identity": checkpoint.model_identity(),
        "warnings": list(model_warnings) + list(reload_warnings),
    }


def _load_spec_from_env() -> dict:
    raw = os.environ.get(SPEC_ENV_VAR, "")
    if not raw.strip():
        raise EarthTrainingError(
            f"Missing {SPEC_ENV_VAR}; Earth training must be started by the training service"
        )
    try:
        spec = json.loads(raw)
    except ValueError as exc:
        raise EarthTrainingError(f"{SPEC_ENV_VAR} is not valid JSON: {exc}") from exc
    if not isinstance(spec, dict):
        raise EarthTrainingError(f"{SPEC_ENV_VAR} must contain a JSON object")
    return spec


def _build_registry(spec: Optional[dict] = None) -> DatasetRegistry:
    from config import EARTH_MERRA2_DIR, EARTH_MERRA2_V1_DIR, EARTH_MERRA2_3HOURLY_DIR

    threehour_dir = EARTH_MERRA2_3HOURLY_DIR
    if (spec or {}).get("dataset_binding", {}).get("dataset_id") == "earth_merra2_3hourly_v1":
        data_path = (spec or {}).get("data_path")
        if data_path is not None:
            path = Path(data_path)
            if path.name != "earth_merra2_3hourly.nc" or not path.is_absolute():
                raise EarthTrainingError("The server three-hour data path is invalid")
            threehour_dir = path.parent
    return DatasetRegistry(
        EARTH_MERRA2_DIR,
        earth_dataset_id="earth_merra2_daily_v2",
        legacy_earth_package_dir=EARTH_MERRA2_V1_DIR,
        earth_3hourly_package_dir=threehour_dir,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Earth MERRA-2 DLinear training")
    parser.add_argument("--output_path", type=str, required=True)
    args = parser.parse_args()
    try:
        spec = _load_spec_from_env()
        run_training(spec, Path(args.output_path), _build_registry(spec))
    except (EarthTrainingError, EarthArtifactError, DatasetRequestError, ValueError) as exc:
        print(f"Earth training failed: {exc}", flush=True)
        return 1
    except Exception as exc:  # pragma: no cover - unexpected, surfaced verbatim
        print(f"Earth training failed unexpectedly: {type(exc).__name__}: {exc}", flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
