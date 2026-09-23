from __future__ import annotations

import os
import sys
import json
import asyncio
import logging
import traceback
import psutil
import subprocess
import re
import tempfile
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import time
import numpy as np
import netCDF4 as nc
from sqlalchemy import delete, select, update

from config import (
    MCD_VARIABLES,
    TRAINING_RESULTS_DIR,
    TRAINING_SCRIPTS_DIR,
    USER_UPLOADS_DIR,
)
from database.engine import async_session_maker
from database.models import ModelTrainingTask, PredictionAnalysisCache, TrainingTaskTag
from services.data_service import DataService
from services.personal_data_source_service import PersonalDataSourceService
from services.model_artifacts import is_valid_model_weight_file
from services.training_failures import CUDA_OOM_ERROR_CODE, classify_training_log
from services.training_channels import (
    ARCHITECTURE_PARAM_KEYS,
    UNIFIED_TRAINING_SCRIPT,
    build_hyperparameter_args,
    normalize_training_hyperparameters,
)
from services.training_notifications import ensure_cuda_oom_notification
from services.training_paths import build_task_output_path
from services.training_tag_service import add_task_tag_links, begin_tag_write, validate_owned_tags
import config

logger = logging.getLogger("aresvision.training")

INVALID_MODEL_ARTIFACT_ERROR = (
    "Training process exited successfully but no valid model weight file was produced"
)

MODELS_DIR = TRAINING_SCRIPTS_DIR
LOGS_DIR = Path(__file__).parent.parent / "logs" / "training"
LOGS_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_MODELS_DIR = TRAINING_RESULTS_DIR
OUTPUT_MODELS_DIR.mkdir(parents=True, exist_ok=True)


def _normalize_training_data_source(data_source: str | None) -> str:
    source = (data_source or "default").strip().lower()
    if source == "personal":
        raise ValueError(
            "Personal raw uploads are only available in Data Overview; training uses server-managed datasets."
        )
    if source not in ("default",):
        raise ValueError("training data_source must be 'default'")
    return source


class TrainingService:
    def get_available_scripts(self) -> list[str]:
        script_path = MODELS_DIR / UNIFIED_TRAINING_SCRIPT
        if not script_path.exists():
            return []
        return [UNIFIED_TRAINING_SCRIPT]

    async def start_training(
        self,
        user_id: int | None,
        model_script: str,
        hyperparameters: dict,
        custom_model_name: str | None = None,
        data_source: str = "default",
        data_service: DataService | None = None,
        personal_source_service: PersonalDataSourceService | None = None,
        model_source: str = "official",
        uploaded_model_id: str | None = None,
        user_model_service: Any | None = None,
        training_weight_service: Any | None = None,
        is_admin: bool = False,
        tag_ids: list[int] | None = None,
    ) -> ModelTrainingTask:
        model_source = (model_source or "official").strip().lower()
        if model_source not in ("official", "uploaded"):
            model_source = "official"

        if not custom_model_name or not custom_model_name.strip():
            raise ValueError("模型命名不能为空")

        source = _normalize_training_data_source(data_source)

        async with async_session_maker() as session:
            await validate_owned_tags(session, user_id, tag_ids or [])
            existing = await session.execute(
                select(ModelTrainingTask).where(ModelTrainingTask.custom_model_name == custom_model_name.strip())
            )
            if existing.scalars().first():
                raise ValueError(f"模型名称 '{custom_model_name}' 已被使用，请换一个名称")

        if model_source == "uploaded":
            model_script, raw_hypers = await self._resolve_uploaded_training_entrypoint(
                user_id=user_id,
                uploaded_model_id=uploaded_model_id,
                hyperparameters=hyperparameters,
                user_model_service=user_model_service,
            )
        else:
            model_script, raw_hypers = self._resolve_training_entrypoint(
                user_id=user_id,
                model_source=model_source,
                uploaded_model_id=uploaded_model_id,
                hyperparameters=hyperparameters,
                user_model_service=user_model_service,
            )

        if model_script == "__user_model_runner__":
            runner_path = Path(__file__).parent.parent / "training_backbones" / "user_model_runner.py"
            if not runner_path.exists():
                raise FileNotFoundError(f"Script {runner_path.name} not found in {runner_path.parent}")
        elif not MODELS_DIR.joinpath(model_script).exists():
            raise FileNotFoundError(f"Script {model_script} not found in {MODELS_DIR}")

        preserved_keys = ["model_source"]
        if model_source == "uploaded":
            preserved_keys.extend([
                "_uploaded_model_id",
                "_uploaded_model_version",
                "_uploaded_model_path",
                "_uploaded_model_param_schema",
                "custom_model_params",
            ])
        preserved_hypers = {key: raw_hypers[key] for key in preserved_keys if key in raw_hypers}
        payload_hypers = normalize_training_hyperparameters(raw_hypers)
        payload_hypers.update(preserved_hypers)
        # Labels are organization metadata, never model/cache identity or runner arguments.
        payload_hypers.pop("tag_ids", None)
        payload_hypers.pop("tags", None)
        payload_hypers["_data_source"] = source
        transfer_env_overrides = await self._resolve_transfer_source(
            user_id=user_id,
            is_admin=is_admin,
            hyperparameters=payload_hypers,
            training_weight_service=training_weight_service,
        )

        async with async_session_maker() as session:
            # Recheck in the same transaction that writes the task and its associations.
            await begin_tag_write(session)
            tags = await validate_owned_tags(session, user_id, tag_ids or [])
            task = ModelTrainingTask(
                user_id=user_id,
                model_script=model_script,
                model_source=model_source,
                uploaded_model_id=payload_hypers.get("_uploaded_model_id"),
                uploaded_model_version=payload_hypers.get("_uploaded_model_version"),
                hyperparameters=json.dumps(payload_hypers),
                custom_model_name=custom_model_name,
                status="pending",
            )
            session.add(task)
            await session.flush()

            task_id = task.id
            log_file = LOGS_DIR / f"task_{task_id}.log"

            output_path = build_task_output_path(
                task_id,
                custom_model_name,
                results_dir=OUTPUT_MODELS_DIR,
            )

            task.log_file_path = str(log_file)
            task.output_model_path = str(output_path)
            await add_task_tag_links(session, [task_id], [tag.id for tag in tags])

            env_overrides: dict[str, str] = dict(transfer_env_overrides)
            temp_data_root: Path | None = None

            await session.commit()
            logger.info(
                "Training task queued: id=%s script=%s source=%s effective=%s",
                task_id,
                model_script,
                source,
                payload_hypers.get("_effective_data_source", source),
            )

            asyncio.create_task(
                self._run_training_subprocess(
                    task_id,
                    model_script,
                    payload_hypers,
                    log_file,
                    output_path,
                    env_overrides=env_overrides,
                    temp_data_root=temp_data_root,
                )
            )

            return task

    def _resolve_training_entrypoint(
        self,
        user_id: int | None,
        model_source: str,
        uploaded_model_id: str | None,
        hyperparameters: dict | None,
        user_model_service: Any | None,
    ) -> tuple[str, dict]:
        uploaded_only_keys = {
            "_uploaded_model_id",
            "_uploaded_model_version",
            "_uploaded_model_path",
            "_uploaded_model_param_schema",
            "custom_model_params",
        }
        payload = {
            key: value
            for key, value in (hyperparameters or {}).items()
            if key not in uploaded_only_keys
        }
        payload["model_source"] = "official"
        return UNIFIED_TRAINING_SCRIPT, payload

    async def _resolve_uploaded_training_entrypoint(
        self,
        user_id: int | None,
        uploaded_model_id: str | None,
        hyperparameters: dict | None,
        user_model_service: Any | None,
    ) -> tuple[str, dict]:
        if user_id is None:
            raise ValueError("user_id is required for uploaded model training")
        if not uploaded_model_id:
            raise ValueError("uploaded_model_id is required for uploaded model training")
        if user_model_service is None:
            raise ValueError("user_model_service is required for uploaded model training")

        package = await user_model_service.get_package_for_user(uploaded_model_id, user_id)
        if getattr(package, "validation_status", None) != "valid":
            raise ValueError("Uploaded model package must be valid before training")

        try:
            param_schema = json.loads(getattr(package, "param_schema", None) or "{}")
        except Exception:
            param_schema = {}
        if not isinstance(param_schema, dict):
            param_schema = {}

        payload = dict(hyperparameters or {})
        payload["model_source"] = "uploaded"
        payload["_uploaded_model_id"] = getattr(package, "id", uploaded_model_id)
        payload["_uploaded_model_version"] = getattr(package, "version", None)
        payload["_uploaded_model_path"] = getattr(package, "storage_path", None)
        payload["_uploaded_model_param_schema"] = param_schema
        payload.setdefault("custom_model_params", {})
        return "__user_model_runner__", payload

    async def _resolve_transfer_source(
        self,
        user_id: int | None,
        hyperparameters: dict,
        training_weight_service: Any | None,
        is_admin: bool = False,
    ) -> dict[str, str]:
        if not hyperparameters.get("transfer_learning"):
            return {}

        source_type = str(hyperparameters.get("transfer_source_type") or "task").strip().lower()
        if source_type == "upload":
            if training_weight_service is None:
                raise ValueError("training_weight_service is required for uploaded transfer weights")
            weight_id = str(hyperparameters.get("transfer_weight_id") or "").strip()
            if not weight_id:
                raise ValueError("transfer_weight_id is required for uploaded transfer weights")
            if user_id is None:
                raise ValueError("user_id is required for uploaded transfer weights")
            record = await training_weight_service.get_weight_for_user(weight_id, user_id)
            if getattr(record, "status", None) != "ready":
                raise ValueError("Uploaded transfer weight must be ready before training")
            weight_path = Path(getattr(record, "storage_path", "") or "")
            if not weight_path.exists():
                raise FileNotFoundError("Uploaded transfer weight file is missing")
            return {"ARESVISION_TRANSFER_WEIGHT_PATH": str(weight_path)}

        source_task_id = int(hyperparameters.get("transfer_source_task_id") or 0)
        if source_task_id <= 0:
            raise ValueError("transfer_source_task_id is required for task transfer learning")

        async with async_session_maker() as session:
            source_task = await session.get(ModelTrainingTask, source_task_id)

        if source_task is None:
            raise ValueError("Transfer source task not found")
        if not is_admin and user_id is not None and getattr(source_task, "user_id", None) not in (None, user_id):
            raise PermissionError("No permission to access this transfer source task")
        if getattr(source_task, "status", None) != "completed":
            raise ValueError("Transfer source task must be completed")

        weight_path = Path(getattr(source_task, "output_model_path", "") or "")
        if not is_valid_model_weight_file(weight_path):
            raise FileNotFoundError("Transfer source task weight file is missing")

        source_hypers = self._parse_task_hyperparameters(source_task)
        self._validate_transfer_task_compatibility(source_task, source_hypers, hyperparameters)
        return {"ARESVISION_TRANSFER_WEIGHT_PATH": str(weight_path)}

    @staticmethod
    def _parse_task_hyperparameters(task: Any) -> dict:
        try:
            parsed = json.loads(getattr(task, "hyperparameters", "") or "{}")
        except Exception:
            parsed = {}
        return parsed if isinstance(parsed, dict) else {}

    def _validate_transfer_task_compatibility(
        self,
        source_task: Any,
        source_hypers: dict,
        target_hypers: dict,
    ) -> None:
        source_model = str(getattr(source_task, "model_source", None) or source_hypers.get("model_source") or "official")
        target_model = str(target_hypers.get("model_source") or "official")
        if source_model != target_model:
            raise ValueError("Transfer source task model source does not match current training")

        keys = [
            "selected_channels",
            "window",
            "horizon",
            "use_sphere",
        ]
        if target_model == "official":
            keys.append("model_architecture")
            keys.extend(key for key in target_hypers if key in ARCHITECTURE_PARAM_KEYS)
        else:
            if getattr(source_task, "uploaded_model_id", None) != target_hypers.get("_uploaded_model_id"):
                raise ValueError("Transfer source uploaded model does not match current uploaded model")
            if getattr(source_task, "uploaded_model_version", None) != target_hypers.get("_uploaded_model_version"):
                raise ValueError("Transfer source uploaded model version does not match current uploaded model")

        for key in keys:
            if source_hypers.get(key) != target_hypers.get(key):
                raise ValueError(f"Transfer source task configuration does not match: {key}")

    async def _prepare_personal_training_env(
        self,
        user_id: int | None,
        task_id: int,
        data_service: DataService | None,
        personal_source_service: PersonalDataSourceService | None,
    ) -> tuple[dict[str, str], Path | None, str, str | None]:
        if user_id is None:
            return {}, None, "default", "personal source requested without user id; fallback to default"
        if data_service is None or personal_source_service is None:
            return {}, None, "default", "personal source resolver unavailable; fallback to default"

        temp_root = Path(tempfile.mkdtemp(prefix=f"aresvision_train_{task_id}_"))
        openmars_dir = temp_root / "openmars"
        mcd_dir = temp_root / "MCD"
        openmars_dir.mkdir(parents=True, exist_ok=True)
        mcd_dir.mkdir(parents=True, exist_ok=True)

        has_personal = False
        try:
            years = data_service.get_available_years() or [27, 28]
            for year in years:
                resolution = await personal_source_service.resolve_for_year("personal", year, user_id)
                if resolution.effective_source != "default":
                    has_personal = True

                my = int(resolution.mars_year)
                openmars_path = openmars_dir / f"openmars_my{my}_ls_personal.nc"
                self._write_openmars_nc(openmars_path, resolution.openmars_data)

                mcd_src = resolution.mcd_raw_data or data_service.get_mcd_data(my)
                mcd_path = mcd_dir / f"MCD_MY{my}_Lat-90-90_real.nc"
                self._write_mcd_nc(mcd_path, mcd_src, resolution.openmars_data)

            effective_source = "personal" if has_personal else "default"
            note = None if has_personal else "personal datasets unavailable; fallback to default training data"
            env = {
                "ARESVISION_OPENMARS_DIR": str(openmars_dir),
                "ARESVISION_MCD_DIR": str(mcd_dir),
            }
            return env, temp_root, effective_source, note
        except Exception:
            shutil.rmtree(temp_root, ignore_errors=True)
            raise

    async def prepare_task_inference_data_env(
        self,
        task: ModelTrainingTask,
        data_service: DataService | None,
        personal_source_service: PersonalDataSourceService | None,
    ) -> tuple[dict[str, str], Path | None]:
        return {}, None

    def cleanup_temp_data_root(self, temp_data_root: Path | None) -> None:
        if temp_data_root is not None:
            shutil.rmtree(temp_data_root, ignore_errors=True)

    def _write_openmars_nc(self, file_path: Path, openmars_data: dict[str, Any]) -> None:
        lat = np.asarray(openmars_data.get("lat"), dtype=np.float32).reshape(-1)
        lon = np.asarray(openmars_data.get("lon"), dtype=np.float32).reshape(-1)
        ls = np.asarray(openmars_data.get("ls"), dtype=np.float32).reshape(-1)
        o3 = np.asarray(openmars_data.get("o3col"), dtype=np.float32)

        if o3.ndim == 4:
            o3 = np.nanmean(o3, axis=1)
        if o3.ndim != 3:
            raise ValueError(f"Invalid openmars o3col shape: {o3.shape}")

        n_time = min(len(ls), o3.shape[0])
        if n_time <= 0:
            raise ValueError("Empty openmars timeline")

        ls = ls[:n_time]
        o3 = o3[:n_time, : len(lat), : len(lon)]

        sort_idx = np.argsort(ls)
        ls = ls[sort_idx]
        o3 = o3[sort_idx]

        with nc.Dataset(str(file_path), "w", format="NETCDF4") as ds:
            ds.createDimension("time", n_time)
            ds.createDimension("lat", len(lat))
            ds.createDimension("lon", len(lon))

            v_ls = ds.createVariable("Ls", "f4", ("time",))
            v_lat = ds.createVariable("lat", "f4", ("lat",))
            v_lon = ds.createVariable("lon", "f4", ("lon",))
            v_o3 = ds.createVariable("o3col", "f4", ("time", "lat", "lon"), zlib=True)

            v_ls[:] = ls
            v_lat[:] = lat
            v_lon[:] = lon
            v_o3[:] = o3

    def _write_mcd_nc(self, file_path: Path, mcd_data: dict[str, Any], openmars_data: dict[str, Any]) -> None:
        lat_raw = mcd_data.get("lat")
        lon_raw = mcd_data.get("lon")
        ls_raw = mcd_data.get("ls")

        lat = np.asarray(lat_raw if lat_raw is not None else openmars_data.get("lat"), dtype=np.float32).reshape(-1)
        lon = np.asarray(lon_raw if lon_raw is not None else openmars_data.get("lon"), dtype=np.float32).reshape(-1)
        ls = np.asarray(ls_raw if ls_raw is not None else openmars_data.get("ls"), dtype=np.float32).reshape(-1)

        if ls.size == 0:
            raise ValueError("Empty MCD ls timeline")

        hourly_vars: dict[str, np.ndarray] = {}
        max_hour = 1
        min_time = int(ls.shape[0])

        for var in MCD_VARIABLES:
            arr = None
            hourly_key = f"{var}_hourly"
            if hourly_key in mcd_data and mcd_data[hourly_key] is not None:
                arr = np.asarray(mcd_data[hourly_key], dtype=np.float32)
            elif var in mcd_data and mcd_data[var] is not None:
                arr = np.asarray(mcd_data[var], dtype=np.float32)

            if arr is None:
                raise ValueError(f"MCD variable missing: {var}")

            if arr.ndim == 3:
                arr = arr[:, None, :, :]
            elif arr.ndim != 4:
                raise ValueError(f"Invalid MCD shape for {var}: {arr.shape}")

            hourly_vars[var] = arr
            max_hour = max(max_hour, int(arr.shape[1]))
            min_time = min(min_time, int(arr.shape[0]))

        lat_size = min(int(len(lat)), *[int(v.shape[2]) for v in hourly_vars.values()])
        lon_size = min(int(len(lon)), *[int(v.shape[3]) for v in hourly_vars.values()])
        if min_time <= 0 or lat_size <= 0 or lon_size <= 0:
            raise ValueError("Invalid MCD dimensions after alignment")

        ls = ls[:min_time]
        lat = lat[:lat_size]
        lon = lon[:lon_size]

        normalized: dict[str, np.ndarray] = {}
        for var, arr in hourly_vars.items():
            arr = arr[:min_time, :, :lat_size, :lon_size]
            h = int(arr.shape[1])
            if h < max_hour:
                repeat_factor = int(np.ceil(max_hour / h))
                arr = np.repeat(arr, repeat_factor, axis=1)[:, :max_hour, :, :]
            elif h > max_hour:
                arr = arr[:, :max_hour, :, :]
            normalized[var] = arr

        with nc.Dataset(str(file_path), "w", format="NETCDF4") as ds:
            ds.createDimension("sol", min_time)
            ds.createDimension("hour", max_hour)
            ds.createDimension("lat", lat_size)
            ds.createDimension("lon", lon_size)

            v_ls = ds.createVariable("Ls", "f4", ("sol",))
            v_lat = ds.createVariable("lat", "f4", ("lat",))
            v_lon = ds.createVariable("lon", "f4", ("lon",))
            v_ls[:] = ls
            v_lat[:] = lat
            v_lon[:] = lon

            for var in MCD_VARIABLES:
                v = ds.createVariable(var, "f4", ("sol", "hour", "lat", "lon"), zlib=True)
                v[:] = normalized[var]

    async def _run_training_subprocess(
        self,
        task_id: int,
        script_name: str,
        hyperparameters: dict,
        log_file: Path,
        output_path: Path,
        env_overrides: dict[str, str] | None = None,
        temp_data_root: Path | None = None,
    ):
        total_epochs = hyperparameters.get("epochs", 1)
        async with async_session_maker() as session:
            task = await session.get(ModelTrainingTask, task_id)
            if task:
                task.status = "running"
                task.total_epochs = total_epochs
                await session.commit()

        if script_name == "__user_model_runner__":
            script_path = Path(__file__).parent.parent / "training_backbones" / "user_model_runner.py"
        else:
            script_path = MODELS_DIR / script_name
        python_exe = getattr(config, "TRAINING_PYTHON_PATH", sys.executable)

        args = [python_exe, str(script_path)]
        args.extend(build_hyperparameter_args(hyperparameters))
        if script_name == "__user_model_runner__":
            args.extend([
                "--uploaded_model_path",
                str(hyperparameters["_uploaded_model_path"]),
                "--uploaded_model_param_schema",
                json.dumps(hyperparameters.get("_uploaded_model_param_schema") or {}),
            ])
        args.extend(["--output_path", str(output_path)])

        with open(log_file, "w", encoding="utf-8") as f:
            f.write(f"--- 训练任务 {task_id} 已启动 ---\\n")
            f.flush()

        try:
            process_env = {
                **os.environ,
                "PYTHONIOENCODING": "utf-8",
                "PYTHONUNBUFFERED": "1",
            }
            if env_overrides:
                process_env.update(env_overrides)

            process = subprocess.Popen(
                args,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                cwd=str(MODELS_DIR),
                env=process_env,
                text=True,
                bufsize=1,
                encoding="utf-8",
                errors="replace",
            )
            logger.info("Training subprocess started: task_id=%s pid=%s script=%s", task_id, process.pid, script_name)

            async with async_session_maker() as session:
                task = await session.get(ModelTrainingTask, task_id)
                if task:
                    task.pid = process.pid
                    await session.commit()

            start_time_ts = time.time()
            from services.ws_manager import manager as ws_manager
            loop = asyncio.get_event_loop()

            loss_history_buf = {"train": [], "val": []}
            pending_progress_updates = []
            async with async_session_maker() as session:
                task = await session.get(ModelTrainingTask, task_id)
                if task and task.loss_history:
                    try:
                        loss_history_buf = json.loads(task.loss_history)
                    except Exception:
                        pass

            def read_and_parse_thread():
                with open(log_file, "a", encoding="utf-8") as f:
                    for line in iter(process.stdout.readline, ""):
                        f.write(line)
                        f.flush()

                        progress_data = self._parse_progress_from_log(line, total_epochs, start_time_ts, loss_history_buf)
                        if progress_data:
                            pending_progress_updates.append(
                                asyncio.run_coroutine_threadsafe(
                                    self._update_task_progress(task_id, progress_data, ws_manager),
                                    loop,
                                )
                            )
                    process.stdout.close()

            await asyncio.to_thread(read_and_parse_thread)
            if pending_progress_updates:
                await asyncio.gather(
                    *(asyncio.wrap_future(future) for future in pending_progress_updates),
                    return_exceptions=True,
                )
            returncode = await asyncio.to_thread(process.wait)
            failure_code = (
                classify_training_log(log_file) if returncode != 0 else None
            )
            model_artifact_valid = returncode == 0 and is_valid_model_weight_file(output_path)
            status = "completed" if model_artifact_valid else "failed"

            if returncode == 0 and not model_artifact_valid:
                with open(log_file, "a", encoding="utf-8") as f:
                    f.write(f"\n[System error]: {INVALID_MODEL_ARTIFACT_ERROR}\n")
                logger.error(
                    "%s: task_id=%s output_path=%s",
                    INVALID_MODEL_ARTIFACT_ERROR,
                    task_id,
                    output_path,
                )

            async with async_session_maker() as session:
                task = await session.get(ModelTrainingTask, task_id)
                if task:
                    task.status = status
                    task.end_time = datetime.now(timezone.utc)
                    task.progress = 100.0 if status == "completed" else task.progress
                    if status == "completed":
                        parsed_metrics = self._extract_metrics_from_log(log_file)
                        task.metrics = json.dumps(parsed_metrics) if parsed_metrics else json.dumps({"note": "completed"})
                    elif returncode == 0:
                        task.progress = min(float(task.progress or 0.0), 99.0)
                        task.metrics = json.dumps({"error": INVALID_MODEL_ARTIFACT_ERROR})
                    elif failure_code == CUDA_OOM_ERROR_CODE:
                        task.metrics = json.dumps(
                            {
                                "error_code": CUDA_OOM_ERROR_CODE,
                                "error": "GPU memory is exhausted",
                            }
                        )
                    await session.commit()

            if task and failure_code == CUDA_OOM_ERROR_CODE:
                try:
                    async with async_session_maker() as notification_session:
                        notification_task = await notification_session.get(
                            ModelTrainingTask,
                            task_id,
                        )
                        if notification_task and await ensure_cuda_oom_notification(
                            notification_session,
                            notification_task,
                        ):
                            await notification_session.commit()
                except Exception:
                    logger.exception(
                        "Could not create CUDA OOM notification: task_id=%s",
                        task_id,
                    )

            if task:
                await ws_manager.broadcast_to_task(str(task_id), {
                    "type": "status_update",
                    "task_id": task_id,
                    "status": status,
                })
                logger.info("Training task finished: id=%s status=%s", task_id, status)

        except Exception:
            error_msg = traceback.format_exc()
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(f"\\n[系统错误]:\\n{error_msg}")

            logger.error(f"Task {task_id} failed with error: {error_msg}")

            async with async_session_maker() as session:
                task = await session.get(ModelTrainingTask, task_id)
                if task:
                    task.status = "failed"
                    task.end_time = datetime.now(timezone.utc)
                    await session.commit()
        finally:
            if temp_data_root is not None:
                shutil.rmtree(temp_data_root, ignore_errors=True)

    async def _update_task_progress(self, task_id: int, progress_data: dict, ws_manager):
        async with async_session_maker() as session:
            update_values = {
                "progress": progress_data["progress"],
                "current_epoch": progress_data["current_epoch"],
                "current_loss": progress_data["current_loss"],
                "eta": progress_data["eta"],
            }
            if "loss_history" in progress_data:
                update_values["loss_history"] = json.dumps(progress_data["loss_history"])

            await session.execute(
                update(ModelTrainingTask)
                .where(ModelTrainingTask.id == task_id)
                .values(**update_values)
            )
            await session.commit()

        await ws_manager.broadcast_to_task(str(task_id), {
            "type": "training_update",
            "task_id": task_id,
            "data": progress_data,
        })

    async def get_task(self, task_id: int) -> ModelTrainingTask:
        async with async_session_maker() as session:
            task = await session.get(ModelTrainingTask, task_id)
            return task

    async def get_all_tasks(self) -> list[ModelTrainingTask]:
        async with async_session_maker() as session:
            result = await session.execute(select(ModelTrainingTask).order_by(ModelTrainingTask.id.desc()))
            return result.scalars().all()

    async def rename_model(self, task_id: int, model_name: str) -> ModelTrainingTask:
        normalized_name = (model_name or "").strip()
        if not normalized_name:
            raise ValueError("模型名称不能为空")
        if len(normalized_name) > 255:
            raise ValueError("模型名称不能超过 255 个字符")

        async with async_session_maker() as session:
            task = await session.get(ModelTrainingTask, task_id)
            if not task:
                raise FileNotFoundError("Task not found")
            if task.status != "completed":
                raise ValueError("只能重命名已完成训练的模型")

            existing = await session.execute(
                select(ModelTrainingTask).where(
                    ModelTrainingTask.custom_model_name == normalized_name,
                    ModelTrainingTask.id != task_id,
                )
            )
            if existing.scalars().first():
                raise ValueError(f"模型名称 '{normalized_name}' 已被使用，请换一个名称")

            task.custom_model_name = normalized_name
            await session.commit()
            await session.refresh(task)
            return task

    async def stop_training(self, task_id: int):
        async with async_session_maker() as session:
            task = await session.get(ModelTrainingTask, task_id)
            if not task or task.status != "running" or not task.pid:
                return False

            try:
                parent = psutil.Process(task.pid)
                for child in parent.children(recursive=True):
                    child.terminate()
                parent.terminate()

                _, alive = psutil.wait_procs([parent] + parent.children(), timeout=3)
                for p in alive:
                    p.kill()

                task.status = "failed"
                task.end_time = datetime.now(timezone.utc)
                task.metrics = json.dumps({"note": "Stopped by user"})
                await session.commit()
                return True
            except psutil.NoSuchProcess:
                task.status = "failed"
                await session.commit()
                return True
            except Exception as e:
                logger.error(f"Error stopping task {task_id}: {e}")
                return False

    async def delete_task(self, task_id: int):
        async with async_session_maker() as session:
            task = await session.get(ModelTrainingTask, task_id)
            if not task:
                return False

            if task.status == "running":
                await self.stop_training(task_id)
                await session.refresh(task)

            if task.log_file_path and os.path.exists(task.log_file_path):
                try:
                    os.remove(task.log_file_path)
                except Exception:
                    pass

            if task.output_model_path and os.path.exists(task.output_model_path):
                try:
                    os.remove(task.output_model_path)
                except Exception:
                    pass

            await session.execute(
                delete(PredictionAnalysisCache).where(
                    PredictionAnalysisCache.training_task_id == task.id
                )
            )
            await session.execute(
                delete(TrainingTaskTag).where(TrainingTaskTag.task_id == task.id)
            )
            await session.delete(task)
            await session.commit()
            return True

    def _extract_metrics_from_log(self, log_file: Path) -> dict | None:
        if not log_file.exists():
            return None
        try:
            with open(log_file, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()

            metrics = {}
            patterns = {
                "mse": r"MSE:\s*([\d\.]+)",
                "rmse": r"RMSE:\s*([\d\.]+)",
                "r2": r"R-Squared:\s*([\d\.\-]+)",
                "mape": r"MAPE:\s*([\d\.]+)%",
                "smape": r"SMAPE:\s*([\d\.]+)%",
            }

            for key, pattern in patterns.items():
                match = re.search(pattern, content)
                if match:
                    metrics[key] = float(match.group(1))

            return metrics if metrics else None
        except Exception as e:
            logger.error(f"Error extracting metrics from log: {e}")
            return None

    async def test_model(self, task_id: int):
        return {"id": task_id, "status": "testing"}

    def _parse_progress_from_log(self, line: str, total_epochs: int, start_time: float, history: dict = None) -> dict | None:
        batch_pattern = r"Epoch\s+(\d+)/(\d+)\s+Batch\s+(\d+)/(\d+)\s+Loss=([\d\.]+)"
        batch_match = re.search(batch_pattern, line)
        if batch_match:
            current_ep = int(batch_match.group(1))
            total_ep_from_log = int(batch_match.group(2))
            batch_idx = int(batch_match.group(3))
            batch_total = max(1, int(batch_match.group(4)))
            loss = float(batch_match.group(5))

            effective_total_epochs = max(total_epochs, total_ep_from_log)
            completed_units = max(0.0, (current_ep - 1) + (batch_idx / batch_total))
            progress = min(99.9, (completed_units / max(1, effective_total_epochs)) * 100.0)

            elapsed = time.time() - start_time
            if completed_units > 0:
                total_est = elapsed / completed_units * effective_total_epochs
                remaining = max(0, total_est - elapsed)
                m, s = divmod(int(remaining), 60)
                h, m = divmod(m, 60)
                eta = f"{h:02d}:{m:02d}:{s:02d}" if h > 0 else f"{m:02d}:{s:02d}"
            else:
                eta = "--:--"

            return {
                "progress": round(progress, 2),
                "current_epoch": current_ep,
                "total_epochs": effective_total_epochs,
                "current_loss": round(loss, 4),
                "eta": eta,
            }

        epoch_pattern = r"Epoch\s+(\d+)/(\d+)\s+Loss=([\d\.]+)(?:\s+Val Loss=([\d\.]+))?"
        epoch_match = re.search(epoch_pattern, line)
        if epoch_match:
            current_ep = int(epoch_match.group(1))
            total_ep_from_log = int(epoch_match.group(2))
            loss = float(epoch_match.group(3))
            val_loss = float(epoch_match.group(4)) if epoch_match.group(4) else None
            effective_total_epochs = max(total_epochs, total_ep_from_log)
            progress = (current_ep / max(1, effective_total_epochs)) * 100

            if history is not None and len(history["train"]) < current_ep:
                history["train"].append(loss)
                history["val"].append(val_loss if val_loss is not None else None)

            elapsed = time.time() - start_time
            if current_ep > 0:
                total_est = elapsed / current_ep * effective_total_epochs
                remaining = max(0, total_est - elapsed)
                m, s = divmod(int(remaining), 60)
                h, m = divmod(m, 60)
                eta = f"{h:02d}:{m:02d}:{s:02d}" if h > 0 else f"{m:02d}:{s:02d}"
            else:
                eta = "--:--"

            return {
                "progress": round(progress, 2),
                "current_epoch": current_ep,
                "total_epochs": effective_total_epochs,
                "current_loss": round(loss, 4),
                "val_loss": round(val_loss, 4) if val_loss is not None else None,
                "eta": eta,
                "loss_history": history,
            }
        return None
