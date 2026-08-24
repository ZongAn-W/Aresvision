import sys
import tempfile
import uuid
from pathlib import Path

import netCDF4
import numpy as np
import pytest
import torch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from training_backbones import user_model_runner as runner_module  # noqa: E402
from training_backbones.user_model_runner import (  # noqa: E402
    assert_prediction_shape,
    build_uploaded_model_config,
    load_uploaded_model,
    parse_json_arg,
    prepare_tensors,
)
from training_backbones.uploaded_model_contract import (  # noqa: E402
    attach_uploaded_model_contract,
    normalize_auxiliary_inputs,
    run_uploaded_model,
)


MODEL_SOURCE = """
from torch import nn
MODEL_SPEC = {"name":"RunnerTiny", "parameters":{"hidden_dim":{"type":"int","default":8,"min":4,"max":32}}}
class RunnerTiny(nn.Module):
    def __init__(self, horizon):
        super().__init__()
        self.horizon = horizon
    def forward(self, x):
        return x[:, -1:, :1].repeat(1, self.horizon, 1, 1, 1)
def build_model(config):
    return RunnerTiny(config["horizon"])
"""

LS_RUNNER_MODEL_SOURCE = """
from torch import nn
MODEL_SPEC = {
    "name": "RunnerLsTiny",
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
class RunnerLsTiny(nn.Module):
    def __init__(self, horizon):
        super().__init__()
        self.horizon = horizon
        self.received_ls = None
    def forward(self, x, ls):
        self.received_ls = ls
        return x[:, -1:, :1].repeat(1, self.horizon, 1, 1, 1)
def build_model(config):
    return RunnerLsTiny(config["horizon"])
"""

BAD_SHAPE_MODEL_SOURCE = """
from torch import nn
MODEL_SPEC = {"name":"BadShapeTiny", "parameters":{}}
class BadShapeTiny(nn.Module):
    def forward(self, x):
        return x[:, -1, 0]
def build_model(config):
    return BadShapeTiny()
"""

LS_MODEL_SPEC = {
    "name": "LsModel",
    "auxiliary_inputs": {
        "ls": {
            "required": True,
            "shape": ["batch", "window"],
            "dtype": "float32",
            "unit": "degree",
        }
    },
}


class _LegacyRecordingModel(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.argument_count = 0

    def forward(self, x):
        self.argument_count = 1
        return x[:, -1:, :1]


class _LsRecordingModel(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.received_ls = None

    def forward(self, x, ls):
        self.received_ls = ls
        return x[:, -1:, :1]


def test_legacy_uploaded_model_receives_only_x():
    model = attach_uploaded_model_contract(_LegacyRecordingModel(), {"name": "Legacy"})
    x = torch.zeros(2, 3, 1, 8, 16)

    run_uploaded_model(model, x, torch.ones(2, 3), context="legacy test")

    assert model.argument_count == 1


def test_ls_uploaded_model_receives_batch_window_tensor():
    model = attach_uploaded_model_contract(_LsRecordingModel(), LS_MODEL_SPEC)
    x = torch.zeros(2, 3, 1, 8, 16)
    ls = torch.tensor([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]])

    run_uploaded_model(model, x, ls, context="Ls test")

    assert torch.equal(model.received_ls, ls)


@pytest.mark.parametrize(
    ("auxiliary_inputs", "message"),
    [
        ({"season": {}}, "only ls"),
        ({"ls": None}, "must be a dict.*None"),
        ({"ls": {**LS_MODEL_SPEC["auxiliary_inputs"]["ls"], "required": False}}, "required.*got False"),
        ({"ls": {**LS_MODEL_SPEC["auxiliary_inputs"]["ls"], "required": 1}}, "required.*got 1.*int"),
        ({"ls": {**LS_MODEL_SPEC["auxiliary_inputs"]["ls"], "shape": ["batch", "horizon"]}}, "shape.*horizon"),
        ({"ls": {**LS_MODEL_SPEC["auxiliary_inputs"]["ls"], "dtype": "float64"}}, "dtype.*float64"),
        ({"ls": {**LS_MODEL_SPEC["auxiliary_inputs"]["ls"], "unit": "radian"}}, "unit.*radian"),
        ({"ls": {**LS_MODEL_SPEC["auxiliary_inputs"]["ls"], "extra": True}}, "unexpected fields.*extra"),
    ],
)
def test_auxiliary_input_metadata_is_strict(auxiliary_inputs, message):
    with pytest.raises(ValueError, match=message):
        normalize_auxiliary_inputs({"name": "Invalid", "auxiliary_inputs": auxiliary_inputs})


@pytest.mark.parametrize(
    ("ls", "message"),
    [
        (None, "requires Ls data"),
        ([[1.0, 2.0, 3.0]], "torch.Tensor"),
        (torch.ones(2, 3, dtype=torch.int64), "floating-point"),
        (torch.ones(2, 3, 1), "2D"),
        (torch.ones(2, 2), "shape mismatch"),
        (torch.tensor([[1.0, float("nan"), 3.0], [4.0, 5.0, 6.0]]), "finite"),
        (torch.tensor([[1.0, float("inf"), 3.0], [4.0, 5.0, 6.0]]), "finite"),
    ],
)
def test_required_ls_tensor_is_validated(ls, message):
    model = attach_uploaded_model_contract(_LsRecordingModel(), LS_MODEL_SPEC)
    x = torch.zeros(2, 3, 1, 8, 16)

    with pytest.raises(ValueError, match=message):
        run_uploaded_model(model, x, ls, context="validation test")


def test_uploaded_runner_uses_central_mcd_directory(tmp_path, monkeypatch):
    expected = tmp_path / "mcd"
    captured = {}

    class PreparationObserved(Exception):
        pass

    def capture_prepare_tensors(openmars_dir, mcd_dir, *args, **kwargs):
        captured["mcd_dir"] = mcd_dir
        raise PreparationObserved

    monkeypatch.setattr(runner_module, "MCD_DIR", expected)
    monkeypatch.setattr(runner_module, "prepare_tensors", capture_prepare_tensors)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            str(runner_module.__file__),
            "--output_path",
            str(tmp_path / "output.pth"),
            "--uploaded_model_path",
            str(tmp_path / "uploaded.py"),
        ],
    )

    with pytest.raises(PreparationObserved):
        runner_module.main()

    assert captured["mcd_dir"] == expected


def _write_overview_file(
    path: Path,
    offset: float,
    *,
    include_ls: bool = True,
    ls_count: int = 6,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with netCDF4.Dataset(str(path), "w", format="NETCDF4") as ds:
        ds.createDimension("time", 6)
        ds.createDimension("lat", 2)
        ds.createDimension("lon", 3)

        if include_ls:
            ls_dimension = "time"
            if ls_count != 6:
                ds.createDimension("ls_time", ls_count)
                ls_dimension = "ls_time"
            ds.createVariable("Ls", "f4", (ls_dimension,))[:] = np.linspace(
                offset,
                offset + float(ls_count - 1),
                ls_count,
                dtype=np.float32,
            ) % 360.0
        ds.createVariable("lat", "f4", ("lat",))[:] = np.array([-45.0, 45.0], dtype=np.float32)
        ds.createVariable("lon", "f4", ("lon",))[:] = np.array([0.0, 120.0, 240.0], dtype=np.float32)

        base = np.arange(36, dtype=np.float32).reshape(6, 2, 3) + offset
        for var_name, delta in {
            "o3col": 0.0,
            "U_Wind": 10.0,
            "V_Wind": 20.0,
            "Dust_Optical_Depth": 30.0,
            "Solar_Flux_DN": 40.0,
            "Temperature": 50.0,
        }.items():
            ds.createVariable(var_name, "f4", ("time", "lat", "lon"))[:] = base + delta


def _write_raw_3h_mcd_file(path: Path, offset: float) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with netCDF4.Dataset(str(path), "w", format="NETCDF4") as ds:
        ds.createDimension("time", 10)
        ds.createDimension("lat", 37)
        ds.createDimension("lon", 72)

        ds.createVariable("LS", "f4", ("time",))[:] = np.linspace(
            offset,
            offset + 1.0,
            10,
            dtype=np.float32,
        ) % 360.0
        ds.createVariable("lat", "f4", ("lat",))[:] = np.linspace(90.0, -90.0, 37, dtype=np.float32)
        ds.createVariable("lon", "f4", ("lon",))[:] = np.linspace(-180.0, 175.0, 72, dtype=np.float32)

        base = np.arange(10 * 37 * 72, dtype=np.float32).reshape(10, 37, 72) + offset
        for var_name, delta in {
            "O3COL": 0.0,
            "U": 10.0,
            "T": 20.0,
            "V": 30.0,
            "FSDS": 40.0,
        }.items():
            ds.createVariable(var_name, "f4", ("time", "lat", "lon"))[:] = base + delta
        ds["O3COL"].units = "um-atm"


def test_parse_json_arg_accepts_dict_json_string_and_empty_values():
    assert parse_json_arg({"hidden_dim": 16}) == {"hidden_dim": 16}
    assert parse_json_arg('{"hidden_dim":16}') == {"hidden_dim": 16}
    assert parse_json_arg("") == {}
    assert parse_json_arg(None) == {}


def test_build_uploaded_model_config_merges_core_custom_and_schema_defaults():
    config = build_uploaded_model_config(
        in_channels=3,
        window=4,
        horizon=5,
        height=8,
        width=16,
        selected_channels=["U", "T"],
        custom_model_params={"hidden_dim": 16},
        param_schema={
            "hidden_dim": {"type": "int", "default": 8},
            "dropout": {"type": "float", "default": 0.25},
        },
    )

    assert config == {
        "in_channels": 3,
        "window": 4,
        "horizon": 5,
        "height": 8,
        "width": 16,
        "selected_channels": ["U", "T"],
        "hidden_dim": 16,
        "dropout": 0.25,
    }


def test_load_uploaded_model_imports_build_model_and_returns_module():
    with tempfile.TemporaryDirectory() as temp_dir:
        model_path = Path(temp_dir) / "runner_tiny.py"
        model_path.write_text(MODEL_SOURCE, encoding="utf-8")
        config = build_uploaded_model_config(
            in_channels=3,
            window=3,
            horizon=3,
            height=8,
            width=16,
            selected_channels=["U", "V"],
            custom_model_params={},
            param_schema={"hidden_dim": {"type": "int", "default": 8}},
        )

        model = load_uploaded_model(model_path, config)
        output = model(torch.zeros(2, 3, 1, 8, 16))

    assert isinstance(model, torch.nn.Module)
    assert list(output.shape) == [2, 3, 1, 8, 16]


def test_load_uploaded_model_reads_python_source_from_non_py_storage_path():
    with tempfile.TemporaryDirectory() as temp_dir:
        model_path = Path(temp_dir) / "runner_tiny.py.user"
        model_path.write_text(MODEL_SOURCE, encoding="utf-8")
        config = build_uploaded_model_config(
            in_channels=3,
            window=3,
            horizon=3,
            height=8,
            width=16,
            selected_channels=["U", "V"],
            custom_model_params={},
            param_schema={"hidden_dim": {"type": "int", "default": 8}},
        )

        model = load_uploaded_model(model_path, config)
        output = model(torch.zeros(2, 3, 1, 8, 16))

    assert isinstance(model, torch.nn.Module)
    assert list(output.shape) == [2, 3, 1, 8, 16]


def test_load_uploaded_model_attaches_declared_ls_contract():
    with tempfile.TemporaryDirectory() as temp_dir:
        model_path = Path(temp_dir) / "model.py"
        model_path.write_text(LS_RUNNER_MODEL_SOURCE, encoding="utf-8")
        config = build_uploaded_model_config(
            in_channels=1,
            window=3,
            horizon=2,
            height=8,
            width=16,
            selected_channels=[],
            custom_model_params={},
            param_schema={},
        )
        model = load_uploaded_model(model_path, config)
        x = torch.zeros(2, 3, 1, 8, 16)
        ls = torch.tensor([[10.0, 11.0, 12.0], [20.0, 21.0, 22.0]])

        prediction = run_uploaded_model(model, x, ls, context="loaded model test")

        assert list(prediction.shape) == [2, 2, 1, 8, 16]
        assert torch.equal(model.received_ls, ls)


def test_split_train_test_carries_ls_only_when_available():
    x = torch.zeros(10, 3, 1, 2, 2)
    y = torch.zeros(10, 2, 1, 2, 2)
    ls = torch.arange(30, dtype=torch.float32).reshape(10, 3)

    train_with_ls, test_with_ls = runner_module._split_train_test(x, y, ls)
    train_legacy, test_legacy = runner_module._split_train_test(x, y)

    assert len(train_with_ls.tensors) == 3
    assert len(test_with_ls.tensors) == 3
    assert torch.equal(train_with_ls.tensors[1], ls[:8])
    assert len(train_legacy.tensors) == 2
    assert len(test_legacy.tensors) == 2


def test_forward_uploaded_batch_passes_ls_and_returns_device_target():
    model = attach_uploaded_model_contract(_LsRecordingModel(), LS_MODEL_SPEC)
    x = torch.zeros(2, 3, 1, 2, 2)
    ls = torch.tensor([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]])
    y = torch.zeros(2, 1, 1, 2, 2)

    prediction, target = runner_module._forward_uploaded_batch(
        model,
        (x, ls, y),
        torch.device("cpu"),
        "training test",
    )

    assert torch.equal(model.received_ls, ls)
    assert torch.equal(prediction, target)


def test_forward_uploaded_batch_keeps_legacy_model_single_input():
    model = attach_uploaded_model_contract(_LegacyRecordingModel(), {"name": "Legacy"})
    x = torch.zeros(2, 3, 1, 2, 2)
    y = torch.zeros(2, 1, 1, 2, 2)

    prediction, target = runner_module._forward_uploaded_batch(
        model,
        (x, y),
        torch.device("cpu"),
        "legacy training test",
    )

    assert model.argument_count == 1
    assert torch.equal(prediction, target)


def test_runner_main_passes_ls_through_training_validation_and_metrics(monkeypatch):
    workspace_tmp = BACKEND_DIR / ".test_tmp" / f"uploaded_runner_main_{uuid.uuid4().hex}"
    overview_dir = workspace_tmp / "mcd_overview"
    first_file = overview_dir / "MCD_MY24_overview.nc"
    second_file = overview_dir / "MCD_MY25_overview.nc"
    model_path = workspace_tmp / "ls_model.source"
    output_path = workspace_tmp / "trained.pth"
    _write_overview_file(first_file, 0.0)
    _write_overview_file(second_file, 10.0)
    model_path.write_text(LS_RUNNER_MODEL_SOURCE, encoding="utf-8")

    try:
        monkeypatch.setenv("MCD_RAW_3H_DIR", str(overview_dir))
        monkeypatch.setattr(sys, "dont_write_bytecode", True)
        monkeypatch.setattr(
            sys,
            "argv",
            [
                str(runner_module.__file__),
                "--epochs",
                "1",
                "--batch_size",
                "2",
                "--window",
                "3",
                "--horizon",
                "2",
                "--training_dataset",
                "mcd_overview",
                "--output_path",
                str(output_path),
                "--uploaded_model_path",
                str(model_path),
            ],
        )

        runner_module.main()

        assert output_path.is_file()
    finally:
        for file_path in (first_file, second_file, model_path, output_path):
            if file_path.exists():
                file_path.unlink()
        if overview_dir.exists():
            overview_dir.rmdir()
        if workspace_tmp.exists():
            workspace_tmp.rmdir()


def test_runner_main_trains_legacy_model_when_dataset_has_no_ls(monkeypatch):
    workspace_tmp = BACKEND_DIR / ".test_tmp" / f"uploaded_runner_legacy_{uuid.uuid4().hex}"
    overview_dir = workspace_tmp / "mcd_overview"
    data_file = overview_dir / "MCD_MY24_overview.nc"
    model_path = workspace_tmp / "legacy_model.source"
    output_path = workspace_tmp / "trained.pth"
    _write_overview_file(data_file, 0.0, include_ls=False)
    model_path.write_text(MODEL_SOURCE, encoding="utf-8")

    try:
        monkeypatch.setenv("MCD_RAW_3H_DIR", str(overview_dir))
        monkeypatch.setattr(sys, "dont_write_bytecode", True)
        monkeypatch.setattr(
            sys,
            "argv",
            [
                str(runner_module.__file__),
                "--epochs",
                "1",
                "--batch_size",
                "2",
                "--window",
                "2",
                "--horizon",
                "2",
                "--training_dataset",
                "mcd_overview",
                "--output_path",
                str(output_path),
                "--uploaded_model_path",
                str(model_path),
            ],
        )

        runner_module.main()

        assert output_path.is_file()
    finally:
        for file_path in (data_file, model_path, output_path):
            if file_path.exists():
                file_path.unlink()
        if overview_dir.exists():
            overview_dir.rmdir()
        if workspace_tmp.exists():
            workspace_tmp.rmdir()


def test_assert_prediction_shape_accepts_matching_shapes_and_rejects_mismatches():
    prediction = torch.zeros(2, 3, 1, 8, 16)
    target = torch.ones(2, 3, 1, 8, 16)
    assert_prediction_shape(prediction, target, "unit-test")

    try:
        assert_prediction_shape(torch.zeros(2, 1, 8, 16), target, "bad-batch")
    except ValueError as exc:
        message = str(exc)
        assert "bad-batch" in message
        assert "expected" in message
        assert "actual" in message
        assert "shape" in message
    else:
        raise AssertionError("mismatched prediction shape should raise ValueError")


def test_bad_shape_uploaded_model_is_caught_by_prediction_shape_guard():
    with tempfile.TemporaryDirectory() as temp_dir:
        model_path = Path(temp_dir) / "bad_shape_tiny.py"
        model_path.write_text(BAD_SHAPE_MODEL_SOURCE, encoding="utf-8")
        config = build_uploaded_model_config(
            in_channels=1,
            window=3,
            horizon=3,
            height=8,
            width=16,
            selected_channels=[],
            custom_model_params={},
            param_schema={},
        )

        model = load_uploaded_model(model_path, config)
        prediction = model(torch.zeros(2, 3, 1, 8, 16))
        target = torch.zeros(2, 3, 1, 8, 16)

    try:
        assert_prediction_shape(prediction, target, "bad-shape-forward")
    except ValueError as exc:
        message = str(exc)
        assert "bad-shape-forward" in message
        assert "expected" in message
        assert "actual" in message
    else:
        raise AssertionError("bad-shape uploaded model output should raise ValueError")


def test_prepare_tensors_builds_uploaded_runner_dataset_from_mcd_overview():
    workspace_tmp = BACKEND_DIR / ".test_tmp" / f"uploaded_runner_{uuid.uuid4().hex}"
    overview_dir = workspace_tmp / "mcd_overview"
    first_file = overview_dir / "MCD_MY24_overview.nc"
    second_file = overview_dir / "MCD_MY25_overview.nc"
    _write_overview_file(first_file, 0.0)
    _write_overview_file(second_file, 10.0)

    try:
        x_torch, y_torch, _y_mean, _y_std, height, width = prepare_tensors(
            workspace_tmp / "openmars",
            workspace_tmp / "MCD",
            ["U", "T"],
            window=2,
            horizon=2,
            training_dataset="mcd_overview",
            mcd_overview_dir=overview_dir,
        )
    finally:
        if first_file.exists():
            first_file.unlink()
        if second_file.exists():
            second_file.unlink()
        if overview_dir.exists():
            overview_dir.rmdir()
        if workspace_tmp.exists():
            workspace_tmp.rmdir()

    assert list(x_torch.shape) == [9, 2, 3, 2, 3]
    assert list(y_torch.shape) == [9, 2, 1, 2, 3]
    assert height == 2
    assert width == 3


def test_prepare_tensors_aligns_ls_to_history_when_window_differs_from_horizon():
    workspace_tmp = BACKEND_DIR / ".test_tmp" / f"uploaded_runner_ls_{uuid.uuid4().hex}"
    overview_dir = workspace_tmp / "mcd_overview"
    first_file = overview_dir / "MCD_MY24_overview.nc"
    second_file = overview_dir / "MCD_MY25_overview.nc"
    _write_overview_file(first_file, 0.0)
    _write_overview_file(second_file, 10.0)

    try:
        x_torch, y_torch, ls_torch, _y_mean, _y_std, _height, _width = prepare_tensors(
            workspace_tmp / "openmars",
            workspace_tmp / "MCD",
            [],
            window=3,
            horizon=2,
            training_dataset="mcd_overview",
            mcd_overview_dir=overview_dir,
            return_ls=True,
        )
    finally:
        if first_file.exists():
            first_file.unlink()
        if second_file.exists():
            second_file.unlink()
        if overview_dir.exists():
            overview_dir.rmdir()
        if workspace_tmp.exists():
            workspace_tmp.rmdir()

    assert list(x_torch.shape) == [8, 3, 1, 2, 3]
    assert list(y_torch.shape) == [8, 2, 1, 2, 3]
    assert list(ls_torch.shape) == [8, 3]
    assert torch.equal(ls_torch[0], torch.tensor([0.0, 1.0, 2.0]))


def test_prepare_tensors_does_not_fabricate_missing_ls_for_legacy_data():
    workspace_tmp = BACKEND_DIR / ".test_tmp" / f"uploaded_runner_no_ls_{uuid.uuid4().hex}"
    overview_dir = workspace_tmp / "mcd_overview"
    data_file = overview_dir / "MCD_MY24_overview.nc"
    _write_overview_file(data_file, 0.0, include_ls=False)

    try:
        x_torch, y_torch, ls_torch, _y_mean, _y_std, _height, _width = prepare_tensors(
            workspace_tmp / "openmars",
            workspace_tmp / "MCD",
            [],
            window=2,
            horizon=2,
            training_dataset="mcd_overview",
            mcd_overview_dir=overview_dir,
            return_ls=True,
        )
    finally:
        if data_file.exists():
            data_file.unlink()
        if overview_dir.exists():
            overview_dir.rmdir()
        if workspace_tmp.exists():
            workspace_tmp.rmdir()

    assert list(x_torch.shape) == [3, 2, 1, 2, 3]
    assert list(y_torch.shape) == [3, 2, 1, 2, 3]
    assert ls_torch is None


def test_prepare_tensors_rejects_partial_file_ls_as_unaligned_timeline():
    workspace_tmp = BACKEND_DIR / ".test_tmp" / f"uploaded_runner_short_ls_{uuid.uuid4().hex}"
    overview_dir = workspace_tmp / "mcd_overview"
    first_file = overview_dir / "MCD_MY24_overview.nc"
    second_file = overview_dir / "MCD_MY25_overview.nc"
    _write_overview_file(first_file, 0.0, ls_count=5)
    _write_overview_file(second_file, 10.0)

    try:
        x_torch, y_torch, ls_torch, _y_mean, _y_std, _height, _width = prepare_tensors(
            workspace_tmp / "openmars",
            workspace_tmp / "MCD",
            [],
            window=2,
            horizon=2,
            training_dataset="mcd_overview",
            mcd_overview_dir=overview_dir,
            return_ls=True,
        )
    finally:
        if first_file.exists():
            first_file.unlink()
        if second_file.exists():
            second_file.unlink()
        if overview_dir.exists():
            overview_dir.rmdir()
        if workspace_tmp.exists():
            workspace_tmp.rmdir()

    assert list(x_torch.shape) == [9, 2, 1, 2, 3]
    assert list(y_torch.shape) == [9, 2, 1, 2, 3]
    assert ls_torch is None


def test_required_ls_rejects_file_length_mismatch_with_file_context():
    workspace_tmp = BACKEND_DIR / ".test_tmp" / f"uploaded_runner_required_short_ls_{uuid.uuid4().hex}"
    overview_dir = workspace_tmp / "mcd_overview"
    data_file = overview_dir / "MCD_MY24_overview.nc"
    _write_overview_file(data_file, 0.0, ls_count=5)

    try:
        with pytest.raises(ValueError) as exc_info:
            runner_module._load_mcd_overview(overview_dir, [], require_ls=True)
    finally:
        if data_file.exists():
            data_file.unlink()
        if overview_dir.exists():
            overview_dir.rmdir()
        if workspace_tmp.exists():
            workspace_tmp.rmdir()

    message = str(exc_info.value)
    assert data_file.name in message
    assert "expected 6" in message
    assert "got 5" in message


@pytest.mark.parametrize("bad_value", [float("nan"), float("inf")])
def test_prepare_tensors_preserves_non_finite_ls_for_explicit_validation(bad_value):
    workspace_tmp = BACKEND_DIR / ".test_tmp" / f"uploaded_runner_non_finite_ls_{uuid.uuid4().hex}"
    overview_dir = workspace_tmp / "mcd_overview"
    data_file = overview_dir / "MCD_MY24_overview.nc"
    _write_overview_file(data_file, 0.0)
    with netCDF4.Dataset(str(data_file), "r+") as dataset:
        dataset.variables["Ls"][1] = bad_value

    try:
        x_torch, _y_torch, ls_torch, *_rest = prepare_tensors(
            workspace_tmp / "openmars",
            workspace_tmp / "MCD",
            [],
            window=2,
            horizon=2,
            training_dataset="mcd_overview",
            mcd_overview_dir=overview_dir,
            return_ls=True,
        )
        model = attach_uploaded_model_contract(_LsRecordingModel(), LS_MODEL_SPEC)
        with pytest.raises(ValueError, match="finite"):
            run_uploaded_model(model, x_torch, ls_torch, context="dataset Ls")
    finally:
        if data_file.exists():
            data_file.unlink()
        if overview_dir.exists():
            overview_dir.rmdir()
        if workspace_tmp.exists():
            workspace_tmp.rmdir()


def test_prepare_tensors_builds_uploaded_runner_dataset_from_raw_3h_mcd():
    workspace_tmp = BACKEND_DIR / ".test_tmp" / f"uploaded_runner_raw_{uuid.uuid4().hex}"
    raw_dir = workspace_tmp / "MCD_Output_global_10m_ls_lst"
    first_file = raw_dir / "MCD_MY24_global_3h_5deg_10m_ls_lst.nc"
    second_file = raw_dir / "MCD_MY25_global_3h_5deg_10m_ls_lst.nc"
    _write_raw_3h_mcd_file(first_file, 0.0)
    _write_raw_3h_mcd_file(second_file, 2.0)

    try:
        x_torch, y_torch, _y_mean, _y_std, height, width = prepare_tensors(
            workspace_tmp / "openmars",
            workspace_tmp / "MCD",
            ["U", "D", "T"],
            window=2,
            horizon=2,
            training_dataset="mcd_overview",
            mcd_overview_dir=raw_dir,
        )
    finally:
        if first_file.exists():
            first_file.unlink()
        if second_file.exists():
            second_file.unlink()
        if raw_dir.exists():
            raw_dir.rmdir()
        if workspace_tmp.exists():
            workspace_tmp.rmdir()

    assert list(x_torch.shape) == [17, 2, 4, 36, 72]
    assert list(y_torch.shape) == [17, 2, 1, 36, 72]
    assert height == 36
    assert width == 72


if __name__ == "__main__":
    test_parse_json_arg_accepts_dict_json_string_and_empty_values()
    test_build_uploaded_model_config_merges_core_custom_and_schema_defaults()
    test_load_uploaded_model_imports_build_model_and_returns_module()
    test_load_uploaded_model_reads_python_source_from_non_py_storage_path()
    test_assert_prediction_shape_accepts_matching_shapes_and_rejects_mismatches()
    test_bad_shape_uploaded_model_is_caught_by_prediction_shape_guard()
    test_prepare_tensors_builds_uploaded_runner_dataset_from_mcd_overview()
    test_prepare_tensors_builds_uploaded_runner_dataset_from_raw_3h_mcd()
    print("uploaded model runner tests passed")
