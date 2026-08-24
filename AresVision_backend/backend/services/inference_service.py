from __future__ import annotations

import asyncio
import json
import threading
import torch
import numpy as np
import glob
import re
import netCDF4 as nc
from pathlib import Path

from config import MCD_DIR, MCD_RAW_3H_DIR
from database.models import ModelTrainingTask
from database.engine import async_session_maker
from core.metrics import compute_error_distribution, compute_metrics, compute_test_set_metrics
from core.predict_model import PredRNNv2 as LegacyPredRNNv2
from services.training_channels import (
    extract_architecture_params,
    get_channels_from_hyperparameters,
    get_task_channel_suffix,
)
from services.prediction_horizon import validate_prediction_horizon
from services.model_artifacts import is_valid_model_weight_file
from services.prediction_analysis_cache import PredictionAnalysisCacheService
from training_backbones.model_zoo import (
    build_forecaster,
    normalize_model_architecture,
    normalize_use_sphere,
)
from training_backbones.uploaded_model_contract import run_uploaded_model

_NETCDF_READ_LOCK = threading.RLock()


class InferenceService:
    def __init__(self, analysis_cache=None):
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.base_dir = Path(__file__).parent.parent
        self.openmars_dir = self.base_dir / "data" / "openmars"
        self.mcd_dir = Path(MCD_DIR)
        self.analysis_cache = analysis_cache or PredictionAnalysisCacheService()

    def _load_task_state_dict(self, task):
        model_path = getattr(task, "output_model_path", None)
        if not is_valid_model_weight_file(model_path):
            raise ValueError("Model file not found")
        try:
            return torch.load(model_path, map_location=self.device, weights_only=True)
        except (FileNotFoundError, IsADirectoryError, NotADirectoryError) as exc:
            raise ValueError("Model file not found") from exc

    async def predict_task(
        self,
        task_id: int,
        mars_year: int,
        ls_start: float,
        horizon: int = 3,
        current_user=None,
        data_service=None,
        personal_source_service=None,
    ) -> dict:
        task, hypers, data_dirs, temp_data_root = await self._prepare_task_prediction_context(
            task_id=task_id,
            current_user=current_user,
            data_service=data_service,
            personal_source_service=personal_source_service,
        )
        try:
            validate_prediction_horizon(hypers, horizon)
            return await self._cached_prediction(
                task=task,
                hypers=hypers,
                data_dirs=data_dirs,
                user_id=current_user.id,
                mars_year=mars_year,
                ls_start=ls_start,
                horizon=horizon,
            )
        finally:
            self._cleanup_temp_data_root(temp_data_root)

    async def task_metrics(
        self,
        task_id: int,
        mars_year: int,
        ls_start: float,
        horizon: int = 3,
        current_user=None,
        data_service=None,
        personal_source_service=None,
    ) -> dict:
        result = await self.predict_task(
            task_id=task_id,
            mars_year=mars_year,
            ls_start=ls_start,
            horizon=horizon,
            current_user=current_user,
            data_service=data_service,
            personal_source_service=personal_source_service,
        )
        return result["metrics"]

    async def task_test_set_metrics(
        self,
        task_id: int,
        mars_year: int,
        ls_start: float,
        horizon: int = 3,
        current_user=None,
        data_service=None,
        personal_source_service=None,
    ) -> dict:
        task, hypers, data_dirs, temp_data_root = await self._prepare_task_prediction_context(
            task_id=task_id,
            current_user=current_user,
            data_service=data_service,
            personal_source_service=personal_source_service,
        )
        try:
            validate_prediction_horizon(hypers, horizon)
            return await self._cached_test_set_metrics(
                task,
                hypers,
                data_dirs,
                current_user.id,
                horizon,
            )
        finally:
            self._cleanup_temp_data_root(temp_data_root)

    async def compare_task_test_set_metrics(
        self,
        task_ids: list[int],
        horizon: int = 3,
        current_user=None,
        data_service=None,
        personal_source_service=None,
    ) -> dict:
        unique_task_ids = self._normalize_compare_task_ids(task_ids)
        items = []
        for task_id in unique_task_ids:
            task, hypers, data_dirs, temp_data_root = await self._prepare_task_prediction_context(
                task_id=task_id,
                current_user=current_user,
                data_service=data_service,
                personal_source_service=personal_source_service,
            )
            try:
                validate_prediction_horizon(hypers, horizon)
                metrics = await self._cached_test_set_metrics(
                    task,
                    hypers,
                    data_dirs,
                    current_user.id,
                    horizon,
                )
                items.append({
                    **self._task_compare_metadata(task, hypers),
                    "metrics": metrics,
                })
            finally:
                self._cleanup_temp_data_root(temp_data_root)
        return {"items": items}

    async def task_error_distribution(
        self,
        task_id: int,
        selected_variables: list[str] | None = None,
        horizon: int = 3,
        current_user=None,
        data_service=None,
        personal_source_service=None,
    ) -> dict:
        task, hypers, data_dirs, temp_data_root = await self._prepare_task_prediction_context(
            task_id=task_id,
            current_user=current_user,
            data_service=data_service,
            personal_source_service=personal_source_service,
        )
        try:
            validate_prediction_horizon(hypers, horizon)
            return await self._cached_error_distribution(
                task,
                hypers,
                data_dirs,
                current_user.id,
                horizon,
            )
        finally:
            self._cleanup_temp_data_root(temp_data_root)

    async def compare_task_error_distributions(
        self,
        task_ids: list[int],
        horizon: int = 3,
        current_user=None,
        data_service=None,
        personal_source_service=None,
    ) -> dict:
        unique_task_ids = self._normalize_compare_task_ids(task_ids)
        items = []
        for task_id in unique_task_ids:
            task, hypers, data_dirs, temp_data_root = await self._prepare_task_prediction_context(
                task_id=task_id,
                current_user=current_user,
                data_service=data_service,
                personal_source_service=personal_source_service,
            )
            try:
                validate_prediction_horizon(hypers, horizon)
                distribution = await self._cached_error_distribution(
                    task,
                    hypers,
                    data_dirs,
                    current_user.id,
                    horizon,
                )
                items.append({
                    "task_id": int(task.id),
                    "model_name": self._task_model_name(task),
                    "distribution": distribution,
                })
            finally:
                self._cleanup_temp_data_root(temp_data_root)
        return {"items": items}

    async def task_permutation_importance(
        self,
        task_id: int,
        selected_variables: list[str],
        mars_year: int,
        ls_start: float,
        horizon: int = 3,
        current_user=None,
        data_service=None,
        personal_source_service=None,
    ) -> dict:
        task, hypers, data_dirs, temp_data_root = await self._prepare_task_prediction_context(
            task_id=task_id,
            current_user=current_user,
            data_service=data_service,
            personal_source_service=personal_source_service,
        )
        try:
            validate_prediction_horizon(hypers, horizon)
            return await self._cached_permutation_importance(
                task,
                hypers,
                data_dirs,
                current_user.id,
                horizon,
                selected_variables,
            )
        finally:
            self._cleanup_temp_data_root(temp_data_root)

    async def compare_task_permutation_importance(
        self,
        task_ids: list[int],
        horizon: int = 3,
        current_user=None,
        data_service=None,
        personal_source_service=None,
    ) -> dict:
        unique_task_ids = self._normalize_compare_task_ids(task_ids)
        items = []
        for task_id in unique_task_ids:
            task, hypers, data_dirs, temp_data_root = await self._prepare_task_prediction_context(
                task_id=task_id,
                current_user=current_user,
                data_service=data_service,
                personal_source_service=personal_source_service,
            )
            try:
                validate_prediction_horizon(hypers, horizon)
                selected_variables = self._channels_to_variable_names(self._task_selected_channels(task, hypers))
                pfi = await self._cached_permutation_importance(
                    task,
                    hypers,
                    data_dirs,
                    current_user.id,
                    horizon,
                    selected_variables,
                )
                items.append({
                    "task_id": int(task.id),
                    "model_name": self._task_model_name(task),
                    **pfi,
                })
            finally:
                self._cleanup_temp_data_root(temp_data_root)
        return {"items": items}

    async def _prepare_task_prediction_context(
        self,
        task_id: int,
        current_user=None,
        data_service=None,
        personal_source_service=None,
    ):
        if getattr(current_user, "id", None) is None:
            raise PermissionError(
                "Authentication is required for trained-model analysis"
            )

        async with async_session_maker() as session:
            task = await session.get(ModelTrainingTask, task_id)
            if not task:
                raise ValueError("Training task not found")

            role = str(getattr(current_user, "role", "") or "").lower()
            user_id = getattr(current_user, "id", None)
            if role != "admin" and task.user_id is not None and task.user_id != user_id:
                raise PermissionError("No permission to access this training task")

            if task.status != "completed":
                raise ValueError("Training task is not completed")
            if not is_valid_model_weight_file(task.output_model_path):
                raise ValueError("Model file not found")

            try:
                hypers = json.loads(task.hyperparameters or "{}")
            except Exception:
                hypers = {}

            data_dirs, temp_data_root = await self._prepare_task_data_env(
                task=task,
                hypers=hypers,
                data_service=data_service,
                personal_source_service=personal_source_service,
            )
            return task, hypers, data_dirs, temp_data_root

    async def _cached_prediction(
        self,
        task,
        hypers,
        data_dirs,
        user_id,
        mars_year,
        ls_start,
        horizon,
    ):
        async def compute():
            return await asyncio.to_thread(self._predict_task_with_context,
                task=task,
                hypers=hypers,
                mars_year=mars_year,
                ls_start=ls_start,
                horizon=horizon,
                data_dirs=data_dirs,
            )

        return await self.analysis_cache.get_or_compute(
            user_id=user_id,
            task=task,
            analysis_type="prediction",
            request_params={
                "mars_year": mars_year,
                "ls_start": ls_start,
                "horizon": horizon,
            },
            data_dirs=data_dirs,
            compute=compute,
        )

    async def _cached_test_set_metrics(
        self, task, hypers, data_dirs, user_id, horizon
    ):
        async def compute():
            if getattr(task, "model_source", "official") == "uploaded":
                return await asyncio.to_thread(self._uploaded_task_test_set_metrics,
                    task,
                    hypers,
                    horizon,
                    data_dirs,
                )
            return await asyncio.to_thread(self._official_task_test_set_metrics,
                task,
                hypers,
                horizon,
                data_dirs,
            )

        return await self.analysis_cache.get_or_compute(
            user_id=user_id,
            task=task,
            analysis_type="metrics",
            request_params={"horizon": horizon},
            data_dirs=data_dirs,
            compute=compute,
        )

    async def _cached_error_distribution(
        self, task, hypers, data_dirs, user_id, horizon
    ):
        async def compute():
            if getattr(task, "model_source", "official") == "uploaded":
                truth_raw, pred_raw, actual_horizon = await asyncio.to_thread(self._uploaded_task_test_set_arrays,
                    task,
                    hypers,
                    horizon,
                    data_dirs,
                )
            else:
                truth_raw, pred_raw, actual_horizon = await asyncio.to_thread(self._official_task_test_set_arrays,
                    task,
                    hypers,
                    horizon,
                    data_dirs,
                )
            return await asyncio.to_thread(
                compute_error_distribution,
                truth_raw[:, :actual_horizon],
                pred_raw[:, :actual_horizon],
            )

        return await self.analysis_cache.get_or_compute(
            user_id=user_id,
            task=task,
            analysis_type="error_distribution",
            request_params={"horizon": horizon},
            data_dirs=data_dirs,
            compute=compute,
        )

    async def _cached_permutation_importance(
        self,
        task,
        hypers,
        data_dirs,
        user_id,
        horizon,
        selected_variables,
    ):
        async def compute():
            return await asyncio.to_thread(self._task_permutation_importance_with_context,
                task=task,
                hypers=hypers,
                selected_variables=selected_variables,
                horizon=horizon,
                data_dirs=data_dirs,
            )

        return await self.analysis_cache.get_or_compute(
            user_id=user_id,
            task=task,
            analysis_type="pfi",
            request_params={
                "horizon": horizon,
                "selected_variables": selected_variables,
            },
            data_dirs=data_dirs,
            compute=compute,
        )

    async def _prepare_task_data_env(
        self,
        task,
        hypers: dict,
        data_service=None,
        personal_source_service=None,
    ):
        return {}, None

    @staticmethod
    def _cleanup_temp_data_root(temp_data_root: Path | None) -> None:
        if temp_data_root is None:
            return
        from services.training_service import TrainingService

        TrainingService().cleanup_temp_data_root(temp_data_root)

    @staticmethod
    def _normalize_compare_task_ids(task_ids: list[int]) -> list[int]:
        unique = []
        seen = set()
        for raw_id in task_ids or []:
            try:
                task_id = int(raw_id)
            except (TypeError, ValueError):
                continue
            if task_id <= 0 or task_id in seen:
                continue
            seen.add(task_id)
            unique.append(task_id)
        if len(unique) < 2:
            raise ValueError("At least two training tasks are required for comparison")
        return unique

    @staticmethod
    def _task_model_name(task) -> str:
        return getattr(task, "custom_model_name", None) or f"Task #{getattr(task, 'id', '')}"

    def _task_selected_channels(self, task, hypers: dict) -> list[str]:
        channels = get_channels_from_hyperparameters(hypers)
        if channels:
            return channels
        return [channel for channel in get_task_channel_suffix(task) if channel]

    def _task_compare_metadata(self, task, hypers: dict) -> dict:
        model_source = str(getattr(task, "model_source", None) or hypers.get("model_source") or "official").lower()
        selected_channels = self._task_selected_channels(task, hypers)
        architecture = "uploaded" if model_source == "uploaded" else normalize_model_architecture(
            hypers.get("model_architecture", "predrnnv2")
        )
        data_source = str(hypers.get("_effective_data_source") or hypers.get("_data_source") or "default").lower()
        safe_keys = (
            "window",
            "horizon",
            "epochs",
            "batch_size",
            "learning_rate",
            "early_stopping_patience",
            "seed",
            "use_sphere",
            "model_architecture",
        )
        safe_hypers = {key: hypers[key] for key in safe_keys if key in hypers}
        safe_hypers.update({
            "model_source": model_source,
            "selected_channels": selected_channels,
            "_data_source": data_source,
        })
        return {
            "task_id": int(task.id),
            "model_name": self._task_model_name(task),
            "model_source": model_source,
            "architecture": architecture,
            "selected_channels": selected_channels,
            "hyperparameters": safe_hypers,
        }

    def _predict_task_with_context(
        self,
        task,
        hypers: dict,
        mars_year: int,
        ls_start: float,
        horizon: int,
        data_dirs: dict[str, str] | None = None,
    ) -> dict:
        if getattr(task, "model_source", "official") == "uploaded":
            pred_scaled, truth_scaled, y_mean, y_std, selected_channels = self._predict_uploaded_task_window(
                task=task,
                hypers=hypers,
                ls_start=ls_start,
                horizon=horizon,
                data_dirs=data_dirs,
            )
            model_info = {
                "model_source": "trained_task",
                "training_task_id": task.id,
                "training_model_source": "uploaded",
                "model_name": task.custom_model_name,
                "selected_channels": selected_channels,
                "weight_file": Path(task.output_model_path).name,
            }
        else:
            pred_scaled, truth_scaled, y_mean, y_std, selected_channels = self._predict_official_task_window(
                task=task,
                hypers=hypers,
                ls_start=ls_start,
                horizon=horizon,
                data_dirs=data_dirs,
            )
            model_info = {
                "model_source": "trained_task",
                "training_task_id": task.id,
                "training_model_source": "official",
                "model_name": task.custom_model_name,
                "architecture": normalize_model_architecture(hypers.get("model_architecture", "predrnnv2")),
                "selected_channels": selected_channels,
                "weight_file": Path(task.output_model_path).name,
            }

        actual_horizon = min(int(horizon), int(pred_scaled.shape[0]), int(truth_scaled.shape[0]))
        pred_raw = pred_scaled[:actual_horizon] * (y_std + 1e-6) + y_mean
        truth_raw = truth_scaled[:actual_horizon] * (y_std + 1e-6) + y_mean
        residual_raw = pred_raw - truth_raw
        metrics = compute_metrics(truth_raw, pred_raw)

        lat_arr = np.linspace(-87.5, 87.5, pred_raw.shape[-2], dtype=np.float32)
        lon_arr = np.linspace(-180.0, 175.0, pred_raw.shape[-1], dtype=np.float32)
        ls_values = [float((ls_start + (idx + 1) * 5.0) % 360.0) for idx in range(actual_horizon)]
        selected_variables = self._channels_to_variable_names(selected_channels)
        model_info["requested_mars_year"] = int(mars_year)
        model_info["requested_ls_start"] = float(ls_start)

        return {
            "ground_truth": self._fields_to_dicts(truth_raw, lat_arr, lon_arr, include_points=False),
            "prediction": self._fields_to_dicts(pred_raw, lat_arr, lon_arr, include_points=False),
            "residual": self._fields_to_dicts(residual_raw, lat_arr, lon_arr, include_points=False),
            "selected_variables": selected_variables,
            "horizon": actual_horizon,
            "ls_values": ls_values,
            "model_info": model_info,
            "metrics": metrics,
            "source_meta": {
                "requested_source": "training_task",
                "effective_source": "training_task",
                "fallback": False,
                "message": None,
                "mars_year": int(mars_year),
            },
        }

    def _predict_official_task_window(self, task, hypers: dict, ls_start: float, horizon: int, data_dirs=None):
        window = int(hypers.get("window", 3))
        task_horizon = int(hypers.get("horizon", horizon or 3))
        hidden_dims = hypers.get("stlstm_hidden_dims", [64, 64, 64])
        model_architecture = normalize_model_architecture(hypers.get("model_architecture", "predrnnv2"))
        use_sphere = normalize_use_sphere(hypers)
        architecture_params = extract_architecture_params(hypers)
        active_vars = get_task_channel_suffix(task)
        mcd_vars_map = {
            'U': ('U_Wind', 'u'),
            'V': ('V_Wind', 'v'),
            'D': ('Dust_Optical_Depth', 'dustq'),
            'S': ('Solar_Flux_DN', 'fluxsurf_dn_sw'),
            'T': ('Temperature', 'temp')
        }
        used_mcd_vars = [mcd_vars_map[channel] for channel in active_vars if channel in mcd_vars_map]
        x_torch, y_torch, ls_torch, y_mean, y_std = self._prepare_data(
            used_mcd_vars,
            window,
            task_horizon,
            data_dirs=data_dirs,
        )
        sample_idx = self._nearest_sequence_index(ls_torch, ls_start)
        x_sample = x_torch[sample_idx: sample_idx + 1].to(self.device)
        ls_sample = ls_torch[sample_idx: sample_idx + 1].to(self.device)

        model, uses_legacy_loader = self._load_official_task_model(
            task=task,
            model_architecture=model_architecture,
            input_channels=1 + len(used_mcd_vars),
            selected_channels=list(active_vars),
            hidden_dims=hidden_dims,
            height=int(x_torch.shape[-2]),
            width=int(x_torch.shape[-1]),
            window=window,
            horizon=task_horizon,
            use_sphere=use_sphere,
            architecture_params=architecture_params,
        )

        with torch.no_grad():
            pred = self._run_official_task_model(
                model,
                x_sample,
                ls_sample,
                uses_legacy_loader,
            )[0, :, 0].cpu().numpy()
        truth = y_torch[sample_idx, :, 0].cpu().numpy()
        return pred, truth, y_mean, y_std, list(active_vars)

    def _prepare_uploaded_task_tensors(
        self,
        hypers: dict,
        window: int,
        horizon: int,
        data_dirs=None,
    ):
        from training_backbones.user_model_runner import (
            parse_selected_channels,
            prepare_tensors,
        )

        directories = data_dirs or {}
        selected_channels = parse_selected_channels(hypers.get("selected_channels", []))
        openmars_dir = Path(directories.get("ARESVISION_OPENMARS_DIR") or self.openmars_dir)
        mcd_dir = Path(directories.get("ARESVISION_MCD_DIR") or self.mcd_dir)
        mcd_overview_dir = Path(
            directories.get("MCD_RAW_3H_DIR")
            or directories.get("ARESVISION_MCD_RAW_3H_DIR")
            or MCD_RAW_3H_DIR
        )
        tensors = prepare_tensors(
            openmars_dir,
            mcd_dir,
            selected_channels,
            window,
            horizon,
            training_dataset=hypers.get("training_dataset", "openmars_mcd"),
            mcd_overview_dir=mcd_overview_dir,
            return_ls=True,
        )
        return selected_channels, tensors

    def _predict_uploaded_task_window(self, task, hypers: dict, ls_start: float, horizon: int, data_dirs=None):
        from training_backbones.user_model_runner import (
            assert_prediction_shape,
            build_uploaded_model_config,
            load_uploaded_model,
        )

        window = int(hypers.get("window", 3))
        task_horizon = int(hypers.get("horizon", horizon or 3))
        selected_channels, tensors = self._prepare_uploaded_task_tensors(
            hypers,
            window,
            task_horizon,
            data_dirs,
        )
        x_torch, y_torch, ls_torch, y_mean, y_std, height, width = tensors
        sample_idx = min(max(0, int(round(float(ls_start) / 360.0 * max(1, len(x_torch) - 1)))), len(x_torch) - 1)
        config = build_uploaded_model_config(
            in_channels=int(x_torch.shape[2]),
            window=window,
            horizon=task_horizon,
            height=height,
            width=width,
            selected_channels=selected_channels,
            custom_model_params=hypers.get("custom_model_params", {}),
            param_schema=hypers.get("_uploaded_model_param_schema", {}),
        )
        model_path = hypers.get("_uploaded_model_path")
        if not model_path:
            raise ValueError("Uploaded model path is missing from task hyperparameters")
        model = load_uploaded_model(Path(model_path), config).to(self.device)
        state_dict = self._load_task_state_dict(task)
        model.load_state_dict(state_dict)
        model.eval()

        x_sample = x_torch[sample_idx: sample_idx + 1].to(self.device)
        ls_sample = ls_torch[sample_idx: sample_idx + 1].to(self.device) if ls_torch is not None else None
        truth_tensor = y_torch[sample_idx: sample_idx + 1]
        with torch.no_grad():
            pred_tensor = run_uploaded_model(
                model,
                x_sample,
                ls_sample,
                context="uploaded prediction",
            )
            assert_prediction_shape(pred_tensor, truth_tensor.to(self.device), "uploaded prediction")
        pred = pred_tensor[0, :, 0].cpu().numpy()
        truth = truth_tensor[0, :, 0].cpu().numpy()
        return pred, truth, y_mean, y_std, selected_channels

    def _official_task_test_set_metrics(self, task, hypers: dict, horizon: int, data_dirs=None):
        truth_raw, pred_raw, actual_horizon = self._official_task_test_set_arrays(
            task,
            hypers,
            horizon,
            data_dirs=data_dirs,
        )
        return compute_test_set_metrics(truth_raw, pred_raw, horizon=actual_horizon)

    def _official_task_test_set_arrays(self, task, hypers: dict, horizon: int, data_dirs=None):
        window = int(hypers.get("window", 3))
        task_horizon = int(hypers.get("horizon", horizon or 3))
        hidden_dims = hypers.get("stlstm_hidden_dims", [64, 64, 64])
        model_architecture = normalize_model_architecture(hypers.get("model_architecture", "predrnnv2"))
        use_sphere = normalize_use_sphere(hypers)
        architecture_params = extract_architecture_params(hypers)
        active_vars = get_task_channel_suffix(task)
        mcd_vars_map = {
            'U': ('U_Wind', 'u'),
            'V': ('V_Wind', 'v'),
            'D': ('Dust_Optical_Depth', 'dustq'),
            'S': ('Solar_Flux_DN', 'fluxsurf_dn_sw'),
            'T': ('Temperature', 'temp')
        }
        used_mcd_vars = [mcd_vars_map[channel] for channel in active_vars if channel in mcd_vars_map]
        x_torch, y_torch, ls_torch, y_mean, y_std = self._prepare_data(
            used_mcd_vars,
            window,
            task_horizon,
            data_dirs=data_dirs,
        )

        model, uses_legacy_loader = self._load_official_task_model(
            task=task,
            model_architecture=model_architecture,
            input_channels=1 + len(used_mcd_vars),
            selected_channels=list(active_vars),
            hidden_dims=hidden_dims,
            height=int(x_torch.shape[-2]),
            width=int(x_torch.shape[-1]),
            window=window,
            horizon=task_horizon,
            use_sphere=use_sphere,
            architecture_params=architecture_params,
        )

        split = int(0.8 * len(x_torch))
        x_test = x_torch[split:]
        y_test = y_torch[split:]
        ls_test = ls_torch[split:]
        if len(x_test) == 0:
            raise ValueError("No trained model test samples are available")

        pred_batches = []
        truth_batches = []
        batch_size = max(1, min(16, int(hypers.get("batch_size", 16) or 16)))
        actual_horizon = min(int(horizon), int(task_horizon))
        with torch.no_grad():
            for start in range(0, len(x_test), batch_size):
                end = min(start + batch_size, len(x_test))
                pred = self._run_official_task_model(
                    model,
                    x_test[start:end].to(self.device),
                    ls_test[start:end].to(self.device),
                    uses_legacy_loader,
                ).cpu().numpy()
                pred_batches.append(pred[:, :actual_horizon, 0] * (y_std + 1e-6) + y_mean)
                truth_batches.append(
                    y_test[start:end, :actual_horizon, 0].cpu().numpy() * (y_std + 1e-6) + y_mean
                )

        return (
            np.concatenate(truth_batches, axis=0),
            np.concatenate(pred_batches, axis=0),
            actual_horizon,
        )

    def _uploaded_task_test_set_metrics(self, task, hypers: dict, horizon: int, data_dirs=None):
        truth_raw, pred_raw, actual_horizon = self._uploaded_task_test_set_arrays(
            task,
            hypers,
            horizon,
            data_dirs=data_dirs,
        )
        return compute_test_set_metrics(truth_raw, pred_raw, horizon=actual_horizon)

    def _uploaded_task_test_set_arrays(self, task, hypers: dict, horizon: int, data_dirs=None):
        from training_backbones.user_model_runner import (
            assert_prediction_shape,
            build_uploaded_model_config,
            load_uploaded_model,
        )

        window = int(hypers.get("window", 3))
        task_horizon = int(hypers.get("horizon", horizon or 3))
        selected_channels, tensors = self._prepare_uploaded_task_tensors(
            hypers,
            window,
            task_horizon,
            data_dirs,
        )
        x_torch, y_torch, ls_torch, y_mean, y_std, height, width = tensors
        config = build_uploaded_model_config(
            in_channels=int(x_torch.shape[2]),
            window=window,
            horizon=task_horizon,
            height=height,
            width=width,
            selected_channels=selected_channels,
            custom_model_params=hypers.get("custom_model_params", {}),
            param_schema=hypers.get("_uploaded_model_param_schema", {}),
        )
        model_path = hypers.get("_uploaded_model_path")
        if not model_path:
            raise ValueError("Uploaded model path is missing from task hyperparameters")
        model = load_uploaded_model(Path(model_path), config).to(self.device)
        state_dict = self._load_task_state_dict(task)
        model.load_state_dict(state_dict)
        model.eval()

        split = int(0.8 * len(x_torch))
        x_test = x_torch[split:]
        y_test = y_torch[split:]
        ls_test = ls_torch[split:] if ls_torch is not None else None
        if len(x_test) == 0:
            raise ValueError("No uploaded model test samples are available")

        pred_batches = []
        truth_batches = []
        batch_size = max(1, min(16, int(hypers.get("batch_size", 16) or 16)))
        actual_horizon = min(int(horizon), int(task_horizon))
        with torch.no_grad():
            for start in range(0, len(x_test), batch_size):
                end = min(start + batch_size, len(x_test))
                truth_tensor = y_test[start:end].to(self.device)
                ls_batch = ls_test[start:end].to(self.device) if ls_test is not None else None
                pred = run_uploaded_model(
                    model,
                    x_test[start:end].to(self.device),
                    ls_batch,
                    context="uploaded test-set metrics",
                )
                assert_prediction_shape(pred, truth_tensor, "uploaded test-set metrics")
                pred_np = pred.cpu().numpy()
                pred_batches.append(pred_np[:, :actual_horizon, 0] * (y_std + 1e-6) + y_mean)
                truth_batches.append(
                    truth_tensor[:, :actual_horizon, 0].cpu().numpy() * (y_std + 1e-6) + y_mean
                )

        return (
            np.concatenate(truth_batches, axis=0),
            np.concatenate(pred_batches, axis=0),
            actual_horizon,
        )

    def _task_permutation_importance_with_context(
        self,
        task,
        hypers: dict,
        selected_variables: list[str],
        horizon: int,
        data_dirs=None,
    ) -> dict:
        if getattr(task, "model_source", "official") == "uploaded":
            return self._uploaded_task_permutation_importance(
                task=task,
                hypers=hypers,
                selected_variables=selected_variables,
                horizon=horizon,
                data_dirs=data_dirs,
            )
        return self._official_task_permutation_importance(
            task=task,
            hypers=hypers,
            selected_variables=selected_variables,
            horizon=horizon,
            data_dirs=data_dirs,
        )

    def _official_task_permutation_importance(self, task, hypers: dict, selected_variables: list[str], horizon: int, data_dirs=None):
        from sklearn.metrics import r2_score

        window = int(hypers.get("window", 3))
        task_horizon = int(hypers.get("horizon", horizon or 3))
        hidden_dims = hypers.get("stlstm_hidden_dims", [64, 64, 64])
        model_architecture = normalize_model_architecture(hypers.get("model_architecture", "predrnnv2"))
        use_sphere = normalize_use_sphere(hypers)
        architecture_params = extract_architecture_params(hypers)
        active_channels = list(get_task_channel_suffix(task))
        mcd_vars_map = {
            'U': ('U_Wind', 'u'),
            'V': ('V_Wind', 'v'),
            'D': ('Dust_Optical_Depth', 'dustq'),
            'S': ('Solar_Flux_DN', 'fluxsurf_dn_sw'),
            'T': ('Temperature', 'temp')
        }
        used_mcd_vars = [mcd_vars_map[channel] for channel in active_channels if channel in mcd_vars_map]
        x_torch, y_torch, ls_torch, y_mean, y_std = self._prepare_data(
            used_mcd_vars,
            window,
            task_horizon,
            data_dirs=data_dirs,
        )
        model, uses_legacy_loader = self._load_official_task_model(
            task=task,
            model_architecture=model_architecture,
            input_channels=1 + len(used_mcd_vars),
            selected_channels=active_channels,
            hidden_dims=hidden_dims,
            height=int(x_torch.shape[-2]),
            width=int(x_torch.shape[-1]),
            window=window,
            horizon=task_horizon,
            use_sphere=use_sphere,
            architecture_params=architecture_params,
        )

        split = int(0.8 * len(x_torch))
        x_test = x_torch[split:].clone()
        y_test = y_torch[split:]
        ls_test = ls_torch[split:]
        if len(x_test) == 0:
            return {"items": [], "baseline_metric": "r2", "baseline_value": 0.0}

        sample_size = min(40, len(x_test))
        sample_indices = np.linspace(0, len(x_test) - 1, sample_size, dtype=int)
        x_sample = x_test[sample_indices]
        y_sample = y_test[sample_indices]
        ls_sample = ls_test[sample_indices]

        def score(batch):
            with torch.no_grad():
                pred = self._run_official_task_model(
                    model,
                    batch.to(self.device),
                    ls_sample.to(self.device),
                    uses_legacy_loader,
                ).cpu().numpy()
            truth = y_sample.numpy()
            pred_raw = pred[:, :horizon, 0] * (y_std + 1e-6) + y_mean
            truth_raw = truth[:, :horizon, 0] * (y_std + 1e-6) + y_mean
            valid = np.isfinite(truth_raw) & np.isfinite(pred_raw)
            if np.count_nonzero(valid) < 10:
                return 0.0
            return float(r2_score(truth_raw[valid], pred_raw[valid]))

        baseline = score(x_sample)
        name_by_channel = {
            "U": "U_Wind",
            "V": "V_Wind",
            "D": "Dust_Optical_Depth",
            "S": "Solar_Flux_DN",
            "T": "Temperature",
        }
        selected_set = set(selected_variables or self._channels_to_variable_names(active_channels))
        selected_set.add("Ozone")
        items = []
        feature_pairs = [(0, "Ozone")] + [
            (index, name_by_channel[channel])
            for index, channel in enumerate(active_channels, start=1)
            if channel in name_by_channel
        ]
        for channel_index, name in feature_pairs:
            if name not in selected_set:
                continue
            shuffled = x_sample.clone()
            order = torch.randperm(shuffled.shape[0])
            shuffled[:, :, channel_index] = shuffled[order, :, channel_index]
            items.append({
                "name": name,
                "importance": round(float(baseline - score(shuffled)), 6),
            })

        items.sort(key=lambda item: item["importance"], reverse=True)
        return {"items": items, "baseline_metric": "r2", "baseline_value": round(float(baseline), 4)}

    def _uploaded_task_permutation_importance(self, task, hypers: dict, selected_variables: list[str], horizon: int, data_dirs=None):
        from sklearn.metrics import r2_score
        from training_backbones.user_model_runner import (
            assert_prediction_shape,
            build_uploaded_model_config,
            load_uploaded_model,
        )

        window = int(hypers.get("window", 3))
        task_horizon = int(hypers.get("horizon", horizon or 3))
        selected_channels, tensors = self._prepare_uploaded_task_tensors(
            hypers,
            window,
            task_horizon,
            data_dirs,
        )
        x_torch, y_torch, ls_torch, y_mean, y_std, height, width = tensors
        config = build_uploaded_model_config(
            in_channels=int(x_torch.shape[2]),
            window=window,
            horizon=task_horizon,
            height=height,
            width=width,
            selected_channels=selected_channels,
            custom_model_params=hypers.get("custom_model_params", {}),
            param_schema=hypers.get("_uploaded_model_param_schema", {}),
        )
        model_path = hypers.get("_uploaded_model_path")
        if not model_path:
            raise ValueError("Uploaded model path is missing from task hyperparameters")
        model = load_uploaded_model(Path(model_path), config).to(self.device)
        state_dict = self._load_task_state_dict(task)
        model.load_state_dict(state_dict)
        model.eval()

        split = int(0.8 * len(x_torch))
        x_test = x_torch[split:].clone()
        y_test = y_torch[split:]
        ls_test = ls_torch[split:] if ls_torch is not None else None
        if len(x_test) == 0:
            return {"items": [], "baseline_metric": "r2", "baseline_value": 0.0}
        sample_size = min(40, len(x_test))
        sample_indices = np.linspace(0, len(x_test) - 1, sample_size, dtype=int)
        x_sample = x_test[sample_indices]
        y_sample = y_test[sample_indices]
        ls_sample = ls_test[sample_indices] if ls_test is not None else None

        def score(batch):
            with torch.no_grad():
                pred = run_uploaded_model(
                    model,
                    batch.to(self.device),
                    ls_sample.to(self.device) if ls_sample is not None else None,
                    context="uploaded permutation importance",
                )
                assert_prediction_shape(pred, y_sample.to(self.device), "uploaded permutation importance")
                pred_np = pred.cpu().numpy()
            truth = y_sample.numpy()
            pred_raw = pred_np[:, :horizon, 0] * (y_std + 1e-6) + y_mean
            truth_raw = truth[:, :horizon, 0] * (y_std + 1e-6) + y_mean
            valid = np.isfinite(truth_raw) & np.isfinite(pred_raw)
            if np.count_nonzero(valid) < 10:
                return 0.0
            return float(r2_score(truth_raw[valid], pred_raw[valid]))

        baseline = score(x_sample)
        name_by_channel = {
            "U": "U_Wind",
            "V": "V_Wind",
            "D": "Dust_Optical_Depth",
            "S": "Solar_Flux_DN",
            "T": "Temperature",
        }
        selected_set = set(selected_variables or self._channels_to_variable_names(selected_channels))
        selected_set.add("Ozone")
        items = []
        feature_pairs = [(0, "Ozone")] + [
            (index, name_by_channel[channel])
            for index, channel in enumerate(selected_channels, start=1)
            if channel in name_by_channel
        ]
        for channel_index, name in feature_pairs:
            if name not in selected_set:
                continue
            shuffled = x_sample.clone()
            order = torch.randperm(shuffled.shape[0])
            shuffled[:, :, channel_index] = shuffled[order, :, channel_index]
            items.append({
                "name": name,
                "importance": round(float(baseline - score(shuffled)), 6),
            })
        items.sort(key=lambda item: item["importance"], reverse=True)
        return {"items": items, "baseline_metric": "r2", "baseline_value": round(float(baseline), 4)}

    @staticmethod
    def _nearest_sequence_index(ls_torch: torch.Tensor, ls_start: float) -> int:
        values = ls_torch[:, 0].detach().cpu().numpy().reshape(-1)
        if len(values) == 0:
            return 0
        diffs = np.abs(((values - float(ls_start) + 180.0) % 360.0) - 180.0)
        return int(np.argmin(diffs))

    @staticmethod
    def _is_legacy_official_state_dict(state_dict) -> bool:
        keys = list(getattr(state_dict, "keys", lambda: [])())
        has_legacy_layers = any(key.startswith("layers.") for key in keys)
        has_legacy_head = any(key.startswith("conv_last.") for key in keys)
        has_adapter_keys = any(
            key.startswith("projector.") or key.startswith("backbone.")
            for key in keys
        )
        return has_legacy_layers and has_legacy_head and not has_adapter_keys

    def _load_official_task_model(
        self,
        task,
        model_architecture: str,
        input_channels: int,
        selected_channels: list[str],
        hidden_dims: list[int],
        height: int,
        width: int,
        window: int,
        horizon: int,
        use_sphere: bool,
        architecture_params: dict,
    ):
        state_dict = self._load_task_state_dict(task)
        uses_legacy_loader = self._is_legacy_official_state_dict(state_dict)

        if uses_legacy_loader:
            model = LegacyPredRNNv2(
                input_dim=int(input_channels),
                hidden_dims=list(hidden_dims or [64, 64, 64]),
                height=int(height),
                width=int(width),
                horizon=int(horizon),
            ).to(self.device)
        else:
            model = build_forecaster(
                architecture=model_architecture,
                input_channels=int(input_channels),
                selected_channels=list(selected_channels),
                hidden_dims=list(hidden_dims or [64, 64, 64]),
                height=int(height),
                width=int(width),
                window=int(window),
                horizon=int(horizon),
                use_sphere=use_sphere,
                architecture_params=architecture_params,
            ).to(self.device)

        model.load_state_dict(state_dict)
        model.eval()
        return model, uses_legacy_loader

    @staticmethod
    def _run_official_task_model(model, x_batch: torch.Tensor, ls_batch: torch.Tensor, uses_legacy_loader: bool):
        if uses_legacy_loader:
            return model(x_batch)
        return model(x_batch, ls_batch)

    @staticmethod
    def _channels_to_variable_names(channels: list[str] | str) -> list[str]:
        channel_map = {
            "U": "U_Wind",
            "V": "V_Wind",
            "D": "Dust_Optical_Depth",
            "S": "Solar_Flux_DN",
            "T": "Temperature",
        }
        return [channel_map[channel] for channel in list(channels or "") if channel in channel_map]

    @staticmethod
    def _fields_to_dicts(
        fields: np.ndarray,
        lat_arr: np.ndarray,
        lon_arr: np.ndarray,
        include_points: bool = True,
    ) -> list[dict]:
        result = []
        lat_list = [float(v) for v in lat_arr]
        lon_list = [float(v) for v in lon_arr]
        for step in range(fields.shape[0]):
            field = fields[step]
            points = []
            if include_points:
                for i, lat in enumerate(lat_arr):
                    for j, lon in enumerate(lon_arr):
                        val = float(field[i, j])
                        if not np.isnan(val):
                            points.append({
                                "lat": float(lat),
                                "lng": float(lon) if lon <= 180 else float(lon - 360),
                                "val": val,
                            })

            valid = field[~np.isnan(field)]
            result.append({
                "points": points,
                "lat": lat_list,
                "lon": lon_list,
                "field": np.nan_to_num(field).tolist(),
                "minVal": float(np.nanmin(valid)) if len(valid) > 0 else 0.0,
                "maxVal": float(np.nanmax(valid)) if len(valid) > 0 else 1.0,
            })
        return result

    async def get_test_results(self, task_id: int, data_dirs: dict[str, str] | None = None):
        """获取训练任务的测试结果（散点图数据）"""
        async with async_session_maker() as session:
            task = await session.get(ModelTrainingTask, task_id)
            if not task or not is_valid_model_weight_file(task.output_model_path):
                raise ValueError("Model file not found")

            # 1. 解析任务参数
            hypers = json.loads(task.hyperparameters)
            if getattr(task, "model_source", "official") == "uploaded":
                return await self._get_uploaded_model_test_results(task, hypers, data_dirs=data_dirs)

            window = hypers.get("window", 3)
            horizon = hypers.get("horizon", 3)
            hidden_dims = hypers.get("stlstm_hidden_dims", [64, 64, 64])
            model_architecture = normalize_model_architecture(hypers.get("model_architecture", "predrnnv2"))
            use_sphere = normalize_use_sphere(hypers)
            architecture_params = extract_architecture_params(hypers)
            
            # 2. 识别使用的变量
            active_vars = get_task_channel_suffix(task)
            # UDST -> ['U_Wind', 'Dust_Optical_Depth', 'Solar_Flux_DN', 'Temperature']
            mcd_vars_map = {
                'U': ('U_Wind', 'u'), 
                'V': ('V_Wind', 'v'), 
                'D': ('Dust_Optical_Depth', 'dustq'), 
                'S': ('Solar_Flux_DN', 'fluxsurf_dn_sw'), 
                'T': ('Temperature', 'temp')
            }
            used_mcd_vars = [mcd_vars_map[c] for c in active_vars if c in mcd_vars_map]
            base_input_dim = 1 + len(used_mcd_vars)

            # 3. 加载并预处理数据 (简化版，复用脚本逻辑)
            X_torch, y_torch, ls_torch, y_mean, y_std = self._prepare_data(
                used_mcd_vars,
                window,
                horizon,
                data_dirs=data_dirs,
            )
            
            # 4. 加载模型
            model, uses_legacy_loader = self._load_official_task_model(
                task=task,
                model_architecture=model_architecture,
                input_channels=base_input_dim,
                selected_channels=list(active_vars),
                hidden_dims=hidden_dims,
                height=int(X_torch.shape[-2]),
                width=int(X_torch.shape[-1]),
                window=int(window),
                horizon=int(horizon),
                use_sphere=use_sphere,
                architecture_params=architecture_params,
            )

            # 5. 执行推理 (仅针对测试集)
            split = int(0.8 * len(X_torch))
            X_test = X_torch[split:]
            y_test_true = y_torch[split:]
            
            with torch.no_grad():
                # 为了性能，限制测试点数
                sample_size = min(len(X_test), 50) 
                indices = np.linspace(0, len(X_test)-1, sample_size, dtype=int)
                
                test_xb = X_test[indices].to(self.device)
                test_yb = y_test_true[indices]
                test_lsb = ls_torch[split:][indices].to(self.device)
                
                preds = self._run_official_task_model(
                    model,
                    test_xb,
                    test_lsb,
                    uses_legacy_loader,
                ).cpu().numpy()
                trues = test_yb.numpy()

            # 6. 反标准化还原物理值
            y_pred_raw = preds * (y_std + 1e-6) + y_mean
            y_true_raw = trues * (y_std + 1e-6) + y_mean
            
            # 展平数据并进行子采样，防止前端渲染海量点位时卡顿（建议上限 50k 点）
            y_true_flat = y_true_raw.flatten()
            y_pred_flat = y_pred_raw.flatten()
            
            if len(y_true_flat) > 50000:
                step = len(y_true_flat) // 50000
                y_true_flat = y_true_flat[::step]
                y_pred_flat = y_pred_flat[::step]
            
            return {
                "y_true": y_true_flat.tolist(),
                "y_pred": y_pred_flat.tolist(),
                "metrics": json.loads(task.metrics) if task.metrics else {}
            }

    async def _get_uploaded_model_test_results(self, task, hypers, data_dirs=None):
        from training_backbones.user_model_runner import (
            assert_prediction_shape,
            build_uploaded_model_config,
            load_uploaded_model,
        )

        window = int(hypers.get("window", 3))
        horizon = int(hypers.get("horizon", 3))

        selected_channels, tensors = self._prepare_uploaded_task_tensors(
            hypers,
            window,
            horizon,
            data_dirs,
        )
        x_torch, y_torch, ls_torch, y_mean, y_std, height, width = tensors
        config = build_uploaded_model_config(
            in_channels=int(x_torch.shape[2]),
            window=window,
            horizon=horizon,
            height=height,
            width=width,
            selected_channels=selected_channels,
            custom_model_params=hypers.get("custom_model_params", {}),
            param_schema=hypers.get("_uploaded_model_param_schema", {}),
        )

        model_path = hypers.get("_uploaded_model_path")
        if not model_path:
            raise ValueError("Uploaded model path is missing from task hyperparameters")
        model = load_uploaded_model(Path(model_path), config).to(self.device)
        state_dict = self._load_task_state_dict(task)
        model.load_state_dict(state_dict)
        model.eval()

        split = int(0.8 * len(x_torch))
        x_test = x_torch[split:]
        y_test_true = y_torch[split:]
        ls_test = ls_torch[split:] if ls_torch is not None else None
        if len(x_test) == 0:
            raise ValueError("No uploaded model test samples are available")

        with torch.no_grad():
            sample_size = min(len(x_test), 50)
            indices = np.linspace(0, len(x_test) - 1, sample_size, dtype=int)
            test_xb = x_test[indices].to(self.device)
            test_yb = y_test_true[indices]
            test_lsb = ls_test[indices].to(self.device) if ls_test is not None else None
            pred_tensor = run_uploaded_model(
                model,
                test_xb,
                test_lsb,
                context="uploaded inference test",
            )
            assert_prediction_shape(
                pred_tensor,
                test_yb.to(self.device),
                "uploaded inference test",
            )
            preds = pred_tensor.cpu().numpy()
            trues = test_yb.numpy()

        y_pred_raw = preds * (y_std + 1e-6) + y_mean
        y_true_raw = trues * (y_std + 1e-6) + y_mean
        y_true_flat = y_true_raw.flatten()
        y_pred_flat = y_pred_raw.flatten()

        if len(y_true_flat) > 50000:
            step = int(np.ceil(len(y_true_flat) / 50000))
            y_true_flat = y_true_flat[::step]
            y_pred_flat = y_pred_flat[::step]

        return {
            "y_true": y_true_flat.tolist(),
            "y_pred": y_pred_flat.tolist(),
            "metrics": json.loads(task.metrics) if task.metrics else {},
        }

    def _prepare_data(self, used_mcd_vars, window, horizon, data_dirs: dict[str, str] | None = None):
        """复用训练脚本中的数据加载逻辑"""
        from scipy.interpolate import interp1d
        from sklearn.preprocessing import StandardScaler

        # --- Loading OpenMars ---
        openmars_dir = Path((data_dirs or {}).get("ARESVISION_OPENMARS_DIR") or self.openmars_dir)
        mcd_dir = Path((data_dirs or {}).get("ARESVISION_MCD_DIR") or self.mcd_dir)
        o3_list, om_ls_list = [], []
        def natural_sort_key(s): return [int(text) if text.isdigit() else text.lower() for text in re.split('([0-9]+)', str(s))]
        file_list = sorted(glob.glob(str(openmars_dir / "*.nc")), key=natural_sort_key)
        for f in file_list:
            with _NETCDF_READ_LOCK:
                ds = nc.Dataset(f)
                try:
                    o3_list.append(ds.variables['o3col'][:])
                    om_ls_list.append(ds.variables['Ls'][:] if 'Ls' in ds.variables else ds.variables['ls'][:])
                finally:
                    ds.close()
        y_raw = np.concatenate(o3_list, axis=0)
        om_ls_raw = np.concatenate(om_ls_list, axis=0)

        # --- Loading MCD ---
        if used_mcd_vars:
            short_names = [v[1] for v in used_mcd_vars]
            vars_dict = {}
            mcd_data = {sn: [] for sn in short_names}
            mcd_ls = []
            for f_nc in sorted(mcd_dir.glob("*.nc"), key=natural_sort_key):
                if not f_nc.exists(): continue
                with _NETCDF_READ_LOCK:
                    ds = nc.Dataset(f_nc, 'r')
                    try:
                        for var_name, sn in used_mcd_vars:
                            d = ds.variables[var_name][:]
                            mcd_data[sn].append(d.reshape(d.shape[0]*d.shape[1], d.shape[2], d.shape[3]))
                        ls_t = ds.variables['Ls'][:] if 'Ls' in ds.variables else ds.variables['ls'][:]
                        s_d, h_d = ds.variables[used_mcd_vars[0][0]].shape[:2]
                        ls_e = np.zeros(s_d * h_d)
                        for i in range(s_d):
                            ls_e[i*h_d:(i+1)*h_d] = np.linspace(ls_t[i], ls_t[i+1] if i < s_d-1 else ls_t[i]+0.5, h_d, endpoint=False)
                        mcd_ls.append(ls_e % 360.0)
                    finally:
                        ds.close()
            
            def unwrap(ls_in):
                out = np.copy(ls_in); off = 0
                for j in range(1, len(out)):
                    if ls_in[j] < ls_in[j-1]-180: off += 360
                    out[j] += off
                return out
            
            mcd_ls_c = unwrap(np.concatenate(mcd_ls))
            om_ls_c = unwrap(om_ls_raw)
            for sn in short_names:
                combined = np.concatenate(mcd_data[sn], axis=0)
                vars_dict[sn] = interp1d(mcd_ls_c, combined, axis=0, bounds_error=False, fill_value="extrapolate")(om_ls_c)
        else:
            short_names = []
            vars_dict = {}

        # --- Assembly ---
        feat_list = [y_raw] + [vars_dict[sn] for sn in short_names]
        X_raw = np.stack(feat_list, axis=-1)
        T = X_raw.shape[0]
        
        split_idx = int(0.8 * (T - window - horizon + 1)) + window
        X_scaled = np.zeros_like(X_raw)
        for c in range(X_raw.shape[-1]):
            scaler = StandardScaler()
            scaler.fit(X_raw[:split_idx, ..., c].reshape(split_idx, -1))
            X_scaled[..., c] = scaler.transform(X_raw[..., c].reshape(T, -1)).reshape(T, 36, 72)
        
        y_train_part = y_raw[:split_idx]
        y_mean, y_std = y_train_part.mean(), y_train_part.std()
        y_scaled = (y_raw - y_mean) / (y_std + 1e-6)

        X_seq, y_seq, ls_seq = [], [], []
        for i in range(T - window - horizon + 1):
            X_seq.append(X_scaled[i: i + window])
            y_seq.append(y_scaled[i + window: i + window + horizon])
            ls_seq.append(om_ls_raw[i: i + window])
        
        X_torch = torch.tensor(np.array(X_seq)).permute(0, 1, 4, 2, 3).float()
        y_torch = torch.tensor(np.array(y_seq)).unsqueeze(2).float()
        ls_torch = torch.tensor(np.array(ls_seq)).float()
        
        return X_torch, y_torch, ls_torch, y_mean, y_std
