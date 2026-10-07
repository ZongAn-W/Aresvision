"""Scientific and publication-contract checks for the standalone 3-hour builder."""

from __future__ import annotations

import hashlib
import json
from datetime import date, timedelta
from pathlib import Path

import netCDF4
import numpy as np
import pytest

from scripts.build_earth_merra2_3hourly import (
    DATASET_ID,
    DATA_FILE,
    build_dataset,
    conservative_regrid,
    dataset_fingerprint,
    discover_source_files,
    target_grid,
    temporal_mean_three_hours,
    verify_existing_release,
)
from scripts.verify_earth_merra2_3hourly import verify_package


VARIABLE_UNITS = {
    "TO3": "Dobsons",
    "U10M": "m s-1",
    "V10M": "m s-1",
    "T2M": "K",
    "SWGDN": "W m-2",
}
SOURCE_LAT = np.arange(-90.0, 91.0, 30.0)
SOURCE_LON = np.arange(-180.0, 180.0, 30.0)


def make_source_archive(root: Path, *, bad: str | None = None) -> Path:
    """Seven small global source days with deliberately unequal hourly values."""
    for day_index in range(7):
        day = date(2020, 1, 1) + timedelta(days=day_index)
        for product, names in (
            ("slv", ("TO3", "U10M", "V10M", "T2M")),
            ("rad", ("SWGDN",)),
        ):
            if bad == "missing_pair" and day_index == 0 and product == "rad":
                continue
            directory = root / product
            directory.mkdir(parents=True, exist_ok=True)
            named_product = "rad" if bad == "wrong_product" and day_index == 0 and product == "slv" else product
            path = directory / f"MERRA2_400.tavg1_2d_{named_product}_Nx.{day:%Y%m%d}.nc4"
            with netCDF4.Dataset(path, "w") as source:
                time_count = 23 if bad == "incomplete_hours" and day_index == 0 and product == "slv" else 24
                source.createDimension("time", time_count)
                source.createDimension("lat", len(SOURCE_LAT))
                source.createDimension("lon", len(SOURCE_LON))
                time_var = source.createVariable("time", "f8", ("time",))
                time_var.units = f"hours since {day.isoformat()} 00:00:00"
                time_var.calendar = "standard"
                time_values = np.arange(time_count, dtype=np.float64) + 0.5
                if day_index == 0 and product == "slv":
                    if bad == "duplicate_hour":
                        time_values[2] = time_values[1]
                    elif bad == "offset_hour":
                        time_values += 0.5
                time_var[:] = time_values
                source.createVariable("lat", "f8", ("lat",))[:] = SOURCE_LAT
                source.createVariable("lon", "f8", ("lon",))[:] = SOURCE_LON
                hourly = np.repeat(np.arange(8) * 10.0, 3) + np.tile([1.0, 4.0, 13.0], 8)
                hourly += day_index * 100.0
                for name in names:
                    variable = source.createVariable(name, "f4", ("time", "lat", "lon"), fill_value=-9999.0)
                    variable.units = VARIABLE_UNITS[name]
                    variable[:] = hourly[:time_count, None, None] + list(VARIABLE_UNITS).index(name)
                    if day_index == 0 and name == "TO3":
                        if bad == "unit":
                            variable.units = "kg m-2"
                        elif bad == "missing":
                            variable[0, 3, 0] = -9999.0
                        elif bad == "nan":
                            variable[0, 3, 0] = np.nan
                if day_index == 0 and product == "rad" and bad == "mismatched_product_hours":
                    time_var[:] = time_values + 0.25
    return root


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_target_centres_cover_exact_global_cell_bounds():
    lat, lon = target_grid()
    assert (len(lat), len(lon)) == (240, 480)
    np.testing.assert_allclose(np.diff(lat), 0.75, rtol=0, atol=0)
    np.testing.assert_allclose(np.diff(lon), 0.75, rtol=0, atol=0)
    np.testing.assert_array_equal(lat[[0, -1]], [-89.625, 89.625])
    np.testing.assert_array_equal(lon[[0, -1]], [-179.625, 179.625])
    assert (lat[0] - 0.375, lat[-1] + 0.375) == (-90.0, 90.0)
    assert (lon[0] - 0.375, lon[-1] + 0.375) == (-180.0, 180.0)


def test_three_hours_are_a_true_mean_and_require_complete_support():
    hourly = np.array([[1.0, 0.0], [4.0, 0.0], [13.0, 0.0], [20.0, 2.0], [22.0, 4.0], [30.0, 6.0]])
    mean = temporal_mean_three_hours(hourly)
    np.testing.assert_allclose(mean, [[6.0, 0.0], [24.0, 4.0]])
    assert mean[0, 0] != hourly[0, 0]  # A stride of three would fail this check.
    valid = np.ones(hourly.shape, dtype=bool)
    valid[1, 0] = False
    incomplete = temporal_mean_three_hours(hourly, valid)
    assert np.isnan(incomplete[0, 0])
    assert incomplete[0, 1] == 0.0  # A measured zero remains a measured zero.
    np.testing.assert_allclose(incomplete[1], [24.0, 4.0])
    masked = np.ma.array(hourly, mask=~valid)
    np.testing.assert_allclose(temporal_mean_three_hours(masked), incomplete, equal_nan=True)
    with pytest.raises(ValueError, match="multiple of three"):
        temporal_mean_three_hours(hourly[:5])


def test_conservative_regrid_preserves_constants_and_spherical_global_mean():
    constant = conservative_regrid(np.full((7, 12), 7.0), SOURCE_LAT, SOURCE_LON)
    np.testing.assert_allclose(constant, 7.0, rtol=0, atol=2e-14)
    field = np.arange(7 * 12, dtype=np.float64).reshape(7, 12) ** 2
    mapped = conservative_regrid(field, SOURCE_LAT, SOURCE_LON)
    source_edges = np.r_[-90.0, (SOURCE_LAT[:-1] + SOURCE_LAT[1:]) / 2.0, 90.0]
    source_area = np.diff(np.sin(np.deg2rad(source_edges)))
    target_area = np.diff(np.sin(np.deg2rad(np.arange(241) * 0.75 - 90.0)))
    source_mean = np.sum(field * source_area[:, None]) / (2.0 * len(SOURCE_LON))
    target_mean = np.sum(mapped * target_area[:, None]) / (2.0 * 480)
    assert target_mean == pytest.approx(source_mean, rel=1e-12)


def test_periodic_native_seam_contributes_at_both_target_edges():
    seam = np.zeros((7, 12))
    seam[:, 0] = 1.0
    mapped = conservative_regrid(seam, SOURCE_LAT, SOURCE_LON)
    np.testing.assert_allclose(mapped[:, :20], 1.0)
    np.testing.assert_allclose(mapped[:, -20:], 1.0)
    np.testing.assert_allclose(mapped[:, 20:-20], 0.0)


@pytest.mark.parametrize("kind", ["mask", "nan", "infinity", "sentinel"])
def test_missing_regrid_support_is_nan_including_both_periodic_edges(kind):
    values = np.full((7, 12), 9.0)
    valid = np.ones(values.shape, dtype=bool)
    if kind == "mask":
        valid[3, 0] = False
    else:
        values[3, 0] = {"nan": np.nan, "infinity": np.inf, "sentinel": 1e15}[kind]
    mapped = conservative_regrid(values, SOURCE_LAT, SOURCE_LON, valid)
    assert np.isnan(mapped[100:140, :20]).all()
    assert np.isnan(mapped[100:140, -20:]).all()
    assert np.isfinite(mapped).any()
    np.testing.assert_allclose(mapped[np.isfinite(mapped)], 9.0)
    assert not np.any(mapped == 0.0)


def test_streaming_smoke_publication_masks_identity_and_reuse(tmp_path):
    raw = make_source_archive(tmp_path / "raw", bad="missing")
    # chm's presence is irrelevant: the builder must read the paired slv/rad archive.
    (raw / "chm").mkdir()
    (raw / "chm" / "unusable.nc4").write_bytes(b"not a NetCDF file")
    output = build_dataset(raw, tmp_path / "release", smoke_days=7)
    manifest_path = output.with_name("manifest.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert output.name == DATA_FILE
    assert manifest["dataset_id"] == DATASET_ID
    assert manifest["build_mode"] == "smoke"
    assert manifest["dimensions"] == {"time": 56, "lat": 240, "lon": 480, "bounds": 2}
    assert manifest["frequency_hours"] == 3
    assert manifest["time_start"] == "2020-01-01T01:30:00Z"
    assert manifest["time_end"] == "2020-01-07T22:30:00Z"
    assert manifest["processing"]["spatial_method"] == "spherical_area_weighted_overlap"
    assert manifest["processing"]["temporal_method"] == "mean_of_three_complete_hourly_samples"
    assert manifest["training_profile"]["window"] == 56
    assert manifest["training_profile"]["horizon"] == 24
    assert manifest["data_sha256"] == sha256(output)
    assert len(manifest["source_files"]) == 14
    assert {item["product"] for item in manifest["source_files"]} == {"slv", "rad"}
    for item in manifest["source_files"]:
        assert item["sha256"] == sha256(raw / item["path"])
    canonical_manifest = json.dumps({key: value for key, value in manifest.items() if key != "dataset_fingerprint"},
                                    sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    identity = {"dataset_id": DATASET_ID, "dataset_version": "v1",
                "manifest_sha256": hashlib.sha256(canonical_manifest).hexdigest(),
                "data_sha256": sha256(output)}
    expected_fingerprint = hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    assert manifest["dataset_fingerprint"] == expected_fingerprint
    with netCDF4.Dataset(output) as stored:
        stored.set_auto_mask(False)
        assert stored.variables["TO3"].shape == (56, 240, 480)
        np.testing.assert_array_equal(stored.variables["time"][:], np.arange(56) * 3 + 1.5)
        np.testing.assert_array_equal(stored.variables["time_bounds"][[0, -1]], [[0.0, 3.0], [165.0, 168.0]])
        np.testing.assert_array_equal(stored.variables["lat_bounds"][[0, -1]], [[-90.0, -89.25], [89.25, 90.0]])
        np.testing.assert_array_equal(stored.variables["lon_bounds"][[0, -1]], [[-180.0, -179.25], [179.25, 180.0]])
        for name, expected_unit in zip(VARIABLE_UNITS, ["DU", "m s-1", "m s-1", "K", "W m-2"]):
            assert stored.variables[name].units == expected_unit
            assert manifest["variables"][name]["units"] == expected_unit
            field = stored.variables[name][:]
            mask = np.asarray(stored.variables[f"{name}_valid_mask"][:])
            assert set(np.unique(mask)).issubset({0, 1})
            np.testing.assert_array_equal(mask == 1, np.isfinite(field))
            assert manifest["variables"][name]["target_missing"] == int((mask == 0).sum())
            assert manifest["variables"][name]["missing_rate"] == pytest.approx(float((mask == 0).mean()))
            expected = np.repeat(np.arange(7) * 100.0, 8) + np.tile(np.arange(8) * 10.0 + 6.0, 7)
            expected += list(VARIABLE_UNITS).index(name)
            np.testing.assert_allclose(field[:, 0, 100], expected)
        assert np.isnan(stored.variables["TO3"][0, 100:140, :20]).all()
        assert np.isnan(stored.variables["TO3"][0, 100:140, -20:]).all()
    before = (sha256(output), sha256(manifest_path), output.stat().st_mtime_ns, manifest_path.stat().st_mtime_ns)
    assert build_dataset(raw, output.parent, smoke_days=7) == output
    assert before == (sha256(output), sha256(manifest_path), output.stat().st_mtime_ns, manifest_path.stat().st_mtime_ns)
    # An existing publication with damaged bytes is retained and rejected.
    corrupt = tmp_path / "corrupt"
    corrupt.mkdir()
    (corrupt / DATA_FILE).write_bytes(output.read_bytes() + b"changed bytes")
    (corrupt / "manifest.json").write_bytes(manifest_path.read_bytes())
    with pytest.raises(ValueError, match="SHA-256"):
        verify_existing_release(corrupt)
    assert (corrupt / DATA_FILE).read_bytes().endswith(b"changed bytes")
    manifest["time_zone"] = "changed"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(ValueError, match="fingerprint"):
        build_dataset(raw, output.parent, smoke_days=7)
    assert json.loads(manifest_path.read_text(encoding="utf-8"))["time_zone"] == "changed"


@pytest.mark.parametrize("bad,match", [("duplicate_hour", "time"), ("offset_hour", "time"),
                                       ("incomplete_hours", "time"), ("mismatched_product_hours", "time"),
                                       ("unit", "unit")])
def test_malformed_hourly_sources_never_publish_a_manifest(tmp_path, bad, match):
    raw = make_source_archive(tmp_path / "raw", bad=bad)
    before = {path: sha256(path) for path in raw.rglob("*.nc4")}
    with pytest.raises(ValueError, match=match):
        build_dataset(raw, tmp_path / "release", smoke_days=7)
    assert not (tmp_path / "release" / "manifest.json").exists()
    assert all(sha256(path) == digest for path, digest in before.items())


@pytest.mark.parametrize("bad,match", [("missing_pair", "missing slv/rad"), ("wrong_product", "product")])
def test_selected_source_products_must_be_complete_and_correct(tmp_path, bad, match):
    raw = make_source_archive(tmp_path / "raw", bad=bad)
    days = [date(2020, 1, 1) + timedelta(days=i) for i in range(7)]
    with pytest.raises(ValueError, match=match):
        discover_source_files(raw, days)


def test_duplicate_selected_source_file_is_rejected(tmp_path):
    raw = make_source_archive(tmp_path / "raw")
    source = next((raw / "slv").glob("*20200101*"))
    source.with_name(source.name.replace("400", "401")).write_bytes(source.read_bytes())
    days = [date(2020, 1, 1) + timedelta(days=i) for i in range(7)]
    with pytest.raises(ValueError, match="duplicate"):
        discover_source_files(raw, days)


def test_partial_existing_output_is_retained_without_overwrite(tmp_path):
    raw = make_source_archive(tmp_path / "raw")
    output_dir = tmp_path / "release"
    output_dir.mkdir()
    existing = output_dir / DATA_FILE
    existing.write_bytes(b"existing partial output")
    with pytest.raises(ValueError, match="partial"):
        build_dataset(raw, output_dir, smoke_days=7)
    assert existing.read_bytes() == b"existing partial output"
    assert not existing.with_name("manifest.json").exists()


@pytest.mark.parametrize("smoke_days", [6, 31])
def test_smoke_duration_is_limited_to_seven_through_thirty_days(tmp_path, smoke_days):
    with pytest.raises(ValueError, match="between 7 and 30"):
        build_dataset(tmp_path / "missing", tmp_path / "release", smoke_days=smoke_days)


def test_independent_verifier_agrees_on_cf_packing_valid_range_and_du(tmp_path):
    raw = make_source_archive(tmp_path / "raw")
    for path in (raw / "slv").glob("*.nc4"):
        with netCDF4.Dataset(path, "a") as source:
            ozone = source["TO3"]
            ozone.units = "DU"
            ozone.scale_factor = np.float32(.25)
            ozone.add_offset = np.float32(3)
            # The range acts on stored samples, before packing is decoded.
            ozone.valid_range = np.array([0, 700], dtype="float32")
    output = build_dataset(raw, tmp_path / "release", smoke_days=7)
    with netCDF4.Dataset(output) as release:
        # First three stored samples are 1,4,13: mean(0.25*x+3)=4.5.
        np.testing.assert_allclose(release["TO3"][0], 4.5)
    report = verify_package(output.parent, raw_root=raw)
    assert report["validation"] == "passed"
    assert report["raw_comparison"]["samples_checked"] == 405


@pytest.mark.parametrize("change,match", [("time", "time has duplicates"),
                                        ("mask", "mask/value mismatch"),
                                        ("statistics", "statistics mismatch")])
def test_independent_verifier_rejects_rehashed_but_invalid_content(tmp_path, change, match):
    raw = make_source_archive(tmp_path / "raw")
    output = build_dataset(raw, tmp_path / "release", smoke_days=7)
    manifest_path = output.with_name("manifest.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if change == "statistics":
        manifest["variables"]["TO3"]["missing_rate"] = .5
    else:
        with netCDF4.Dataset(output, "a") as release:
            if change == "time":
                release["time"][1] = release["time"][0]
            else:
                release["TO3_valid_mask"][0, 120, 240] = 0
        manifest["data_bytes"] = output.stat().st_size
        manifest["data_sha256"] = sha256(output)
    manifest["dataset_fingerprint"] = dataset_fingerprint(manifest)
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    before = sha256(output), sha256(manifest_path)
    with pytest.raises(ValueError, match=match):
        verify_package(output.parent)
    assert (sha256(output), sha256(manifest_path)) == before


def test_independent_verifier_rejects_data_sha_corruption(tmp_path):
    raw = make_source_archive(tmp_path / "raw")
    output = build_dataset(raw, tmp_path / "release", smoke_days=7)
    manifest_path = output.with_name("manifest.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["data_sha256"] = "0" * 64
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        verify_package(output.parent)
