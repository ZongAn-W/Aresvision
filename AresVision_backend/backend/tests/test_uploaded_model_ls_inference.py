import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import torch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services import inference_service as inference_module  # noqa: E402
from services.inference_service import InferenceService  # noqa: E402
from training_backbones import user_model_runner  # noqa: E402
from training_backbones.uploaded_model_contract import (  # noqa: E402
    attach_uploaded_model_contract,
)


LS_MODEL_SPEC = {
    "name": "InferenceLsModel",
    "auxiliary_inputs": {
        "ls": {
            "required": True,
            "shape": ["batch", "window"],
            "dtype": "float32",
            "unit": "degree",
        }
    },
}

LS_TOPOGRAPHY_MODEL_SPEC = {
    "name": "InferenceLsTopographyModel",
    "auxiliary_inputs": {
        **LS_MODEL_SPEC["auxiliary_inputs"],
        "topography": {
            "required": True,
            "shape": ["batch", 1, "height", "width"],
            "dtype": "float32",
            "unit": "meter",
        },
    },
}


class RecordingLsModel(torch.nn.Module):
    def __init__(self, horizon):
        super().__init__()
        self.horizon = horizon
        self.ls_calls = []

    def forward(self, x, ls):
        self.ls_calls.append(ls.detach().cpu().clone())
        return x[:, -1:, :1].repeat(1, self.horizon, 1, 1, 1)


class RecordingLsTopographyModel(RecordingLsModel):
    def __init__(self, horizon):
        super().__init__(horizon)
        self.topography_calls = []

    def forward(self, x, ls, topography):
        self.ls_calls.append(ls.detach().cpu().clone())
        self.topography_calls.append(topography.detach().cpu().clone())
        return x[:, -1:, :1].repeat(1, self.horizon, 1, 1, 1)


def _setup_uploaded_inference(monkeypatch, *, with_topography=False):
    window = 4
    horizon = 2
    x = torch.arange(10 * window * 4, dtype=torch.float32).reshape(10, window, 1, 2, 2)
    y = torch.zeros(10, horizon, 1, 2, 2)
    ls = torch.arange(10 * window, dtype=torch.float32).reshape(10, window)
    if with_topography:
        model = attach_uploaded_model_contract(
            RecordingLsTopographyModel(horizon),
            LS_TOPOGRAPHY_MODEL_SPEC,
        )
    else:
        model = attach_uploaded_model_contract(RecordingLsModel(horizon), LS_MODEL_SPEC)
    prepare_calls = []
    topography_calls = []
    latitude = torch.tensor([45.0, -45.0]).numpy()
    longitude = torch.tensor([-180.0, -90.0, 0.0, 90.0]).numpy()
    static_topography = torch.arange(4, dtype=torch.float32).reshape(1, 2, 2)

    def fake_prepare_tensors(*args, **kwargs):
        assert kwargs.get("return_ls") is True
        assert kwargs.get("return_coordinates") is True
        assert kwargs.get("require_coordinates") is False
        prepare_calls.append((args, kwargs))
        return x, y, ls, 0.0, 1.0, 2, 2, latitude, longitude

    def fake_prepare_topography(target_latitude, target_longitude, **kwargs):
        topography_calls.append((target_latitude, target_longitude))
        return static_topography

    monkeypatch.setattr(user_model_runner, "prepare_tensors", fake_prepare_tensors)
    monkeypatch.setattr(user_model_runner, "load_uploaded_model", lambda path, config: model)
    monkeypatch.setattr(
        inference_module,
        "prepare_topography_grid",
        fake_prepare_topography,
        raising=False,
    )

    service = InferenceService.__new__(InferenceService)
    service.device = torch.device("cpu")
    service.openmars_dir = Path("unused-openmars")
    service.mcd_dir = Path("unused-mcd")
    service._load_task_state_dict = lambda task: {}

    task = SimpleNamespace(metrics="{}")
    hypers = {
        "window": window,
        "horizon": horizon,
        "batch_size": 16,
        "selected_channels": [],
        "custom_model_params": {},
        "_uploaded_model_param_schema": {},
        "_uploaded_model_path": "unused.source",
    }
    return (
        service,
        task,
        hypers,
        model,
        ls,
        prepare_calls,
        static_topography,
        topography_calls,
    )


def test_uploaded_formal_prediction_receives_selected_history_ls(monkeypatch):
    service, task, hypers, model, ls, *_rest = _setup_uploaded_inference(monkeypatch)

    service._predict_uploaded_task_window(task, hypers, ls_start=0.0, horizon=2)

    assert torch.equal(model.ls_calls[-1], ls[0:1])


def test_uploaded_test_set_metrics_receives_matching_ls_batches(monkeypatch):
    service, task, hypers, model, ls, *_rest = _setup_uploaded_inference(monkeypatch)

    service._uploaded_task_test_set_arrays(task, hypers, horizon=2)

    assert torch.equal(model.ls_calls[-1], ls[8:10])


def test_uploaded_permutation_importance_keeps_history_ls_fixed(monkeypatch):
    service, task, hypers, model, ls, *_rest = _setup_uploaded_inference(monkeypatch)

    service._uploaded_task_permutation_importance(
        task,
        hypers,
        selected_variables=["Ozone"],
        horizon=2,
    )

    assert len(model.ls_calls) >= 2
    assert all(torch.equal(call, ls[8:10]) for call in model.ls_calls)


def test_uploaded_test_results_receive_matching_ls(monkeypatch):
    service, task, hypers, model, ls, *_rest = _setup_uploaded_inference(monkeypatch)

    asyncio.run(service._get_uploaded_model_test_results(task, hypers))

    assert torch.equal(model.ls_calls[-1], ls[8:10])


def test_all_uploaded_inference_paths_reuse_persisted_training_dataset(monkeypatch):
    service, task, hypers, _model, _ls, prepare_calls, *_rest = _setup_uploaded_inference(monkeypatch)
    hypers["training_dataset"] = "mcd_overview"
    data_dirs = {"MCD_RAW_3H_DIR": "persisted-mcd-overview"}

    service._predict_uploaded_task_window(task, hypers, ls_start=0.0, horizon=2, data_dirs=data_dirs)
    service._uploaded_task_test_set_arrays(task, hypers, horizon=2, data_dirs=data_dirs)
    service._uploaded_task_permutation_importance(
        task,
        hypers,
        selected_variables=["Ozone"],
        horizon=2,
        data_dirs=data_dirs,
    )
    asyncio.run(service._get_uploaded_model_test_results(task, hypers, data_dirs=data_dirs))

    assert len(prepare_calls) == 4
    for _args, kwargs in prepare_calls:
        assert kwargs["training_dataset"] == "mcd_overview"
        assert kwargs["mcd_overview_dir"] == Path("persisted-mcd-overview")


def test_all_uploaded_inference_paths_receive_static_topography(monkeypatch):
    (
        service,
        task,
        hypers,
        model,
        ls,
        _prepare_calls,
        static_topography,
        topography_preparations,
    ) = _setup_uploaded_inference(monkeypatch, with_topography=True)

    service._predict_uploaded_task_window(task, hypers, ls_start=0.0, horizon=2)
    service._uploaded_task_test_set_arrays(task, hypers, horizon=2)
    service._uploaded_task_permutation_importance(
        task,
        hypers,
        selected_variables=["Ozone"],
        horizon=2,
    )
    asyncio.run(service._get_uploaded_model_test_results(task, hypers))

    assert len(topography_preparations) == 4
    assert len(model.topography_calls) >= 5
    assert all(
        call.shape[1:] == (1, 2, 2) for call in model.topography_calls
    )
    assert all(
        torch.equal(call[0], static_topography) for call in model.topography_calls
    )
    permutation_ls_calls = model.ls_calls[2:-1]
    permutation_topography_calls = model.topography_calls[2:-1]
    assert len(permutation_ls_calls) >= 2
    assert all(torch.equal(call, ls[8:10]) for call in permutation_ls_calls)
    assert all(
        torch.equal(call, permutation_topography_calls[0])
        for call in permutation_topography_calls
    )


def test_ls_only_inference_does_not_prepare_mola(monkeypatch):
    service, task, hypers, _model, _ls, _prepare, _static, topography_calls = (
        _setup_uploaded_inference(monkeypatch)
    )

    service._predict_uploaded_task_window(task, hypers, ls_start=0.0, horizon=2)

    assert topography_calls == []
