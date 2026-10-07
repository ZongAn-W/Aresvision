"""Runtime release checks use the builder's product without loading a full volume."""

from __future__ import annotations

import hashlib
import json
import shutil
from datetime import date, timedelta
from pathlib import Path

import netCDF4
import numpy as np
import pytest
import xarray as xr

from scripts.build_earth_merra2_3hourly import (
    DATA_FILE, DATASET_ID, SCHEMA, _new_output, canonical_json, dataset_fingerprint,
)
from services.dataset_identity import build_dataset_fingerprint
from services.earth_dataset import (
    CHANNELS, UNITS, THREE_HOURLY_TRAINING_PROFILE, EarthOzoneWindows,
    load_earth_dataset, release_date_index, validate_dataset,
)
from services.earth_dataset_metadata import (
    EarthPackageError, file_sha256, read_earth_3hourly_release,
    threehour_manifest_content_sha256,
)
from services.netcdf_read_lock import netcdf_read_lock


def make_threehour_release(root, *, days=2, missing=True):
    """Build a compressed exact-grid fixture; it does not require production raw files."""
    root.mkdir(parents=True, exist_ok=True)
    source_days = [date(2020, 1, 1) + timedelta(days=index) for index in range(days)]
    inventory = [
        {"date": day.isoformat(), "product": product,
         "path": f"{product}/{product}.{day:%Y%m%d}.nc4", "name": f"{product}.{day:%Y%m%d}.nc4",
         "bytes": 1, "mtime_ns": 1, "sha256": hashlib.sha256(f"{day}/{product}".encode()).hexdigest()}
        for day in source_days for product in ("slv", "rad")
    ]
    source_sha = hashlib.sha256(canonical_json(inventory)).hexdigest()
    data_path = root / DATA_FILE
    variables = {}
    total = days * 8 * 240 * 480
    with netcdf_read_lock():
        stored = _new_output(data_path, source_days, source_sha)
        try:
            for index, (name, unit) in enumerate(zip(CHANNELS, UNITS)):
                stored[name][:] = np.float32(index)
                stored[f"{name}_valid_mask"][:] = np.uint8(1)
                count = int(missing and name == "TO3")
                if count:
                    stored[name][0, 0, 0] = np.nan
                    stored[f"{name}_valid_mask"][0, 0, 0] = 0
                variables[name] = {
                    "units": unit, "dtype": "float32", "valid_mask": f"{name}_valid_mask",
                    "target_values": total, "target_missing": count, "missing_count": count,
                    "missing_rate": count / total, "min": float(index), "max": float(index),
                }
        finally:
            stored.close()
    final = source_days[-1].isoformat()
    manifest = {
        "schema": SCHEMA, "planet": "Earth", "dataset_id": DATASET_ID, "dataset_version": "v1",
        "data_file": DATA_FILE, "build_mode": "subset", "source_files": inventory,
        "source_sha256": source_sha,
        "source": {"date_start": "2020-01-01", "date_end": final, "daily_file_count": days,
                   "products": ["slv", "rad"], "excluded_products": ["chm"]},
        "dimensions": {"time": days * 8, "lat": 240, "lon": 480, "bounds": 2},
        "time_start": "2020-01-01T01:30:00Z", "time_end": f"{final}T22:30:00Z",
        "frequency_hours": 3, "step_unit": "hour", "step": 3, "time_zone": "UTC",
        "time_kind": "iso-datetime", "cadence": "3 hour mean", "grid_shape": [240, 480],
        "grid": {"latitude": {"start": -89.625, "end": 89.625, "step": .75, "count": 240},
                 "longitude": {"start": -179.625, "end": 179.625, "step": .75, "count": 480},
                 "latitude_bounds": [-90., 90.], "longitude_bounds": [-180., 180.]},
        "channel_order": list(CHANNELS), "variables": variables,
        "training_profile": dict(THREE_HOURLY_TRAINING_PROFILE),
        "processing": {"temporal_method": "mean_of_three_complete_hourly_samples",
                       "spatial_method": "spherical_area_weighted_overlap"},
        "time_rule": {"interval_start": "2020-01-01T00:00:00Z",
                      "interval_end_exclusive": f"{(source_days[-1] + timedelta(days=1)).isoformat()}T00:00:00Z"},
        "splits": {"train": {"start": "2020-01-01", "end": final, "days": days, "steps": days * 8},
                   "validation": {"start": None, "end": None, "days": 0, "steps": 0},
                   "test": {"start": None, "end": None, "days": 0, "steps": 0}},
        "limitations": ["Catalog fixture; fields are retained on disk"],
        "data_bytes": data_path.stat().st_size, "data_sha256": file_sha256(data_path),
    }
    write_manifest(root, manifest)
    return root


def write_manifest(root, manifest):
    manifest["dataset_fingerprint"] = dataset_fingerprint(manifest)
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


@pytest.fixture(scope="module")
def base_package(tmp_path_factory):
    return make_threehour_release(tmp_path_factory.mktemp("threehour_contract") / "base")


@pytest.fixture
def package(tmp_path, base_package):
    root = tmp_path / "release"
    shutil.copytree(base_package, root)
    return root


def republish(root):
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    manifest["data_bytes"] = (root / DATA_FILE).stat().st_size
    manifest["data_sha256"] = file_sha256(root / DATA_FILE)
    write_manifest(root, manifest)


def assert_reason(root, reason):
    with pytest.raises(EarthPackageError) as error:
        read_earth_3hourly_release(root)
    assert error.value.reason == reason


def test_metadata_datetime_profile_masks_and_identity(package):
    release = read_earth_3hourly_release(package)
    meta = release.metadata
    manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
    assert meta["dataset_fingerprint"] == manifest["dataset_fingerprint"]
    assert meta["manifest_content_sha256"] == threehour_manifest_content_sha256(manifest)
    assert meta["manifest_sha256"] == file_sha256(package / "manifest.json")
    assert meta["training_profile"] == THREE_HOURLY_TRAINING_PROFILE
    assert (meta["frequency_hours"], meta["step_unit"], meta["step"], meta["grid_shape"]) == (3, "hour", 3, [240, 480])
    assert meta["time"]["kind"] == "datetime"
    assert meta["time"]["start"] == "2020-01-01T01:30:00Z"
    assert meta["time"]["end"] == "2020-01-02T22:30:00Z"
    assert meta["time"]["count"] == 16
    np.testing.assert_array_equal(np.diff(release.dates), np.full(15, np.timedelta64(3, "h")))
    assert not release.dates.flags.writeable
    assert not release.latitude.flags.writeable
    assert not release.longitude.flags.writeable
    assert dict(release.fields) == {}
    assert meta["variables"][0]["missing_rate"] > 0
    assert meta["grid"]["coverage"] == "global" and meta["grid"]["wrap_longitude"] is True
    for daily_id in ("earth_merra2_daily_v1", "earth_merra2_daily_v2"):
        assert meta["dataset_fingerprint"] != build_dataset_fingerprint(
            daily_id, "v1", meta["manifest_content_sha256"], meta["data_sha256"])


def test_registration_does_not_load_volume_and_keeps_chunk_bound(package, monkeypatch):
    def reject_load(*args, **kwargs):
        raise AssertionError("full Dataset.load is forbidden for the three-hour release")
    monkeypatch.setattr(xr.Dataset, "load", reject_load)
    original = xr.DataArray.isel
    selections = []
    def capture(self, *args, **kwargs):
        selection = kwargs.get("time")
        if self.name in CHANNELS and isinstance(selection, slice):
            selections.append(selection.stop - selection.start)
        return original(self, *args, **kwargs)
    monkeypatch.setattr(xr.DataArray, "isel", capture)
    release = read_earth_3hourly_release(package)
    assert len(release.dates) == 16
    assert selections and max(selections) <= 8
    with load_earth_dataset(package / DATA_FILE) as ds:
        assert ds.TO3.shape == (16, 240, 480)
        assert np.isnan(ds.TO3.isel(time=0, lat=0, lon=0).item())
        assert ds.TO3.isel(time=0, lat=0, lon=1).item() == 0  # Measured zeros remain valid.


def test_daily_helpers_refuse_datetime_axis_without_truncating(package):
    release = read_earth_3hourly_release(package)
    with pytest.raises(ValueError, match="catalog-only"):
        release_date_index(release, "2020-01-01")
    with pytest.raises(ValueError, match="catalog-only"):
        EarthOzoneWindows.from_release(release)
    with pytest.raises(ValueError, match="requires a daily release"):
        EarthOzoneWindows(package / DATA_FILE)


@pytest.mark.parametrize("mutation", ["duplicate", "gap", "nat", "wrong_center", "time_bounds", "latitude", "longitude", "lat_bounds", "coordinate_units", "units", "missing_variable", "mask", "nan_mask", "zero_mask", "infinity", "sentinel", "split", "utc", "calendar"])
def test_invalid_scientific_contract_has_stable_reason(package, mutation):
    with netcdf_read_lock(), netCDF4.Dataset(package / DATA_FILE, "a") as ds:
        ds.set_auto_mask(False)
        if mutation == "duplicate":
            ds["time"][2] = ds["time"][1]
        elif mutation == "gap":
            ds["time"][2:] = ds["time"][2:] + 3
        elif mutation == "nat":
            ds["time"][2] = np.nan
        elif mutation == "wrong_center":
            ds["time"][:] = ds["time"][:] + .5
        elif mutation == "time_bounds":
            ds["time_bounds"][0, 0] = 1
        elif mutation in ("latitude", "longitude"):
            axis = "lat" if mutation == "latitude" else "lon"
            ds[axis][0] = ds[axis][0] + .1
        elif mutation == "lat_bounds":
            ds["lat_bounds"][0, 0] = -89.9
        elif mutation == "coordinate_units":
            ds["lat"].units = "radians"
        elif mutation == "units":
            ds["TO3"].units = "kg m-2"
        elif mutation == "missing_variable":
            ds.renameVariable("TO3", "unexpected_TO3")
        elif mutation == "mask":
            ds["TO3_valid_mask"][0, 0, 1] = 2
        elif mutation == "nan_mask":
            ds["TO3_valid_mask"][0, 0, 0] = 1
        elif mutation == "zero_mask":
            ds["TO3_valid_mask"][0, 0, 1] = 0
        elif mutation in ("infinity", "sentinel"):
            ds["TO3"][0, 0, 1] = np.inf if mutation == "infinity" else 1e15
        elif mutation == "split":
            ds["split"][0] = 2
        elif mutation == "utc":
            ds["time"].time_zone = "local"
        elif mutation == "calendar":
            ds["time"].calendar = "360_day"
    republish(package)
    assert_reason(package, "invalid_dataset")


@pytest.mark.parametrize("key,value", [
    ("frequency_hours", 24), ("grid_shape", [36, 72]), ("time_start", "2020-01-01"),
    ("training_profile", {"window": 7, "horizon": 3}), ("source_sha256", "f" * 64),
])
def test_manifest_claims_must_match_even_with_valid_fingerprint(package, key, value):
    manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
    manifest[key] = value
    write_manifest(package, manifest)
    assert_reason(package, "manifest_metadata_mismatch")


def test_manifest_missing_statistics_are_not_invented(package):
    manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
    manifest["variables"]["TO3"]["missing_count"] = 0
    write_manifest(package, manifest)
    assert_reason(package, "manifest_metadata_mismatch")


def test_manifest_source_pairs_must_be_complete(package):
    manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
    manifest["source_files"][1] = manifest["source_files"][0]
    write_manifest(package, manifest)
    assert_reason(package, "manifest_metadata_mismatch")


def test_netcdf_bytes_cannot_change_under_published_sha(package):
    with netcdf_read_lock(), netCDF4.Dataset(package / DATA_FILE, "a") as ds:
        ds["TO3"][1, 1, 1] = 42
    # Updating only the size gets past the size check, never past the original SHA.
    manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
    manifest["data_bytes"] = (package / DATA_FILE).stat().st_size
    write_manifest(package, manifest)
    assert_reason(package, "data_fingerprint_mismatch")


@pytest.mark.parametrize("mutation", ["identity", "fingerprint", "path", "json", "duplicate_key", "nan_json"])
def test_malformed_manifest_has_stable_status(package, mutation):
    path = package / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if mutation == "identity":
        manifest["dataset_id"] = "earth_merra2_daily_v2"
    elif mutation == "fingerprint":
        manifest["dataset_fingerprint"] = "0" * 64
    elif mutation == "path":
        manifest["data_file"] = "../earth_merra2_daily.nc"
    elif mutation == "json":
        path.write_text("[", encoding="utf-8")
    elif mutation == "duplicate_key":
        path.write_text('{"dataset_id":"x","dataset_id":"y"}', encoding="utf-8")
    elif mutation == "nan_json":
        path.write_text('{"bad":NaN}', encoding="utf-8")
    if mutation in ("identity", "fingerprint", "path"):
        path.write_text(json.dumps(manifest), encoding="utf-8")
    assert_reason(package, "manifest_fingerprint_mismatch" if mutation == "fingerprint" else "invalid_manifest")


def test_missing_package_is_stable_and_no_creation(tmp_path):
    path = tmp_path / "absent"
    assert_reason(path, "package_missing")
    assert not path.exists()


def test_manifest_formatting_does_not_change_product_fingerprint(package):
    first = read_earth_3hourly_release(package).metadata
    manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
    (package / "manifest.json").write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")
    second = read_earth_3hourly_release(package).metadata
    assert first["manifest_sha256"] != second["manifest_sha256"]
    assert first["manifest_content_sha256"] == second["manifest_content_sha256"]
    assert first["dataset_fingerprint"] == second["dataset_fingerprint"]


def test_package_change_during_verification_is_rejected(package, monkeypatch):
    import services.earth_dataset_metadata as metadata
    original = metadata.file_sha256
    def modify_manifest_after_read(path):
        result = original(path)
        with (package / "manifest.json").open("a", encoding="utf-8") as stream:
            stream.write("\n")
        return result
    monkeypatch.setattr(metadata, "file_sha256", modify_manifest_after_read)
    assert_reason(package, "package_changed_during_verification")


def test_unreadable_manifest_is_stable(package, monkeypatch):
    original = Path.read_bytes
    def deny_manifest(path):
        if path == package / "manifest.json":
            raise PermissionError("test fixture unreadable")
        return original(path)
    monkeypatch.setattr(Path, "read_bytes", deny_manifest)
    assert_reason(package, "package_unreadable")


@pytest.mark.parametrize("filename", ["manifest.json", DATA_FILE])
def test_unreadable_package_file_stat_is_stable(package, monkeypatch, filename):
    original = Path.is_file

    def deny_file_stat(path):
        if path == package / filename:
            raise PermissionError("test fixture stat denied")
        return original(path)

    monkeypatch.setattr(Path, "is_file", deny_file_stat)
    assert_reason(package, "package_unreadable")


def test_rehashed_non_netcdf_content_is_invalid_dataset(package):
    (package / DATA_FILE).write_bytes(b"corrupted NetCDF fixture")
    republish(package)
    assert_reason(package, "invalid_dataset")
