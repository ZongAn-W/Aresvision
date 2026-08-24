import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import torch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

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


class RecordingLsModel(torch.nn.Module):
    def __init__(self, horizon):
        super().__init__()
        self.horizon = horizon
        self.ls_calls = []

    def forward(self, x, ls):
        self.ls_calls.append(ls.detach().cpu().clone())
        return x[:, -1:, :1].repeat(1, self.horizon, 1, 1, 1)


def _setup_uploaded_inference(monkeypatch):
    window = 4
    horizon = 2
    x = torch.arange(10 * window * 4, dtype=torch.float32).reshape(10, window, 1, 2, 2)
    y = torch.zeros(10, horizon, 1, 2, 2)
    ls = torch.arange(10 * window, dtype=torch.float32).reshape(10, window)
    model = attach_uploaded_model_contract(RecordingLsModel(horizon), LS_MODEL_SPEC)
    prepare_calls = []

    def fake_prepare_tensors(*args, **kwargs):
        assert kwargs.get("return_ls") is True
        prepare_calls.append((args, kwargs))
        return x, y, ls, 0.0, 1.0, 2, 2

    monkeypatch.setattr(user_model_runner, "prepare_tensors", fake_prepare_tensors)
    monkeypatch.setattr(user_model_runner, "load_uploaded_model", lambda path, config: model)

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
    return service, task, hypers, model, ls, prepare_calls


def test_uploaded_formal_prediction_receives_selected_history_ls(monkeypatch):
    service, task, hypers, model, ls, _prepare_calls = _setup_uploaded_inference(monkeypatch)

    service._predict_uploaded_task_window(task, hypers, ls_start=0.0, horizon=2)

    assert torch.equal(model.ls_calls[-1], ls[0:1])


def test_uploaded_test_set_metrics_receives_matching_ls_batches(monkeypatch):
    service, task, hypers, model, ls, _prepare_calls = _setup_uploaded_inference(monkeypatch)

    service._uploaded_task_test_set_arrays(task, hypers, horizon=2)

    assert torch.equal(model.ls_calls[-1], ls[8:10])


def test_uploaded_permutation_importance_keeps_history_ls_fixed(monkeypatch):
    service, task, hypers, model, ls, _prepare_calls = _setup_uploaded_inference(monkeypatch)

    service._uploaded_task_permutation_importance(
        task,
        hypers,
        selected_variables=["Ozone"],
        horizon=2,
    )

    assert len(model.ls_calls) >= 2
    assert all(torch.equal(call, ls[8:10]) for call in model.ls_calls)


def test_uploaded_test_results_receive_matching_ls(monkeypatch):
    service, task, hypers, model, ls, _prepare_calls = _setup_uploaded_inference(monkeypatch)

    asyncio.run(service._get_uploaded_model_test_results(task, hypers))

    assert torch.equal(model.ls_calls[-1], ls[8:10])


def test_all_uploaded_inference_paths_reuse_persisted_training_dataset(monkeypatch):
    service, task, hypers, _model, _ls, prepare_calls = _setup_uploaded_inference(monkeypatch)
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
