"""Earth historical prediction endpoints.

These are the only prediction endpoints that accept an Earth task. The Mars
endpoints under ``/predict`` keep rejecting Earth tasks, and nothing here falls
back to Mars data preparation, Mars channels, MY/Ls or the Mars prediction cache.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from auth.dependencies import get_current_user
from database.models import User
from schemas.earth_predict import (
    EarthPredictContextResponse,
    EarthPredictRequest,
    EarthPredictResponse,
)
from services.dataset_identity import DatasetRequestError
from services.earth_dataset_metadata import EarthPackageError
from services.earth_prediction_service import (
    build_prediction_context,
    run_earth_prediction,
)

logger = logging.getLogger("aresvision.earth.predict")

router = APIRouter(prefix="/earth/predict", tags=["Earth Prediction"])


def _error_response(exc: Exception) -> HTTPException:
    if isinstance(exc, DatasetRequestError):
        detail = {"code": exc.code, "message": str(exc)}
        if exc.availability_reason:
            detail["availability_reason"] = exc.availability_reason
        return HTTPException(status_code=exc.status_code, detail=detail)
    if isinstance(exc, EarthPackageError):
        return HTTPException(
            status_code=503,
            detail={
                "code": "dataset_unavailable",
                "message": "The registered Earth dataset is not available",
                "availability_reason": exc.reason,
            },
        )
    raise exc


async def _load_task(request: Request, task_id: int, current_user: User):
    """Resolve the task and enforce the existing ownership rules."""
    from services.training_service import TrainingService

    service = getattr(request.app.state, "training_service", None) or TrainingService()
    task = await service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.user_id is not None and task.user_id != current_user.id:
        role = (getattr(current_user, "role", "") or "").lower()
        if role != "admin":
            raise HTTPException(status_code=403, detail="No permission to access this task")
    return task


def _registry(request: Request):
    registry = getattr(request.app.state, "dataset_registry", None)
    if registry is None:
        raise HTTPException(status_code=500, detail="dataset registry unavailable")
    return registry


@router.get("/context", response_model=EarthPredictContextResponse)
async def get_earth_predict_context(
    request: Request,
    training_task_id: int,
    current_user: User = Depends(get_current_user),
):
    """Return the selectable historical forecast origins and the trained grid."""
    task = await _load_task(request, training_task_id, current_user)
    try:
        context = await asyncio.to_thread(
            build_prediction_context, task, _registry(request)
        )
    except (DatasetRequestError, EarthPackageError) as exc:
        raise _error_response(exc) from exc
    except Exception as exc:  # pragma: no cover - surfaced for troubleshooting
        logger.exception("Earth prediction context failed: task_id=%s", training_task_id)
        raise HTTPException(status_code=500, detail=f"Earth prediction context failed: {exc}") from exc
    return {
        "planet": "earth",
        "task_id": context.task_id,
        "dataset_id": context.dataset_id,
        "dataset_version": context.dataset_version,
        "dataset_fingerprint": context.dataset_fingerprint,
        "target": context.target,
        "target_unit": context.target_unit,
        "window": context.window,
        "horizon": context.horizon,
        "input_channel_order": context.input_channel_order,
        "input_units": context.input_units,
        "grid": {
            "shape": context.grid_shape,
            "latitude": context.latitude,
            "longitude": context.longitude,
        },
        "origins": context.origins,
        "training_split_end": context.training_split_end,
        "metrics": context.metrics,
        "run": context.run,
    }


@router.post("/run", response_model=EarthPredictResponse)
async def run_earth_predict(
    request: Request,
    payload: EarthPredictRequest,
    current_user: User = Depends(get_current_user),
):
    """Forecast the three days after a selected historical origin."""
    task = await _load_task(request, payload.training_task_id, current_user)
    registry = _registry(request)
    try:
        result = await asyncio.to_thread(
            run_earth_prediction, task, payload.forecast_origin, registry
        )
    except (DatasetRequestError, EarthPackageError) as exc:
        raise _error_response(exc) from exc
    except Exception as exc:  # pragma: no cover - surfaced for troubleshooting
        logger.exception(
            "Earth prediction failed: task_id=%s origin=%s",
            payload.training_task_id,
            payload.forecast_origin,
        )
        raise HTTPException(status_code=500, detail=f"Earth prediction failed: {exc}") from exc
    return result
