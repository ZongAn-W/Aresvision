import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.user_model_validator import UserModelValidator  # noqa: E402


VALID_MODEL_SOURCE = """
import torch
from torch import nn

MODEL_SPEC = {
    "name": "TinyModel",
    "description": "Tiny repeat baseline for validator tests.",
    "parameters": {
        "hidden_dim": {
            "type": "int",
            "default": 8,
            "min": 1,
            "max": 32,
        },
        "dropout": {
            "type": "float",
            "default": 0.1,
            "min": 0.0,
            "max": 0.5,
        },
        "use_bias": {
            "type": "bool",
            "default": True,
        },
        "activation": {
            "type": "select",
            "default": "relu",
            "options": ["relu", "gelu"],
        },
    },
}


class TinyModel(nn.Module):
    def __init__(self, horizon):
        super().__init__()
        self.horizon = horizon

    def forward(self, x):
        last = x[:, -1, :1]
        return last.unsqueeze(1).repeat(1, self.horizon, 1, 1, 1)


def build_model(config):
    return TinyModel(config["horizon"])
"""

LS_MODEL_SOURCE = """
import torch
from torch import nn

MODEL_SPEC = {
    "name": "TinyLsModel",
    "description": "Tiny model requiring historical solar longitude.",
    "auxiliary_inputs": {
        "ls": {
            "required": True,
            "shape": ["batch", "window"],
            "dtype": "float32",
            "unit": "degree",
        }
    },
    "parameters": {},
}


class TinyLsModel(nn.Module):
    def __init__(self, horizon):
        super().__init__()
        self.horizon = horizon

    def forward(self, x, ls):
        if ls.shape != x.shape[:2]:
            raise ValueError(f"misaligned Ls: {ls.shape} vs {x.shape[:2]}")
        if ls.dtype != torch.float32:
            raise ValueError(f"wrong Ls dtype: {ls.dtype}")
        last = x[:, -1, :1]
        return last.unsqueeze(1).repeat(1, self.horizon, 1, 1, 1)


def build_model(config):
    return TinyLsModel(config["horizon"])
"""


def _write_temp_model(temp_dir: str, source: str) -> Path:
    path = Path(temp_dir) / "uploaded_model.py"
    path.write_text(source, encoding="utf-8")
    return path


def _validate_source(source: str):
    with tempfile.TemporaryDirectory() as temp_dir:
        path = _write_temp_model(temp_dir, source)
        return UserModelValidator.validate_file(path)


def _validate_source_with_validator(source: str, validator: UserModelValidator):
    with tempfile.TemporaryDirectory() as temp_dir:
        path = _write_temp_model(temp_dir, source)
        return validator.validate_file(path)


def test_valid_model_passes_and_reports_metadata():
    result = _validate_source(VALID_MODEL_SOURCE)

    assert result.ok is True
    assert result.errors == []
    assert result.display_name == "TinyModel"
    assert result.description == "Tiny repeat baseline for validator tests."
    assert result.param_schema["hidden_dim"]["default"] == 8
    assert result.output_shape == [2, 3, 1, 8, 16]


def test_ls_model_dry_run_receives_declared_auxiliary_input():
    result = _validate_source(LS_MODEL_SOURCE)

    assert result.ok is True
    assert result.errors == []
    assert result.output_shape == [2, 3, 1, 8, 16]


def test_unknown_auxiliary_input_is_rejected():
    result = _validate_source(
        LS_MODEL_SOURCE.replace('"ls": {', '"season": {', 1)
    )

    assert result.ok is False
    assert any("auxiliary" in error.lower() and "only ls" in error for error in result.errors)


def test_malformed_ls_auxiliary_input_is_rejected_before_dry_run():
    result = _validate_source(
        LS_MODEL_SOURCE.replace('"unit": "degree"', '"unit": "radian"', 1)
    )

    assert result.ok is False
    assert any("auxiliary_inputs.ls" in error for error in result.errors)


def test_disallowed_import_fails_before_import():
    result = _validate_source(
        VALID_MODEL_SOURCE.replace("import torch", "import os\nimport torch", 1)
    )

    assert result.ok is False
    assert any("Disallowed import: os" in error for error in result.errors)


def test_missing_model_spec_fails():
    result = _validate_source(VALID_MODEL_SOURCE.replace("MODEL_SPEC =", "MISSING_SPEC =", 1))

    assert result.ok is False
    assert any("MODEL_SPEC" in error for error in result.errors)


def test_bad_output_shape_fails():
    result = _validate_source(
        VALID_MODEL_SOURCE.replace(
            "return last.unsqueeze(1).repeat(1, self.horizon, 1, 1, 1)",
            "return last",
            1,
        )
    )

    assert result.ok is False
    assert any("output shape" in error for error in result.errors)


def test_invalid_numeric_param_schema_fails():
    result = _validate_source(
        VALID_MODEL_SOURCE.replace(
            '"min": 1,\n            "max": 32,',
            '"min": 64,\n            "max": 32,',
            1,
        )
    )

    assert result.ok is False
    assert any("hidden_dim" in error for error in result.errors)


def test_invalid_parameter_name_fails():
    result = _validate_source(
        VALID_MODEL_SOURCE.replace('"hidden_dim": {', '"bad-name": {', 1)
    )

    assert result.ok is False
    assert any(
        "Invalid parameter name" in error or "bad-name" in error
        for error in result.errors
    )


def test_keyword_parameter_name_fails():
    result = _validate_source(
        VALID_MODEL_SOURCE.replace('"hidden_dim": {', '"class": {', 1)
    )

    assert result.ok is False
    assert any(
        "Invalid parameter name" in error or "class" in error
        for error in result.errors
    )


def test_select_options_must_be_strings():
    result = _validate_source(
        VALID_MODEL_SOURCE.replace(
            '"options": ["relu", "gelu"]',
            '"options": ["relu", 3]',
            1,
        )
    )

    assert result.ok is False
    assert any(
        "activation" in error or "select" in error or "options" in error
        for error in result.errors
    )


def test_select_options_must_be_non_empty_strings():
    result = _validate_source(
        VALID_MODEL_SOURCE.replace(
            '"default": "relu",\n            "options": ["relu", "gelu"]',
            '"default": "",\n            "options": [""]',
            1,
        )
    )

    assert result.ok is False
    assert any(
        "activation" in error or "select" in error or "options" in error
        for error in result.errors
    )


def test_forward_timeout_fails():
    result = _validate_source_with_validator(
        VALID_MODEL_SOURCE.replace(
            "return last.unsqueeze(1).repeat(1, self.horizon, 1, 1, 1)",
            "while True:\n            pass",
            1,
        ),
        UserModelValidator(timeout_seconds=0.5),
    )

    assert result.ok is False
    assert any(
        "timeout" in error.lower() or "timed out" in error.lower()
        for error in result.errors
    )


if __name__ == "__main__":
    test_valid_model_passes_and_reports_metadata()
    test_disallowed_import_fails_before_import()
    test_missing_model_spec_fails()
    test_bad_output_shape_fails()
    test_invalid_numeric_param_schema_fails()
    test_invalid_parameter_name_fails()
    test_keyword_parameter_name_fails()
    test_select_options_must_be_strings()
    test_select_options_must_be_non_empty_strings()
    test_forward_timeout_fails()
    print("user model validator tests passed")
