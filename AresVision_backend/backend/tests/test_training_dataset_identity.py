"""Training request dataset identity: strict entry checks and persistence."""

import asyncio
import json
import sqlite3
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from schemas.training import TrainingStartRequest, TrainingTaskResponse  # noqa: E402
from services import training_service as training_module  # noqa: E402
from services.dataset_identity import DatasetRequestError  # noqa: E402
from services.dataset_registry import DatasetRegistry  # noqa: E402
from services.training_channels import build_hyperparameter_args  # noqa: E402

IDENTITY_FIELDS = (
    "dataset_id",
    "dataset_version",
    "dataset_fingerprint",
    "dataset_identity_status",
    "dataset_snapshot",
)

LEGACY_SCHEMA = """
CREATE TABLE model_training_tasks (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    model_script VARCHAR(255) NOT NULL,
    model_source VARCHAR(20) NOT NULL DEFAULT 'official',
    uploaded_model_id VARCHAR(36),
    uploaded_model_version INTEGER,
    hyperparameters TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    start_time DATETIME NOT NULL,
    end_time DATETIME,
    log_file_path VARCHAR(500),
    output_model_path VARCHAR(500),
    custom_model_name VARCHAR(255),
    pid INTEGER,
    metrics TEXT,
    progress FLOAT DEFAULT 0.0,
    current_epoch INTEGER DEFAULT 0,
    total_epochs INTEGER DEFAULT 0,
    current_loss FLOAT,
    eta VARCHAR(50),
    loss_history TEXT,
    dataset_id VARCHAR(80),
    dataset_version VARCHAR(40),
    dataset_fingerprint VARCHAR(64),
    dataset_identity_status VARCHAR(32),
    dataset_snapshot TEXT
)
"""


class _StubDataService:
    def get_available_years(self):
        return [27]


class RecordingTrainingService(training_module.TrainingService):
    """TrainingService whose subprocess launch is replaced by a recorder."""

    def __init__(self, sessions):
        self.calls = []
        self._sessions = sessions

    async def _run_training_subprocess(self, task_id, script_name, hyperparameters, log_file,
                                       output_path, env_overrides=None, temp_data_root=None):
        self.calls.append({
            "task_id": task_id,
            "script_name": script_name,
            "hyperparameters": dict(hyperparameters),
        })


def build_registry(tmp_path):
    return DatasetRegistry(
        tmp_path / "no_earth_package",
        expected_manifest_sha256="a" * 64,
        expected_data_sha256="b" * 64,
    )


def prepare_engine(tmp_path):
    db_path = tmp_path / "identity.db"
    connection = sqlite3.connect(db_path)
    try:
        connection.execute(LEGACY_SCHEMA)
        connection.commit()
    finally:
        connection.close()
    return create_async_engine(f"sqlite+aiosqlite:///{db_path}", future=True), db_path


def read_tasks(db_path):
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        return [
            dict(row)
            for row in connection.execute(
                "SELECT * FROM model_training_tasks ORDER BY id"
            ).fetchall()
        ]
    finally:
        connection.close()


def start_training(tmp_path, monkeypatch, *, hyperparameters, dataset_id=None, **overrides):
    """Start one training run against a throwaway SQLite database."""
    engine, db_path = prepare_engine(tmp_path)
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    service = RecordingTrainingService(sessions)
    monkeypatch.setattr(training_module, "async_session_maker", sessions)
    monkeypatch.setattr(
        training_module, "build_task_output_path",
        lambda task_id, name, results_dir=None: Path(tmp_path) / f"{task_id}_{name}.pth",
    )
    monkeypatch.setattr(training_module, "MODELS_DIR", _ExistingModelsDir())

    async def run():
        try:
            return await service.start_training(
                user_id=7,
                model_script="demo3.py",
                hyperparameters=hyperparameters,
                custom_model_name=overrides.pop("custom_model_name", "identity-case"),
                dataset_id=dataset_id,
                dataset_registry=build_registry(tmp_path),
                **overrides,
            )
        finally:
            await asyncio.sleep(0)

    try:
        task = asyncio.run(run())
    finally:
        asyncio.run(engine.dispose())
    return task, service, db_path


class _ExistingModelsDir:
    """Stands in for the training script directory without touching disk."""

    def __init__(self, name="demo3.py"):
        self._name = name

    def joinpath(self, name):
        return self

    def exists(self):
        return True

    def __truediv__(self, other):
        return self

    def __fspath__(self):
        return self._name


def test_start_request_accepts_top_level_dataset_id():
    request = TrainingStartRequest(
        model_script="demo3.py", model_name="with-dataset", dataset_id="mcd_overview",
    )
    assert request.dataset_id == "mcd_overview"
    assert request.hyperparameters == {}


@pytest.mark.parametrize("field", [
    "dataset_version", "dataset_fingerprint", "dataset_identity_status", "dataset_snapshot",
])
def test_start_request_rejects_client_supplied_identity_fields(field):
    with pytest.raises(Exception):
        TrainingStartRequest(
            model_script="demo3.py", model_name="forged", **{field: "forged-value"},
        )


def test_start_request_defers_nested_identity_rejection_to_the_service():
    """The schema keeps extra hyperparameter keys; the service resolver rejects them."""
    request = TrainingStartRequest(
        model_script="demo3.py",
        model_name="forged-nested",
        hyperparameters={"dataset_identity_status": "verified"},
    )
    assert request.hyperparameters == {"dataset_identity_status": "verified"}

    from services.dataset_identity import resolve_dataset_id

    with pytest.raises(DatasetRequestError) as exc:
        resolve_dataset_id(None, request.hyperparameters)
    assert exc.value.code == "client_identity_not_allowed"


@pytest.mark.parametrize("code,status,hyperparameters,dataset_id", [
    ("dataset_training_not_supported", 409, {}, "earth_merra2_daily_v1"),
    ("unknown_dataset", 400, {}, "missing"),
    ("invalid_dataset_id", 400, {}, ""),
    ("dataset_id_conflict", 400, {"training_dataset": "mcd_overview"}, "openmars_mcd"),
    ("client_identity_not_allowed", 400, {"dataset_fingerprint": "forged"}, None),
    ("unknown_dataset", 400, {"training_dataset": "missing"}, None),
])
def test_unsupported_datasets_are_rejected_before_any_side_effect(
    tmp_path, monkeypatch, code, status, hyperparameters, dataset_id,
):
    def forbidden_database():
        raise AssertionError("Database must not be touched")

    def forbidden_build(*args, **kwargs):
        raise AssertionError("Training subprocess must not be built")

    monkeypatch.setattr(training_module, "async_session_maker", forbidden_database)
    monkeypatch.setattr(training_module, "build_task_output_path", forbidden_build)

    async def run():
        with pytest.raises(DatasetRequestError) as exc:
            await training_module.TrainingService().start_training(
                user_id=7,
                model_script="demo3.py",
                hyperparameters=hyperparameters,
                custom_model_name="rejected-case",
                dataset_id=dataset_id,
                dataset_registry=build_registry(tmp_path),
            )
        return exc.value

    error = asyncio.run(run())
    assert error.code == code
    assert error.status_code == status


def test_earth_training_rejected_before_database(monkeypatch, tmp_path):
    def forbidden_database():
        raise AssertionError("Database must not be touched")

    monkeypatch.setattr(training_module, "async_session_maker", forbidden_database)

    async def run():
        with pytest.raises(DatasetRequestError) as exc:
            await training_module.TrainingService().start_training(
                user_id=7, model_script="demo3.py", hyperparameters={},
                custom_model_name="earth-blocked", dataset_id="earth_merra2_daily_v1",
                dataset_registry=build_registry(tmp_path),
            )
        assert exc.value.code == "dataset_training_not_supported"

    asyncio.run(run())


def test_uploaded_path_also_rejects_earth_before_loading_the_package(tmp_path, monkeypatch):
    class ForbiddenUserModelService:
        async def get_package_for_user(self, *args, **kwargs):
            raise AssertionError("Uploaded model package must not be loaded")

    async def run():
        with pytest.raises(DatasetRequestError) as exc:
            await training_module.TrainingService().start_training(
                user_id=7,
                model_script="demo3.py",
                hyperparameters={},
                custom_model_name="earth-uploaded",
                dataset_id="earth_merra2_daily_v1",
                model_source="uploaded",
                uploaded_model_id="4d24f680-5029-47d9-9890-a56a6247b20e",
                user_model_service=ForbiddenUserModelService(),
                dataset_registry=build_registry(tmp_path),
            )
        assert exc.value.code == "dataset_training_not_supported"

    asyncio.run(run())


def test_legacy_request_without_top_level_id_creates_a_mars_task(tmp_path, monkeypatch):
    task, service, db_path = start_training(
        tmp_path, monkeypatch,
        hyperparameters={"training_dataset": "mcd_overview", "epochs": 1},
        custom_model_name="legacy-request",
    )

    assert task.dataset_id == "mcd_overview"
    assert task.dataset_version is None
    assert task.dataset_fingerprint is None
    assert task.dataset_identity_status == "unversioned"
    assert json.loads(task.dataset_snapshot) == {
        "dataset_id": "mcd_overview",
        "planet": "mars",
        "dataset_version": None,
        "binding_basis": "server_registry",
        "version_status": "unversioned",
    }

    row = read_tasks(db_path)[0]
    assert row["dataset_id"] == "mcd_overview"
    assert row["dataset_identity_status"] == "unversioned"
    assert json.loads(row["hyperparameters"])["training_dataset"] == "mcd_overview"
    # The runner keeps receiving the legacy flag with the resolved id.
    assert service.calls[0]["hyperparameters"]["training_dataset"] == "mcd_overview"


def test_top_level_dataset_id_is_used_and_mirrored_to_the_runner(tmp_path, monkeypatch):
    _task, service, db_path = start_training(
        tmp_path, monkeypatch,
        hyperparameters={"epochs": 1},
        dataset_id="mcd_overview",
        custom_model_name="top-level",
    )

    row = read_tasks(db_path)[0]
    assert row["dataset_id"] == "mcd_overview"
    assert json.loads(row["hyperparameters"])["training_dataset"] == "mcd_overview"
    assert service.calls[0]["hyperparameters"]["training_dataset"] == "mcd_overview"


def test_default_request_records_openmars_mcd(tmp_path, monkeypatch):
    _task, service, db_path = start_training(
        tmp_path, monkeypatch,
        hyperparameters={"epochs": 1},
        custom_model_name="defaulted",
    )

    row = read_tasks(db_path)[0]
    assert row["dataset_id"] == "openmars_mcd"
    assert row["dataset_identity_status"] == "unversioned"
    assert service.calls[0]["hyperparameters"]["training_dataset"] == "openmars_mcd"


def test_uploaded_model_training_records_identity_without_touching_runner_args(tmp_path, monkeypatch):
    class FakePackage:
        id = "4d24f680-5029-47d9-9890-a56a6247b20e"
        user_id = 7
        version = 1
        validation_status = "valid"
        storage_path = "D:/tmp/model.py"
        param_schema = "{}"

    class FakeUserModelService:
        async def get_package_for_user(self, package_id, user_id):
            return FakePackage

    engine, db_path = prepare_engine(tmp_path)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    service = RecordingTrainingService(sessions)
    monkeypatch.setattr(training_module, "async_session_maker", sessions)
    monkeypatch.setattr(
        training_module, "build_task_output_path",
        lambda task_id, name, results_dir=None: Path(tmp_path) / f"{task_id}_{name}.pth",
    )

    async def run():
        return await service.start_training(
            user_id=7,
            model_script="demo3.py",
            hyperparameters={"epochs": 1},
            custom_model_name="uploaded-identity",
            model_source="uploaded",
            uploaded_model_id=FakePackage.id,
            user_model_service=FakeUserModelService(),
            dataset_id="mcd_overview",
            dataset_registry=build_registry(tmp_path),
        )

    try:
        task = asyncio.run(run())
    finally:
        asyncio.run(engine.dispose())

    assert task.model_script == "__user_model_runner__"
    assert task.dataset_id == "mcd_overview"
    row = read_tasks(db_path)[0]
    assert row["dataset_id"] == "mcd_overview"
    assert service.calls[0]["hyperparameters"]["training_dataset"] == "mcd_overview"


def test_identity_columns_never_become_cli_arguments(tmp_path, monkeypatch):
    """Identity lives in dedicated columns; only training_dataset reaches the CLI."""
    service = RecordingTrainingService(sessions=None)
    monkeypatch.setattr(training_module, "async_session_maker", _ForbiddenSessionMaker())
    monkeypatch.setattr(training_module, "MODELS_DIR", _ExistingModelsDir())

    # The service rejects the forged identity before any database work, so no
    # identity value can be persisted into hyperparameters in the first place.
    async def run():
        with pytest.raises(DatasetRequestError) as exc:
            await service.start_training(
                user_id=7, model_script="demo3.py",
                hyperparameters={"dataset_fingerprint": "a" * 64},
                custom_model_name="forged", dataset_registry=build_registry(tmp_path),
            )
        return exc.value

    assert asyncio.run(run()).code == "client_identity_not_allowed"

    # What the runner receives is the resolved legacy flag plus real model
    # parameters, and never a separate identity argument.
    args = build_hyperparameter_args({
        "training_dataset": "mcd_overview",
        "epochs": 1,
        "selected_channels": ["U", "T"],
        "model_source": "official",
    })
    assert args[:2] == ["--training_dataset", "mcd_overview"]
    for forbidden in (
        "--dataset_id", "--dataset_version", "--dataset_fingerprint",
        "--dataset_identity_status", "--dataset_snapshot",
    ):
        assert forbidden not in args


class _ForbiddenSessionMaker:
    def __call__(self):
        raise AssertionError("Database must not be touched")


# ── CLI entry points (T8) ──────────────────────────────────────────────

def _stub_namespace(**overrides):
    values = {
        "epochs": 1, "batch_size": 1, "learning_rate": 0.001, "window": 3, "horizon": 3,
        "early_stopping_patience": 0, "selected_channels": "", "training_dataset": "openmars_mcd",
        "seed": 11, "output_path": "D:/tmp/out.pth", "model_architecture": "predrnnv2",
        "use_sphere": "false", "stlstm_hidden_dims": "[64, 64, 64]",
        "transfer_learning": "false", "transfer_source_type": "", "transfer_load_mode": "strict",
        "freeze_mode": "none", "finetune_learning_rate": None,
        "uploaded_model_path": "D:/tmp/model.py", "uploaded_model_param_schema": "{}",
        "custom_model_params": "{}",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _patch_cli(monkeypatch, module, namespace):
    """Replace argparse with a stub that returns a fixed namespace."""

    class StubParser:
        def add_argument(self, *args, **kwargs):
            return None

        def parse_known_args(self, *args, **kwargs):
            return namespace, []

    monkeypatch.setattr(module.argparse, "ArgumentParser", lambda *a, **k: StubParser())


@pytest.mark.parametrize("dataset_id,code", [
    ("earth_merra2_daily_v1", "dataset_training_not_supported"),
    ("missing", "unknown_dataset"),
    ("", "invalid_dataset_id"),
])
def test_official_cli_rejects_bad_dataset_before_loading_data(monkeypatch, dataset_id, code):
    import importlib

    demo3 = importlib.import_module("models.training_scripts.demo3")
    loaded = []

    def forbidden_load(**kwargs):
        loaded.append(kwargs)
        raise AssertionError("Training data must not be loaded")

    monkeypatch.setattr(demo3, "_prepare_training_data", forbidden_load)
    _patch_cli(monkeypatch, demo3, _stub_namespace(training_dataset=dataset_id))

    with pytest.raises(DatasetRequestError) as exc:
        demo3.main()

    assert exc.value.code == code
    assert loaded == []


def test_official_cli_accepts_a_registered_mars_dataset(monkeypatch):
    import importlib

    demo3 = importlib.import_module("models.training_scripts.demo3")
    loaded = []

    def recording_load(**kwargs):
        loaded.append(kwargs)
        raise AssertionError("stop after data loading was attempted")

    monkeypatch.setattr(demo3, "_prepare_training_data", recording_load)
    _patch_cli(monkeypatch, demo3, _stub_namespace(training_dataset=" MCD_Overview "))

    with pytest.raises(AssertionError, match="stop after data loading"):
        demo3.main()

    assert loaded and loaded[0]["training_dataset"] == "mcd_overview"


@pytest.mark.parametrize("dataset_id,code", [
    ("earth_merra2_daily_v1", "dataset_training_not_supported"),
    ("missing", "unknown_dataset"),
])
def test_uploaded_runner_cli_rejects_bad_dataset_before_loading_data(monkeypatch, dataset_id, code):
    import importlib

    runner = importlib.import_module("training_backbones.user_model_runner")
    loaded = []

    def forbidden_prepare(*args, **kwargs):
        loaded.append((args, kwargs))
        raise AssertionError("Training data must not be loaded")

    monkeypatch.setattr(runner, "prepare_tensors", forbidden_prepare)
    _patch_cli(monkeypatch, runner, _stub_namespace(training_dataset=dataset_id))

    with pytest.raises(DatasetRequestError) as exc:
        runner.main()

    assert exc.value.code == code
    assert loaded == []


def test_uploaded_runner_cli_accepts_a_registered_mars_dataset(monkeypatch):
    import importlib

    runner = importlib.import_module("training_backbones.user_model_runner")
    loaded = []

    def recording_prepare(*args, **kwargs):
        loaded.append(kwargs)
        raise AssertionError("stop after data loading was attempted")

    monkeypatch.setattr(runner, "prepare_tensors", recording_prepare)
    _patch_cli(monkeypatch, runner, _stub_namespace(training_dataset="mcd_overview"))

    with pytest.raises(AssertionError, match="stop after data loading"):
        runner.main()

    assert loaded and loaded[0]["training_dataset"] == "mcd_overview"


def test_task_response_serializes_identity_and_decodes_snapshot():
    response = TrainingTaskResponse.model_validate(SimpleNamespace(
        id=1, model_script="demo3.py", model_source="official",
        uploaded_model_id=None, uploaded_model_version=None, status="completed",
        start_time="2026-01-01T00:00:00Z", end_time=None, hyperparameters="{}",
        log_file_path=None, output_model_path=None, custom_model_name="c",
        metrics=None, progress=100.0, current_epoch=1, total_epochs=1,
        current_loss=None, eta=None, loss_history=None,
        dataset_id="openmars_mcd", dataset_version=None, dataset_fingerprint=None,
        dataset_identity_status="unversioned",
        dataset_snapshot=json.dumps({"planet": "mars", "binding_basis": "server_registry"}),
    ))

    assert response.dataset_id == "openmars_mcd"
    assert response.dataset_snapshot == {"planet": "mars", "binding_basis": "server_registry"}


@pytest.mark.parametrize("stored", [None, "", "not-json", "[1, 2]", "7"])
def test_task_response_survives_missing_or_broken_snapshots(stored):
    response = TrainingTaskResponse.model_validate(SimpleNamespace(
        id=1, model_script="demo3.py", model_source="official",
        uploaded_model_id=None, uploaded_model_version=None, status="failed",
        start_time="2026-01-01T00:00:00Z", end_time=None, hyperparameters="{}",
        log_file_path=None, output_model_path=None, custom_model_name="c",
        metrics=None, progress=0.0, current_epoch=0, total_epochs=0,
        current_loss=None, eta=None, loss_history=None,
        dataset_id=None, dataset_version=None, dataset_fingerprint=None,
        dataset_identity_status=None, dataset_snapshot=stored,
    ))

    assert response.dataset_snapshot is None
    assert response.dataset_id is None


def test_start_route_maps_dataset_errors_to_the_declared_status():
    from routers import training as training_router

    class RejectingService:
        async def start_training(self, **kwargs):
            raise DatasetRequestError("unknown_dataset", "Unknown dataset id")

    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))
    req = SimpleNamespace(
        model_script="demo3.py", hyperparameters={}, model_name="route-case",
        data_source="default", model_source="official", uploaded_model_id=None,
        tag_ids=[], dataset_id="missing",
    )
    current_user = SimpleNamespace(id=7, role="user")
    original = training_router.training_service
    training_router.training_service = RejectingService()
    try:
        with pytest.raises(training_router.HTTPException) as exc:
            asyncio.run(training_router.start_training(req, request, current_user))
    finally:
        training_router.training_service = original

    assert exc.value.status_code == 400
    assert exc.value.detail == {"code": "unknown_dataset", "message": "Unknown dataset id"}


def test_start_route_passes_the_registry_from_app_state():
    from routers import training as training_router

    seen = {}

    class CapturingService:
        async def start_training(self, **kwargs):
            seen.update(kwargs)
            raise DatasetRequestError("dataset_training_not_supported", "nope", status_code=409)

    registry = object()
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(dataset_registry=registry)))
    req = SimpleNamespace(
        model_script="demo3.py", hyperparameters={}, model_name="route-case",
        data_source="default", model_source="official", uploaded_model_id=None,
        tag_ids=[], dataset_id="earth_merra2_daily_v1",
    )
    current_user = SimpleNamespace(id=7, role="user")
    original = training_router.training_service
    training_router.training_service = CapturingService()
    try:
        with pytest.raises(training_router.HTTPException) as exc:
            asyncio.run(training_router.start_training(req, request, current_user))
    finally:
        training_router.training_service = original

    assert seen["dataset_id"] == "earth_merra2_daily_v1"
    assert seen["dataset_registry"] is registry
    assert exc.value.status_code == 409


# ── HTTP integration: route -> service -> database ─────────────────────

def _build_http_app(tmp_path, monkeypatch):
    """Real training router over a throwaway SQLite database."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from auth import dependencies as auth_dependencies
    from auth.security import create_access_token
    from database import models
    from database.engine import Base
    from routers import training as training_router

    engine, db_path = prepare_engine(tmp_path)
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def setup():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with sessions() as session:
            session.add(models.User(
                id=7, email="identity@example.com", username="identity",
                password_hash="test", role="user",
            ))
            await session.commit()

    asyncio.run(setup())

    async def no_subprocess(self, *args, **kwargs):
        return None

    monkeypatch.setattr(training_module, "async_session_maker", sessions)
    monkeypatch.setattr(auth_dependencies, "async_session_maker", sessions)
    monkeypatch.setattr(training_module.TrainingService, "_run_training_subprocess", no_subprocess)
    monkeypatch.setattr(
        training_module, "build_task_output_path",
        lambda task_id, name, results_dir=None: Path(tmp_path) / f"{task_id}_{name}.pth",
    )

    app = FastAPI()
    app.state.dataset_registry = build_registry(tmp_path)
    app.include_router(training_router.router, prefix="/api")
    token = create_access_token({"sub": "7", "role": "user"})
    return TestClient(app), {"Authorization": f"Bearer {token}"}, db_path


def _training_payload(**overrides):
    payload = {
        "model_script": "demo3.py",
        "model_name": "http-identity-case",
        "hyperparameters": {"epochs": 1},
    }
    payload.update(overrides)
    return payload


def test_http_start_request_records_identity_and_keeps_legacy_key(tmp_path, monkeypatch):
    client, headers, db_path = _build_http_app(tmp_path, monkeypatch)
    with client:
        response = client.post(
            "/api/training/start", json=_training_payload(dataset_id="mcd_overview"), headers=headers,
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["dataset_id"] == "mcd_overview"
    assert body["dataset_version"] is None
    assert body["dataset_fingerprint"] is None
    assert body["dataset_identity_status"] == "unversioned"
    assert body["dataset_snapshot"]["binding_basis"] == "server_registry"
    assert body["dataset_snapshot"]["version_status"] == "unversioned"

    row = read_tasks(db_path)[0]
    assert json.loads(row["hyperparameters"])["training_dataset"] == "mcd_overview"


@pytest.mark.parametrize("payload,status,code", [
    ({"dataset_id": "earth_merra2_daily_v1"}, 409, "dataset_training_not_supported"),
    ({"dataset_id": "missing"}, 400, "unknown_dataset"),
    ({"dataset_id": ""}, 400, "invalid_dataset_id"),
    ({"dataset_id": "openmars_mcd", "hyperparameters": {"training_dataset": "mcd_overview"}},
     400, "dataset_id_conflict"),
])
def test_http_start_request_rejections_create_no_task(tmp_path, monkeypatch, payload, status, code):
    client, headers, db_path = _build_http_app(tmp_path, monkeypatch)
    with client:
        response = client.post(
            "/api/training/start", json=_training_payload(**payload), headers=headers,
        )

    assert response.status_code == status, response.text
    assert response.json()["detail"]["code"] == code
    assert read_tasks(db_path) == []


def test_http_start_request_rejects_forged_identity(tmp_path, monkeypatch):
    client, headers, db_path = _build_http_app(tmp_path, monkeypatch)
    with client:
        top_level = client.post(
            "/api/training/start",
            json=_training_payload(dataset_fingerprint="forged"),
            headers=headers,
        )
        nested = client.post(
            "/api/training/start",
            json=_training_payload(hyperparameters={"dataset_identity_status": "verified"}),
            headers=headers,
        )

    assert top_level.status_code == 422
    assert nested.status_code == 400
    assert nested.json()["detail"]["code"] == "client_identity_not_allowed"
    assert read_tasks(db_path) == []


def test_http_task_list_returns_identity_for_legacy_and_new_tasks(tmp_path, monkeypatch):
    client, headers, db_path = _build_http_app(tmp_path, monkeypatch)
    with client:
        created = client.post(
            "/api/training/start", json=_training_payload(dataset_id="mcd_overview"), headers=headers,
        )
        assert created.status_code == 200

        # A historical row with no identity at all must still serialize.
        connection = sqlite3.connect(db_path)
        try:
            connection.execute(
                "INSERT INTO model_training_tasks "
                "(user_id, model_script, hyperparameters, status, custom_model_name, start_time) "
                "VALUES (7, 'demo3.py', '{}', 'completed', 'legacy-row', '2026-01-01 00:00:00')"
            )
            connection.commit()
        finally:
            connection.close()

        listing = client.get("/api/training/tasks", headers=headers)

    assert listing.status_code == 200
    items = {item["custom_model_name"]: item for item in listing.json()}
    created_item = items["http-identity-case"]
    assert created_item["dataset_id"] == "mcd_overview"
    assert created_item["dataset_snapshot"]["planet"] == "mars"
    legacy_item = items["legacy-row"]
    assert legacy_item["dataset_id"] is None
    assert legacy_item["dataset_snapshot"] is None
    assert legacy_item["status"] == "completed"


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
