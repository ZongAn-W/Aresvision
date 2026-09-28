"""Independent Earth MERRA-2 training entry point for the official DLinear model.

This script deliberately does not touch any Mars data path: it reads a verified
``earth_merra2_daily_v2`` (or v1) release through the dataset registry, builds
7 day -> 3 day windows with training-only normalization, trains the official
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
from services.dataset_identity import DatasetRequestError  # noqa: E402
from services.earth_dataset import EarthOzoneWindows  # noqa: E402
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


def _build_loaders(
    spec: dict,
    registry: DatasetRegistry,
    batch_size: int,
    seed: int,
):
    """Build the three split datasets sharing one training-fitted normalization."""
    binding = spec["dataset_binding"]
    hyperparameters = normalize_earth_training_hyperparameters(spec["hyperparameters"])
    release = registry.get_earth_snapshot(binding["dataset_id"])
    assert_release_matches_binding(release, binding)

    selected = hyperparameters["selected_channels"]
    normalization = normalization_from_release(release, ["TO3", *selected])
    splits = {}
    for name in ("train", "validation", "test"):
        splits[name] = EarthOzoneWindows.from_release(
            release,
            split=name,
            window=EARTH_WINDOW,
            horizon=EARTH_HORIZON,
            selected_channels=selected,
            normalization=normalization,
        )
    counts = split_window_counts(
        {name: len(dataset.dates) for name, dataset in splits.items()}
    )
    expected = (release.metadata.get("splits") or {})
    for name in ("train", "validation", "test"):
        published_days = int(expected.get(name, {}).get("days", 0) or 0)
        if published_days and published_days != len(splits[name].dates):
            raise EarthTrainingError(
                f"Published {name} split has {published_days} days but the release "
                f"yielded {len(splits[name].dates)}"
            )
    generator = torch.Generator()
    generator.manual_seed(seed)
    train_loader = torch.utils.data.DataLoader(
        _ArrayDataset(splits["train"]),
        batch_size=batch_size,
        shuffle=True,
        num_workers=0,
        generator=generator,
    )
    validation_loader = torch.utils.data.DataLoader(
        _ArrayDataset(splits["validation"]),
        batch_size=batch_size,
        shuffle=False,
        num_workers=0,
    )
    test_loader = torch.utils.data.DataLoader(
        _ArrayDataset(splits["test"]),
        batch_size=batch_size,
        shuffle=False,
        num_workers=0,
    )
    return {
        "release": release,
        "normalization": normalization,
        "input_channel_order": ["TO3", *selected],
        "splits": splits,
        "counts": counts,
        "train_loader": train_loader,
        "validation_loader": validation_loader,
        "test_loader": test_loader,
    }


class _ArrayDataset(torch.utils.data.Dataset):
    """Thin Tensor wrapper so the loaders can use the default collate."""

    def __init__(self, source: EarthOzoneWindows):
        self.source = source
        self.inputs = torch.from_numpy(
            np.stack([source[index][0] for index in range(len(source))])
        )
        self.targets = torch.from_numpy(
            np.stack([source[index][1] for index in range(len(source))])
        )

    def __len__(self) -> int:
        return len(self.source)

    def __getitem__(self, index):
        return self.inputs[index], self.targets[index]


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
    accumulator = ErrorAccumulator()
    total_loss = 0.0
    total_batches = 0
    with torch.no_grad():
        for inputs, targets in loader:
            inputs = inputs.to(device)
            targets = targets.to(device)
            output = earth_forward_for_model(model, inputs, model_source=model_source)
            if not torch.isfinite(output).all():
                raise EarthTrainingError("Non-finite model output during evaluation")
            loss = loss_function(output, targets)
            if not torch.isfinite(loss):
                raise EarthTrainingError("Non-finite evaluation loss")
            total_loss += float(loss.item())
            total_batches += 1
            prediction_du = dataset.denormalize_ozone(output[:, :, 0]).detach().cpu().numpy()
            target_du = dataset.denormalize_ozone(targets[:, :, 0]).detach().cpu().numpy()
            accumulator.update(prediction_du[:, :, None], target_du[:, :, None])
    if total_batches == 0:
        raise EarthTrainingError("Evaluation loader produced no batches")
    return accumulator.result(), total_loss / total_batches


def run_training(
    spec: dict,
    output_path: Path,
    registry: DatasetRegistry,
    device: Optional[str] = None,
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

    hyperparameters = normalize_earth_training_hyperparameters(spec["hyperparameters"])
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
    prepared = _build_loaders(spec, registry, batch_size, seed)
    order = prepared["input_channel_order"]
    dataset_by_name = prepared["splits"]
    train_dataset = dataset_by_name["train"]

    plan = ModelSourcePlan(
        model_source=model_source,
        input_channel_order=order,
        linear_hidden_layers=hidden_layers,
        uploaded_model=uploaded_reference if model_source == MODEL_SOURCE_UPLOADED else None,
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
        f"Channels={','.join(order)}, Window={EARTH_WINDOW}, Horizon={EARTH_HORIZON}",
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
        batch_count = 0
        total_batches = len(prepared["train_loader"])
        for batch_index, (inputs, targets) in enumerate(prepared["train_loader"], start=1):
            inputs = inputs.to(resolved_device)
            targets = targets.to(resolved_device)
            optimizer.zero_grad(set_to_none=True)
            output = earth_forward_for_model(model, inputs, model_source=model_source)
            if not torch.isfinite(output).all():
                raise EarthTrainingError("Non-finite model output during training")
            loss = loss_function(output, targets)
            if not torch.isfinite(loss):
                raise EarthTrainingError("Non-finite training loss")
            loss.backward()
            for name, parameter in model.named_parameters():
                if parameter.grad is not None and not torch.isfinite(parameter.grad).all():
                    raise EarthTrainingError(f"Non-finite gradient for {name}")
            optimizer.step()
            running_loss += float(loss.item())
            batch_count += 1
            if batch_index % PROGRESS_EVERY_BATCHES == 0 or batch_index == total_batches:
                print(
                    f"Epoch {epoch}/{epochs} Batch {batch_index}/{total_batches} "
                    f"Loss={loss.item():.6f}",
                    flush=True,
                )

        training_loss = running_loss / max(batch_count, 1)
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
            f"Earth test lead day {row['lead_day']}: RMSE={row['rmse']:.6f} "
            f"MAE={row['mae']:.6f}",
            flush=True,
        )

    metrics = build_metrics_block(
        validation=validation_metrics,
        test=test_metrics,
        validation_window_count=prepared["counts"]["validation"],
        test_window_count=prepared["counts"]["test"],
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
        before = earth_forward_for_model(model, sample_inputs, model_source=model_source)
        after = earth_forward_for_model(reloaded, sample_inputs, model_source=model_source)
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


def _build_registry() -> DatasetRegistry:
    from config import EARTH_MERRA2_DIR, EARTH_MERRA2_V1_DIR

    return DatasetRegistry(
        EARTH_MERRA2_DIR,
        earth_dataset_id="earth_merra2_daily_v2",
        legacy_earth_package_dir=EARTH_MERRA2_V1_DIR,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Earth MERRA-2 DLinear training")
    parser.add_argument("--output_path", type=str, required=True)
    args = parser.parse_args()
    try:
        spec = _load_spec_from_env()
        run_training(spec, Path(args.output_path), _build_registry())
    except (EarthTrainingError, EarthArtifactError, DatasetRequestError, ValueError) as exc:
        print(f"Earth training failed: {exc}", flush=True)
        return 1
    except Exception as exc:  # pragma: no cover - unexpected, surfaced verbatim
        print(f"Earth training failed unexpectedly: {type(exc).__name__}: {exc}", flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
