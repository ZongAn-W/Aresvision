"""Contract tests for the read-only dataset catalog API."""

import json
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routers.datasets import router  # noqa: E402
from services.dataset_registry import EXPECTED_DATA_SHA256, EXPECTED_MANIFEST_SHA256, DatasetRegistry  # noqa: E402

DATASET_ORDER = ["openmars_mcd", "mcd_overview", "earth_merra2_daily_v1", "earth_merra2_daily_v2"]


def build_client(**registry_kwargs):
    app = FastAPI()
    app.state.dataset_registry = DatasetRegistry(**registry_kwargs)
    app.include_router(router, prefix="/api")
    return TestClient(app)


def test_registry_never_returns_the_package_directory(earth_release, tmp_path):
    client = build_client(**earth_release)
    with client:
        body = client.get("/api/datasets").text
        detail = client.get("/api/datasets/earth_merra2_daily_v1").text

    package_dir = str(Path(earth_release["earth_package_dir"]))
    for payload in (body, detail):
        assert package_dir not in payload
        assert "earth_package_dir" not in payload
        assert "data/earth" not in payload


def test_earth_release_is_described_from_real_metadata(earth_release):
    client = build_client(**earth_release)
    with client:
        response = client.get("/api/datasets")
        assert response.status_code == 200
        items = response.json()["items"]
        assert [item["dataset_id"] for item in items] == DATASET_ORDER

        result = client.get("/api/datasets/earth_merra2_daily_v1").json()

    assert result["dataset_id"] == "earth_merra2_daily_v1"
    assert result["planet"] == "earth"
    assert result["dataset_version"] == "v1"
    assert result["schema"] == "aresvision_earth_daily_v1"
    assert result["availability"] == "available"
    assert result["availability_reason"] is None
    assert result["manifest_sha256"] == earth_release["expected_manifest_sha256"]
    assert result["data_sha256"] == earth_release["expected_data_sha256"]
    assert len(result["dataset_fingerprint"]) == 64
    assert result["capabilities"] == {
        "metadata": True,
        "web_overview": True,
        "training": False,
        "trained_prediction": False,
    }
    assert result["time"]["kind"] == "date"
    assert result["time"]["calendar"] == "proleptic_gregorian"
    assert result["time"]["start"] == "2020-01-01"
    assert result["time"]["end"] == "2021-12-31"
    assert result["time"]["count"] == 731
    assert result["time"]["step"] == 1
    assert result["time"]["step_unit"] == "day"
    assert result["grid"]["shape"] == [31, 49]
    assert result["grid"]["dimension_order"] == ["lat", "lon"]
    assert result["grid"]["latitude_step"] == 4.0
    assert result["grid"]["longitude_step"] == 5.0
    assert result["grid"]["coverage"] == "regional"
    assert result["grid"]["wrap_longitude"] is False
    assert len(result["grid"]["latitude_values"]) == 31
    assert len(result["grid"]["longitude_values"]) == 49
    assert result["channel_order"] == ["TO3", "U10M", "V10M", "T2M", "SWGDN"]
    assert result["variables"][0]["units"] == "DU"
    assert result["variables"][0]["role"] == "target_and_input"
    assert result["splits"]["train"] == {"start": "2020-01-01", "end": "2020-12-31", "days": 366}
    assert result["splits"]["validation"]["days"] == 181
    assert result["splits"]["test"]["days"] == 184
    assert result["limitations"]


def test_mars_entries_report_unverified_identity_without_inventing_versions(earth_release):
    client = build_client(**earth_release)
    with client:
        items = client.get("/api/datasets").json()["items"]

    for item in items[:2]:
        assert item["planet"] == "mars"
        assert item["dataset_version"] is None
        assert item["availability"] == "unverified"
        assert item["availability_reason"] == "legacy_dataset_not_probed"
        assert item["manifest_sha256"] is None
        assert item["data_sha256"] is None
        assert item["dataset_fingerprint"] is None
        assert item["grid"] is None
        assert item["splits"] is None
        assert item["channel_order"] == []
        assert item["variables"] == []
        assert item["time"] == {
            "kind": "mars_ls", "calendar": None, "start": None, "end": None,
            "count": None, "step": None, "step_unit": None,
        }
        assert item["capabilities"] == {
            "metadata": True,
            "training": True,
            "web_overview": False,
            "trained_prediction": True,
        }


def test_missing_earth_package_keeps_the_catalog_usable(tmp_path):
    client = build_client(
        earth_package_dir=tmp_path / "absent",
        expected_manifest_sha256=EXPECTED_MANIFEST_SHA256,
        expected_data_sha256=EXPECTED_DATA_SHA256,
    )
    with client:
        response = client.get("/api/datasets")
        assert response.status_code == 200
        items = response.json()["items"]
        assert [item["dataset_id"] for item in items] == DATASET_ORDER
        earth = items[2]
        assert earth["availability"] == "missing"
        assert earth["availability_reason"] == "package_missing"
        assert earth["dataset_fingerprint"] is None
        assert earth["time"]["kind"] == "date"
        assert earth["time"]["count"] is None
        assert earth["grid"] is None
        # The overview entry is wired even while the package is missing; the
        # data endpoints answer 503 until the release is present again.
        assert earth["capabilities"] == {
            "metadata": True,
            "web_overview": True,
            "training": False,
            "trained_prediction": False,
        }

        detail = client.get("/api/datasets/earth_merra2_daily_v1")
        assert detail.status_code == 200
        assert detail.json()["availability"] == "missing"


def test_corrupted_earth_package_is_invalid_not_missing(earth_release, tmp_path):
    import shutil

    from services.earth_dataset_metadata import DATA_FILE_NAME

    destination = tmp_path / "broken"
    destination.mkdir()
    for name in (DATA_FILE_NAME, "manifest.json"):
        shutil.copy2(Path(earth_release["earth_package_dir"]) / name, destination / name)
    (destination / "manifest.json").write_text(json.dumps({"data_file": DATA_FILE_NAME}), encoding="utf-8")

    client = build_client(
        earth_package_dir=destination,
        expected_manifest_sha256=earth_release["expected_manifest_sha256"],
        expected_data_sha256=earth_release["expected_data_sha256"],
    )
    with client:
        earth = client.get("/api/datasets/earth_merra2_daily_v1").json()

    assert earth["availability"] == "invalid"
    assert earth["availability_reason"] == "manifest_fingerprint_mismatch"
    assert earth["dataset_fingerprint"] is None
    assert earth["capabilities"]["training"] is False


def test_changed_data_file_stops_reporting_available(earth_release, tmp_path):
    import shutil

    from services.earth_dataset_metadata import DATA_FILE_NAME

    destination = tmp_path / "changed"
    destination.mkdir()
    for name in (DATA_FILE_NAME, "manifest.json"):
        shutil.copy2(Path(earth_release["earth_package_dir"]) / name, destination / name)

    client = build_client(
        earth_package_dir=destination,
        expected_manifest_sha256=earth_release["expected_manifest_sha256"],
        expected_data_sha256=earth_release["expected_data_sha256"],
    )
    with client:
        assert client.get("/api/datasets/earth_merra2_daily_v1").json()["availability"] == "available"

        data_path = destination / DATA_FILE_NAME
        payload = bytearray(data_path.read_bytes())
        payload[-1] ^= 0xFF
        data_path.write_bytes(bytes(payload))

        refreshed = client.get("/api/datasets/earth_merra2_daily_v1").json()

    assert refreshed["availability"] == "invalid"
    assert refreshed["availability_reason"] == "data_fingerprint_mismatch"


def test_unknown_dataset_id_returns_404_with_a_stable_code(earth_release):
    client = build_client(**earth_release)
    with client:
        response = client.get("/api/datasets/missing")

    assert response.status_code == 404
    assert response.json()["detail"] == {
        "code": "unknown_dataset", "message": "Unknown dataset id",
    }


def test_repeated_and_parallel_queries_return_identical_results(earth_release):
    client = build_client(**earth_release)
    with client:
        first = client.get("/api/datasets").json()
        second = client.get("/api/datasets").json()
        detail = client.get("/api/datasets/earth_merra2_daily_v1").json()

    assert first == second
    assert first["items"][2] == detail


def test_callers_cannot_mutate_the_cached_descriptor(earth_release):
    registry = DatasetRegistry(**earth_release)
    first = registry.get_dataset("earth_merra2_daily_v1")
    first["grid"]["shape"][0] = 999
    first["limitations"].append("injected")
    first["capabilities"]["training"] = True

    second = registry.get_dataset("earth_merra2_daily_v1")
    assert second["grid"]["shape"] == [31, 49]
    assert "injected" not in second["limitations"]
    assert second["capabilities"]["training"] is False


def test_available_earth_does_not_claim_the_overview_is_unconnected(earth_release):
    """The catalog must not still advertise the 2D overview as unconnected."""
    client = build_client(**earth_release)
    with client:
        earth = client.get("/api/datasets/earth_merra2_daily_v1").json()

    assert earth["availability"] == "available"
    assert earth["capabilities"]["web_overview"] is True
    assert earth["capabilities"]["metadata"] is True
    # Training and prediction stay closed at this stage.
    assert earth["capabilities"]["training"] is False
    assert earth["capabilities"]["trained_prediction"] is False

    joined = " ".join(earth["limitations"]).lower()
    # The manifest's build-time note about the reader not being connected to the
    # registry must not survive; training/prediction remaining closed may.
    for stale in ("web overview", "reader is separate", "web/api dataset registry"):
        assert stale not in joined, stale
    assert any("training and prediction" in item.lower() for item in earth["limitations"])
    assert any("covered area" in item.lower() for item in earth["limitations"])
    # Physical data limitations from the manifest are preserved verbatim.
    assert any("regional" in item.lower() for item in earth["limitations"])


def test_openapi_exposes_both_dataset_routes(earth_release):
    app = FastAPI()
    app.state.dataset_registry = DatasetRegistry(**earth_release)
    app.include_router(router, prefix="/api")

    schema = app.openapi()
    assert "/api/datasets" in schema["paths"]
    assert "/api/datasets/{dataset_id}" in schema["paths"]
    assert "DatasetDescriptor" in schema["components"]["schemas"]
    assert "DatasetListResponse" in schema["components"]["schemas"]


def test_registry_construction_does_not_read_the_package(tmp_path):
    # Construction must stay cheap: no directory access at import/assembly time.
    missing = tmp_path / "never_created"
    registry = DatasetRegistry(
        missing,
        expected_manifest_sha256=EXPECTED_MANIFEST_SHA256,
        expected_data_sha256=EXPECTED_DATA_SHA256,
    )
    assert not missing.exists()
    assert registry.get_dataset("openmars_mcd")["availability"] == "unverified"


@pytest.mark.parametrize("dataset_id", ["openmars_mcd", "mcd_overview", "earth_merra2_daily_v1"])
def test_training_binding_is_rejected_for_earth_and_unversioned_for_mars(earth_release, dataset_id):
    from services.dataset_identity import DatasetRequestError

    registry = DatasetRegistry(**earth_release)
    if dataset_id == "earth_merra2_daily_v1":
        with pytest.raises(DatasetRequestError) as exc:
            registry.build_training_binding(dataset_id)
        assert exc.value.code == "dataset_training_not_supported"
        assert exc.value.status_code == 409
        return

    binding = registry.build_training_binding(dataset_id)
    assert binding["dataset_id"] == dataset_id
    assert binding["dataset_version"] is None
    assert binding["dataset_fingerprint"] is None
    assert binding["dataset_identity_status"] == "unversioned"
    assert json.loads(binding["dataset_snapshot"]) == {
        "dataset_id": dataset_id,
        "planet": "mars",
        "dataset_version": None,
        "binding_basis": "server_registry",
        "version_status": "unversioned",
    }
