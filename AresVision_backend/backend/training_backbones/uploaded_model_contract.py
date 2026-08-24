from __future__ import annotations

from typing import Any

import torch
from torch import nn


LS_AUXILIARY_INPUT = {
    "required": True,
    "shape": ["batch", "window"],
    "dtype": "float32",
    "unit": "degree",
}
CONTRACT_ATTRIBUTE = "_aresvision_auxiliary_inputs"


def normalize_auxiliary_inputs(model_spec: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(model_spec, dict):
        raise ValueError("MODEL_SPEC must be a dict")
    if "auxiliary_inputs" not in model_spec:
        return {}

    auxiliary_inputs = model_spec["auxiliary_inputs"]
    if not isinstance(auxiliary_inputs, dict):
        raise ValueError("MODEL_SPEC.auxiliary_inputs must be a dict")
    if set(auxiliary_inputs) != {"ls"}:
        raise ValueError("MODEL_SPEC.auxiliary_inputs supports only ls")
    ls_spec = auxiliary_inputs["ls"]
    if not isinstance(ls_spec, dict):
        raise ValueError(
            "MODEL_SPEC.auxiliary_inputs.ls must be a dict, "
            f"got {ls_spec!r} ({type(ls_spec).__name__})"
        )

    expected_fields = set(LS_AUXILIARY_INPUT)
    actual_fields = set(ls_spec)
    missing_fields = sorted(expected_fields - actual_fields)
    unexpected_fields = sorted(actual_fields - expected_fields)
    if missing_fields:
        raise ValueError(
            f"MODEL_SPEC.auxiliary_inputs.ls missing fields: {missing_fields}"
        )
    if unexpected_fields:
        raise ValueError(
            f"MODEL_SPEC.auxiliary_inputs.ls unexpected fields: {unexpected_fields}"
        )

    for field, expected in LS_AUXILIARY_INPUT.items():
        actual = ls_spec[field]
        if type(actual) is not type(expected) or actual != expected:
            raise ValueError(
                f"MODEL_SPEC.auxiliary_inputs.ls.{field} expected "
                f"{expected!r} ({type(expected).__name__}), got "
                f"{actual!r} ({type(actual).__name__})"
            )
    return {"ls": dict(LS_AUXILIARY_INPUT)}


def attach_uploaded_model_contract(model: nn.Module, model_spec: Any) -> nn.Module:
    setattr(model, CONTRACT_ATTRIBUTE, normalize_auxiliary_inputs(model_spec))
    return model


def uploaded_model_requires_ls(model: nn.Module) -> bool:
    return "ls" in getattr(model, CONTRACT_ATTRIBUTE, {})


def validate_ls_tensor(
    x: torch.Tensor,
    ls: Any,
    context: str,
) -> torch.Tensor:
    if ls is None:
        raise ValueError(f"{context} requires Ls data")
    if not isinstance(ls, torch.Tensor):
        raise ValueError(f"{context} Ls must be a torch.Tensor")
    if not ls.is_floating_point():
        raise ValueError(
            f"{context} Ls must use a floating-point dtype, got {ls.dtype}"
        )
    if ls.ndim != 2:
        raise ValueError(f"{context} Ls must be 2D, got {ls.ndim}D")

    expected_shape = (int(x.shape[0]), int(x.shape[1]))
    actual_shape = tuple(ls.shape)
    if actual_shape != expected_shape:
        raise ValueError(
            f"{context} Ls shape mismatch: "
            f"expected {expected_shape}, got {actual_shape}"
        )
    if not torch.isfinite(ls).all():
        raise ValueError(f"{context} Ls must contain only finite values")
    return ls


def run_uploaded_model(
    model: nn.Module,
    x: torch.Tensor,
    ls: Any = None,
    *,
    context: str = "uploaded model",
):
    if not uploaded_model_requires_ls(model):
        return model(x)
    return model(x, validate_ls_tensor(x, ls, context))
