"""Verify a fixed Earth compact release and describe it, without training support.

The package directory comes from server configuration only. Client input never
selects a path, and the manifest may only reference the fixed data file name.

Verification order (each step fails with a stable reason code):

1. both files exist                     -> ``package_missing``
2. manifest raw-byte SHA-256            -> ``manifest_fingerprint_mismatch``
3. manifest is a JSON object            -> ``invalid_manifest``
4. manifest ``data_file`` fixed name    -> ``invalid_manifest``
5. NetCDF raw-byte SHA-256              -> ``data_fingerprint_mismatch``
6. manifest self reported hash/size     -> ``manifest_metadata_mismatch``
7. ``load_earth_dataset()`` data contract -> ``invalid_dataset``
8. manifest vs NetCDF metadata          -> ``manifest_metadata_mismatch``
9. file signatures changed mid check    -> ``package_changed_during_verification``
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping, Optional

import numpy as np
import xarray as xr

from services.dataset_identity import build_dataset_fingerprint
from services.earth_dataset import (
    CHANNELS, SCHEMA, SPLITS, UNITS, load_earth_dataset,
    THREE_HOURLY_SCHEMA, THREE_HOURLY_DATASET_ID, THREE_HOURLY_DATASET_VERSION,
    THREE_HOURLY_TRAINING_PROFILE, validate_earth_3hourly_dataset,
)
from services.netcdf_read_lock import netcdf_read_lock

logger = logging.getLogger("aresvision.datasets.earth")

MANIFEST_FILE_NAME = "manifest.json"
DATA_FILE_NAME = "earth_merra2_daily.nc"
THREE_HOURLY_DATA_FILE_NAME = "earth_merra2_3hourly.nc"

GREGORIAN_CALENDARS = frozenset({"standard", "gregorian", "proleptic_gregorian"})

VARIABLE_LABELS = {
    "TO3": "Total column ozone",
    "U10M": "10 m eastward wind",
    "V10M": "10 m northward wind",
    "T2M": "2 m air temperature",
    "SWGDN": "Surface incoming shortwave flux",
}
TARGET_CHANNEL = "TO3"

REASON_PACKAGE_MISSING = "package_missing"
REASON_PACKAGE_UNREADABLE = "package_unreadable"
REASON_MANIFEST_FINGERPRINT_MISMATCH = "manifest_fingerprint_mismatch"
REASON_DATA_FINGERPRINT_MISMATCH = "data_fingerprint_mismatch"
REASON_INVALID_MANIFEST = "invalid_manifest"
REASON_MANIFEST_METADATA_MISMATCH = "manifest_metadata_mismatch"
REASON_INVALID_DATASET = "invalid_dataset"
REASON_PACKAGE_CHANGED = "package_changed_during_verification"

_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class EarthPackageError(RuntimeError):
    """A package verification failure carrying a stable public reason code."""

    def __init__(self, reason: str, detail: str = ""):
        super().__init__(detail or reason)
        self.reason = reason
        self.detail = detail


def file_sha256(path: Path) -> str:
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def package_signature(package_dir: Any, *, data_file_name: str = DATA_FILE_NAME) -> tuple:
    """Cheap signature used as a cache key; changes whenever a file changes."""
    root = Path(package_dir).expanduser()
    parts = []
    for name in (MANIFEST_FILE_NAME, data_file_name):
        path = root / name
        try:
            stat = path.stat()
        except OSError:
            parts.append((str(path), None, None, None))
        else:
            parts.append((str(path), stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns))
    return tuple(parts)


def read_verified_manifest(
    package_dir: Any,
    expected_manifest_sha256: str,
    expected_data_sha256: str,
    *,
    data_file_name: str = DATA_FILE_NAME,
) -> tuple[dict, Path]:
    """Validate both artifact hashes and the manifest self description."""
    root = Path(package_dir).expanduser()
    manifest_path = root / MANIFEST_FILE_NAME
    data_path = root / data_file_name
    if not manifest_path.is_file() or not data_path.is_file():
        raise EarthPackageError(REASON_PACKAGE_MISSING, "package files are missing")

    manifest_bytes = manifest_path.read_bytes()
    if hashlib.sha256(manifest_bytes).hexdigest() != expected_manifest_sha256:
        raise EarthPackageError(
            REASON_MANIFEST_FINGERPRINT_MISMATCH, "manifest.json is not the released version"
        )
    try:
        manifest = json.loads(manifest_bytes)
    except ValueError as exc:
        raise EarthPackageError(REASON_INVALID_MANIFEST, f"manifest is not valid JSON: {exc}") from exc
    if not isinstance(manifest, dict):
        raise EarthPackageError(REASON_INVALID_MANIFEST, "manifest must be a JSON object")
    if manifest.get("data_file") != data_path.name:
        raise EarthPackageError(
            REASON_INVALID_MANIFEST, "manifest data_file must be the fixed package data file"
        )
    if file_sha256(data_path) != expected_data_sha256:
        raise EarthPackageError(
            REASON_DATA_FINGERPRINT_MISMATCH, "data file is not the released version"
        )
    if manifest.get("data_sha256") != expected_data_sha256:
        raise EarthPackageError(
            REASON_MANIFEST_METADATA_MISMATCH,
            "manifest data_sha256 does not match the released data file",
        )
    if manifest.get("data_bytes") != data_path.stat().st_size:
        raise EarthPackageError(
            REASON_MANIFEST_METADATA_MISMATCH,
            "manifest data_bytes does not match the released data file",
        )
    return manifest, data_path


def _assert_manifest_matches(ds, manifest: Mapping[str, Any]) -> None:
    """Compare manifest claims against the decoded NetCDF content item by item."""
    dates = ds.time.values.astype("datetime64[D]")
    lat = np.asarray(ds.lat.values, dtype="float64")
    lon = np.asarray(ds.lon.values, dtype="float64")

    checks = [
        manifest.get("schema") == SCHEMA,
        manifest.get("planet") == "Earth",
        manifest.get("dimensions") == {name: int(size) for name, size in ds.sizes.items()},
        manifest.get("time_start") == str(dates[0]),
        manifest.get("time_end") == str(dates[-1]),
        manifest.get("channel_order") == list(CHANNELS),
        manifest.get("latitude_range") == ([float(ds.lat_bounds.values[0, 0]), float(ds.lat_bounds.values[-1, 1])] if "lat_bounds" in ds else [float(lat.min()), float(lat.max())]),
        manifest.get("longitude_range") == ([float(ds.lon_bounds.values[0, 0]), float(ds.lon_bounds.values[-1, 1])] if "lon_bounds" in ds else [float(lon.min()), float(lon.max())]),
        manifest.get("source_sha256") == ds.attrs.get("source_sha256"),
        manifest.get("cadence") == "daily mean",
        ds.attrs.get("temporal_resolution") == "1 day",
    ]
    declared_variables = manifest.get("variables")
    if not isinstance(declared_variables, dict):
        declared_variables = {}
    splits = manifest.get("splits") if isinstance(manifest.get("splits"), dict) else {}
    for name, unit in zip(CHANNELS, UNITS):
        variable = declared_variables.get(name)
        if not isinstance(variable, dict):
            variable = {}
        checks.extend([
            variable.get("units") == unit == ds[name].attrs.get("units"),
            variable.get("dtype") == "float32" == str(ds[name].dtype),
            variable.get("min") == float(ds[name].min()),
            variable.get("max") == float(ds[name].max()),
        ])
    for name, code in SPLITS.items():
        selected = dates[ds["split"].values == code]
        if len(selected) == 0:
            checks.append(False)
            continue
        checks.append(splits.get(name) == {
            "start": str(selected[0]),
            "end": str(selected[-1]),
            "days": int(len(selected)),
        })
    if not all(checks):
        raise EarthPackageError(
            REASON_MANIFEST_METADATA_MISMATCH, "manifest metadata does not match the data file"
        )

    if not all(np.isfinite(np.diff(axis)).all() for axis in (lat, lon)):
        raise EarthPackageError(REASON_INVALID_DATASET, "grid coordinates are not finite")
    if not (
        np.allclose(np.diff(lat), np.diff(lat)[0])
        and np.allclose(np.diff(lon), np.diff(lon)[0])
    ):
        raise EarthPackageError(REASON_INVALID_DATASET, "grid coordinates are not uniform")
    if "lat_bounds" in ds:
        expected_bounds = {
            "latitude": [float(ds.lat_bounds.values[0, 0]), float(ds.lat_bounds.values[-1, 1])],
            "longitude": [float(ds.lon_bounds.values[0, 0]), float(ds.lon_bounds.values[-1, 1])],
        }
        if manifest.get("cell_bounds") != expected_bounds:
            raise EarthPackageError(REASON_MANIFEST_METADATA_MISMATCH, "cell bounds mismatch")
        normalization = manifest.get("normalization", {})
        stats = normalization.get("train_stats", {}) if isinstance(normalization, dict) else {}
        if not isinstance(normalization, dict) or normalization.get("fit_split") != "train":
            raise EarthPackageError(REASON_MANIFEST_METADATA_MISMATCH, "normalization must use train dates")
        for name in CHANNELS:
            train_values = ds[name].values[ds['split'].values == SPLITS['train']]
            mean = float(train_values.mean(dtype='float64'))
            std = float(train_values.std(dtype='float64'))
            expected = {'mean': mean, 'std': std, 'scale_std': std if std >= 1e-6 else 1.0}
            declared = stats.get(name, {})
            if any(key not in declared or not np.isclose(declared[key], value, rtol=1e-12, atol=1e-12)
                   for key, value in expected.items()):
                raise EarthPackageError(REASON_MANIFEST_METADATA_MISMATCH, "training normalization statistics mismatch")


def _decode_calendar(ds) -> str:
    encoding = getattr(getattr(ds, "time", None), "encoding", None) or {}
    calendar = encoding.get("calendar")
    if not isinstance(calendar, str) or calendar.strip().lower() not in GREGORIAN_CALENDARS:
        raise EarthPackageError(
            REASON_INVALID_DATASET,
            "time coordinate must use a Gregorian calendar",
        )
    return calendar.strip().lower()


def readonly_array(values, dtype=None) -> np.ndarray:
    """Copy ``values`` into a read-only NumPy array."""
    result = np.array(values, dtype=dtype, copy=True)
    result.setflags(write=False)
    return result


@dataclass(frozen=True)
class VerifiedEarthRelease:
    """A verified snapshot of the fixed Earth release.

    Daily releases hold fields for the existing overview and model APIs. The
    three-hour snapshot holds coordinates and a server-only file path, with no
    field arrays; its large volume stays on disk. The server never returns this
    object over HTTP or includes the path in descriptor metadata.
    """

    metadata: dict
    signature: tuple
    dates: np.ndarray
    latitude: np.ndarray
    longitude: np.ndarray
    fields: Mapping[str, np.ndarray]
    data_path: Optional[Path] = None


def read_earth_metadata(
    package_dir: Any,
    *,
    expected_manifest_sha256: str,
    expected_data_sha256: str,
    dataset_id: Optional[str] = None,
    dataset_version: Optional[str] = None,
    data_file_name: str = DATA_FILE_NAME,
) -> dict:
    """Return verified Earth metadata, or raise :class:`EarthPackageError`."""
    return read_earth_release(
        package_dir,
        expected_manifest_sha256=expected_manifest_sha256,
        expected_data_sha256=expected_data_sha256,
        dataset_id=dataset_id,
        dataset_version=dataset_version,
        data_file_name=data_file_name,
    ).metadata


def read_earth_release(
    package_dir: Any,
    *,
    expected_manifest_sha256: str,
    expected_data_sha256: str,
    dataset_id: Optional[str] = None,
    dataset_version: Optional[str] = None,
    data_file_name: str = DATA_FILE_NAME,
) -> VerifiedEarthRelease:
    """Verify the release and return its metadata plus read-only data arrays.

    Uses the same pinned-hash, manifest semantics and before/after signature
    checks as the metadata-only path; both share this single verification body.
    """
    if not _SHA256_PATTERN.match(expected_manifest_sha256 or "") or not _SHA256_PATTERN.match(
        expected_data_sha256 or ""
    ):
        raise EarthPackageError(
            REASON_INVALID_MANIFEST, "expected release hashes are not valid sha256 digests"
        )

    signature_before = package_signature(package_dir, data_file_name=data_file_name)
    manifest, data_path = read_verified_manifest(
        package_dir,
        expected_manifest_sha256,
        expected_data_sha256,
        data_file_name=data_file_name,
    )
    try:
        ds = load_earth_dataset(data_path)
    except EarthPackageError:
        raise
    except Exception as exc:
        raise EarthPackageError(REASON_INVALID_DATASET, str(exc)) from exc

    with ds:
        try:
            calendar = _decode_calendar(ds)
            _assert_manifest_matches(ds, manifest)
            if dataset_id == 'earth_merra2_daily_v2' and (
                manifest.get('dataset_id') != dataset_id or manifest.get('dataset_version') != dataset_version
                or 'lat_bounds' not in ds or 'lon_bounds' not in ds
            ):
                raise EarthPackageError(REASON_MANIFEST_METADATA_MISMATCH, 'v2 release identity or bounds mismatch')
            metadata = _extract_metadata(
                ds,
                manifest,
                calendar=calendar,
                dataset_id=dataset_id,
                dataset_version=dataset_version,
                manifest_sha256=expected_manifest_sha256,
                data_sha256=expected_data_sha256,
            )
            release = VerifiedEarthRelease(
                metadata=metadata,
                signature=signature_before,
                dates=readonly_array(ds.time.values, "datetime64[D]"),
                latitude=readonly_array(ds.lat.values),
                longitude=readonly_array(ds.lon.values),
                fields=MappingProxyType({
                    name: readonly_array(ds[name].values, "float32") for name in CHANNELS
                }),
            )
        except EarthPackageError:
            raise
        except Exception as exc:
            raise EarthPackageError(REASON_INVALID_DATASET, str(exc)) from exc

    if package_signature(package_dir, data_file_name=data_file_name) != signature_before:
        raise EarthPackageError(
            REASON_PACKAGE_CHANGED, "package files changed during verification"
        )
    return release


def _extract_metadata(
    ds,
    manifest: Mapping[str, Any],
    *,
    calendar: str,
    dataset_id: Optional[str],
    dataset_version: Optional[str],
    manifest_sha256: str,
    data_sha256: str,
) -> dict:
    dates = ds.time.values.astype("datetime64[D]")
    lat = np.asarray(ds.lat.values, dtype="float64")
    lon = np.asarray(ds.lon.values, dtype="float64")

    latitude_step = float(np.diff(lat)[0])
    longitude_step = float(np.diff(lon)[0])
    latitude_bounds = ([float(ds.lat_bounds.values[0, 0]), float(ds.lat_bounds.values[-1, 1])]
                       if 'lat_bounds' in ds else [float(lat.min()), float(lat.max())])
    longitude_bounds = ([float(ds.lon_bounds.values[0, 0]), float(ds.lon_bounds.values[-1, 1])]
                        if 'lon_bounds' in ds else [float(lon.min()), float(lon.max())])
    coverage = "global" if (
        'lat_bounds' in ds and 'lon_bounds' in ds
        and np.allclose(latitude_bounds, [-90., 90.], rtol=0, atol=1e-8)
        and np.allclose(longitude_bounds, [-180., 180.], rtol=0, atol=1e-8)
    ) else "regional"
    splits = manifest.get("splits") if isinstance(manifest.get("splits"), dict) else {}
    limitations = manifest.get("limitations")
    if not isinstance(limitations, list):
        limitations = []

    return {
        "dataset_fingerprint": build_dataset_fingerprint(
            dataset_id, dataset_version, manifest_sha256, data_sha256
        ),
        "manifest_sha256": manifest_sha256,
        "data_sha256": data_sha256,
        # The verified manifest itself, so downstream services can report the
        # published provenance (source digest, processing description) without
        # re-reading the package. It carries no server path: the manifest may
        # only name the fixed data file, which was already checked above.
        "manifest": dict(manifest),
        "schema": SCHEMA,
        "time": {
            "kind": "date",
            "calendar": calendar,
            "start": str(dates[0]),
            "end": str(dates[-1]),
            "count": int(len(dates)),
            "step": int((dates[1] - dates[0]) / np.timedelta64(1, "D")),
            "step_unit": "day",
        },
        "grid": {
            "shape": [int(ds.sizes["lat"]), int(ds.sizes["lon"])],
            "dimension_order": ["lat", "lon"],
            "latitude_range": [float(latitude_bounds[0]), float(latitude_bounds[1])],
            "longitude_range": [float(longitude_bounds[0]), float(longitude_bounds[1])],
            "cell_bounds": {
                "latitude": [float(latitude_bounds[0]), float(latitude_bounds[1])],
                "longitude": [float(longitude_bounds[0]), float(longitude_bounds[1])],
            },
            "latitude_step": latitude_step,
            "longitude_step": longitude_step,
            "latitude_order": "ascending" if latitude_step > 0 else "descending",
            "longitude_order": "ascending" if longitude_step > 0 else "descending",
            "coverage": coverage,
            "wrap_longitude": bool(coverage == "global"),
            "latitude_values": [float(value) for value in lat],
            "longitude_values": [float(value) for value in lon],
        },
        "channel_order": list(CHANNELS),
        "variables": [
            {
                "id": name,
                "label": VARIABLE_LABELS[name],
                "units": unit,
                "role": "target_and_input" if name == TARGET_CHANNEL else "optional_input",
            }
            for name, unit in zip(CHANNELS, UNITS)
        ],
        "splits": {
            name: {
                "start": str(splits[name]["start"]),
                "end": str(splits[name]["end"]),
                "days": int(splits[name]["days"]),
            }
            for name in SPLITS
        },
        "limitations": [str(item) for item in limitations],
    }


def _canonical_json(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False).encode("utf-8")


def threehour_manifest_content_sha256(manifest: Mapping[str, Any]) -> str:
    """Match the offline builder's non-self-referential fingerprint basis."""
    return hashlib.sha256(_canonical_json({
        key: value for key, value in manifest.items() if key != "dataset_fingerprint"
    })).hexdigest()


def _unique_json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate manifest key: {key}")
        result[key] = value
    return result


def _invalid_json_constant(value):
    raise ValueError(f"non-finite JSON constant: {value}")


def _finite_json_float(value):
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"non-finite JSON number: {value}")
    return result


def _assert_threehour_manifest_identity(manifest):
    if (not isinstance(manifest, dict) or manifest.get("schema") != THREE_HOURLY_SCHEMA
            or manifest.get("planet") != "Earth"
            or manifest.get("dataset_id") != THREE_HOURLY_DATASET_ID
            or manifest.get("dataset_version") != THREE_HOURLY_DATASET_VERSION
            or manifest.get("data_file") != THREE_HOURLY_DATA_FILE_NAME):
        raise EarthPackageError(REASON_INVALID_MANIFEST, "wrong three-hour release identity or filename")
    if (not _SHA256_PATTERN.fullmatch(str(manifest.get("data_sha256", "")))
            or not _SHA256_PATTERN.fullmatch(str(manifest.get("dataset_fingerprint", "")))
            or not _SHA256_PATTERN.fullmatch(str(manifest.get("source_sha256", "")))
            or type(manifest.get("data_bytes")) is not int or manifest["data_bytes"] < 1):
        raise EarthPackageError(REASON_INVALID_MANIFEST, "manifest must include valid release hashes and size")


def _iso_utc(value) -> str:
    return np.datetime_as_string(np.datetime64(value, "s"), unit="s") + "Z"


def _assert_threehour_manifest_matches(ds, manifest, statistics):
    """Verify all descriptor claims and the source inventory without requiring raw files."""
    times = ds.time.values
    days = times.astype("datetime64[D]")
    source = manifest.get("source")
    files = manifest.get("source_files")
    processing = manifest.get("processing")
    rule = manifest.get("time_rule")
    expected_grid = {
        "latitude": {"start": -89.625, "end": 89.625, "step": .75, "count": 240},
        "longitude": {"start": -179.625, "end": 179.625, "step": .75, "count": 480},
        "latitude_bounds": [-90., 90.], "longitude_bounds": [-180., 180.],
    }
    checks = [
        manifest.get("dimensions") == {name: int(size) for name, size in ds.sizes.items()},
        manifest.get("time_start") == _iso_utc(times[0]),
        manifest.get("time_end") == _iso_utc(times[-1]),
        manifest.get("frequency_hours") == 3,
        manifest.get("step_unit") == "hour", manifest.get("step") == 3,
        manifest.get("time_zone") == "UTC", manifest.get("time_kind") == "iso-datetime",
        manifest.get("cadence") == "3 hour mean", manifest.get("grid_shape") == [240, 480],
        manifest.get("grid") == expected_grid,
        manifest.get("channel_order") == list(CHANNELS),
        manifest.get("training_profile") == THREE_HOURLY_TRAINING_PROFILE,
        manifest.get("source_sha256") == ds.attrs.get("source_sha256"),
        isinstance(source, dict), isinstance(files, list) and bool(files),
        isinstance(processing, dict), isinstance(rule, dict),
        manifest.get("build_mode") in ("smoke", "subset", "full"),
    ]
    if not all(checks):
        raise EarthPackageError(REASON_MANIFEST_METADATA_MISMATCH, "three-hour manifest contract mismatch")
    expected_days = [str(value) for value in np.unique(days)]
    checks = [
        source.get("date_start") == expected_days[0], source.get("date_end") == expected_days[-1],
        source.get("daily_file_count") == len(expected_days), source.get("products") == ["slv", "rad"],
        source.get("excluded_products") == ["chm"],
        processing.get("temporal_method") == "mean_of_three_complete_hourly_samples",
        processing.get("spatial_method") == "spherical_area_weighted_overlap",
        rule.get("interval_start") == _iso_utc(ds.time_bounds.values[0, 0]),
        rule.get("interval_end_exclusive") == _iso_utc(ds.time_bounds.values[-1, 1]),
    ]
    if manifest["build_mode"] == "full":
        checks.append(expected_days[0] == "2020-01-01" and expected_days[-1] == "2021-12-31"
                      and len(times) == 5848)
    if manifest["build_mode"] == "smoke":
        checks.append(7 <= len(expected_days) <= 30)
    keys = []
    for item in files:
        if not isinstance(item, dict):
            raise EarthPackageError(REASON_MANIFEST_METADATA_MISMATCH, "invalid source inventory entry")
        product, day, relative = item.get("product"), item.get("date"), item.get("path")
        if not isinstance(relative, str):
            raise EarthPackageError(REASON_MANIFEST_METADATA_MISMATCH, "invalid source inventory path")
        path = Path(relative)
        checks.extend([
            product in ("slv", "rad"), day in expected_days,
            not path.is_absolute() and ".." not in path.parts and ":" not in relative
            and "\\" not in relative and len(path.parts) == 2,
            path.parts[0] == product if path.parts else False,
            path.name == item.get("name"),
            type(item.get("bytes")) is int and item["bytes"] > 0,
            type(item.get("mtime_ns")) is int and item["mtime_ns"] >= 0,
            bool(_SHA256_PATTERN.fullmatch(str(item.get("sha256", "")))),
        ])
        keys.append((day, product))
    checks.extend([
        len(keys) == 2 * len(expected_days), len(set(keys)) == len(keys),
        set(keys) == {(day, product) for day in expected_days for product in ("slv", "rad")},
        hashlib.sha256(_canonical_json(files)).hexdigest() == manifest["source_sha256"],
    ])
    variables = manifest.get("variables")
    if not isinstance(variables, dict) or set(variables) != set(CHANNELS):
        checks.append(False)
    else:
        for name in CHANNELS:
            entry = variables[name]
            checks.append(isinstance(entry, dict))
            if isinstance(entry, dict):
                checks.extend(entry.get(key) == value for key, value in statistics[name].items())
    splits = manifest.get("splits")
    if not isinstance(splits, dict) or set(splits) != set(SPLITS):
        checks.append(False)
    else:
        for name, code in SPLITS.items():
            selected = days[ds.split.values == code]
            expected = {"start": str(selected[0]) if len(selected) else None,
                        "end": str(selected[-1]) if len(selected) else None,
                        "days": int(len(selected) // 8), "steps": int(len(selected))}
            checks.append(splits.get(name) == expected)
    if not all(checks):
        raise EarthPackageError(REASON_MANIFEST_METADATA_MISMATCH,
                                "three-hour source, variable statistics or split metadata mismatch")


def read_earth_3hourly_release(package_dir: Any) -> VerifiedEarthRelease:
    """Verify the server-configured three-hour package and return a catalog snapshot.

    The builder's canonical manifest content hash defines identity. Its actual
    raw-byte hash is retained separately for diagnostics and cache signatures.
    Fields remain on disk: registering a complete two-year release never creates
    a full in-memory data snapshot or opens daily training/prediction paths.
    """
    root = Path(package_dir).expanduser()
    before = package_signature(root, data_file_name=THREE_HOURLY_DATA_FILE_NAME)
    manifest_path, data_path = root / MANIFEST_FILE_NAME, root / THREE_HOURLY_DATA_FILE_NAME
    try:
        if not manifest_path.is_file() or not data_path.is_file():
            raise EarthPackageError(REASON_PACKAGE_MISSING, "three-hour package files are missing")
    except OSError as exc:
        raise EarthPackageError(REASON_PACKAGE_UNREADABLE, str(exc)) from exc
    try:
        raw = manifest_path.read_bytes()
        manifest = json.loads(raw, object_pairs_hook=_unique_json_object,
                              parse_constant=_invalid_json_constant,
                              parse_float=_finite_json_float)
    except OSError as exc:
        raise EarthPackageError(REASON_PACKAGE_UNREADABLE, str(exc)) from exc
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise EarthPackageError(REASON_INVALID_MANIFEST, str(exc)) from exc
    _assert_threehour_manifest_identity(manifest)
    try:
        content_sha = threehour_manifest_content_sha256(manifest)
    except (ValueError, RecursionError) as exc:
        raise EarthPackageError(REASON_INVALID_MANIFEST, str(exc)) from exc
    expected_fingerprint = build_dataset_fingerprint(
        THREE_HOURLY_DATASET_ID, THREE_HOURLY_DATASET_VERSION, content_sha, manifest["data_sha256"])
    if manifest["dataset_fingerprint"] != expected_fingerprint:
        raise EarthPackageError(REASON_MANIFEST_FINGERPRINT_MISMATCH,
                                "three-hour dataset fingerprint does not match its manifest")
    try:
        if data_path.stat().st_size != manifest["data_bytes"]:
            raise EarthPackageError(REASON_MANIFEST_METADATA_MISMATCH, "NetCDF size mismatch")
        if file_sha256(data_path) != manifest["data_sha256"]:
            raise EarthPackageError(REASON_DATA_FINGERPRINT_MISMATCH, "NetCDF SHA-256 mismatch")
        with netcdf_read_lock(), xr.open_dataset(data_path, engine="netcdf4", mask_and_scale=False) as ds:
            calendar = _decode_calendar(ds)
            statistics = validate_earth_3hourly_dataset(ds)
            _assert_threehour_manifest_matches(ds, manifest, statistics)
            lat, lon = readonly_array(ds.lat.values), readonly_array(ds.lon.values)
            metadata = {
                "dataset_fingerprint": expected_fingerprint,
                "manifest_sha256": hashlib.sha256(raw).hexdigest(),
                "manifest_content_sha256": content_sha, "data_sha256": manifest["data_sha256"],
                "manifest": manifest, "schema": THREE_HOURLY_SCHEMA,
                "frequency_hours": 3, "step_unit": "hour", "step": 3, "grid_shape": [240, 480],
                "training_profile": dict(THREE_HOURLY_TRAINING_PROFILE),
                "time": {"kind": "datetime", "calendar": calendar, "time_zone": "UTC",
                         "start": manifest["time_start"], "end": manifest["time_end"],
                         "count": int(ds.sizes["time"]), "step": 3, "step_unit": "hour",
                         "frequency_hours": 3, "label": "interval_center",
                         "interval_start": manifest["time_rule"]["interval_start"],
                         "interval_end_exclusive": manifest["time_rule"]["interval_end_exclusive"]},
                "grid": {"shape": [240, 480], "dimension_order": ["lat", "lon"],
                         "latitude_range": [-90., 90.], "longitude_range": [-180., 180.],
                         "cell_bounds": {"latitude": [-90., 90.], "longitude": [-180., 180.]},
                         "latitude_step": .75, "longitude_step": .75,
                         "latitude_order": "ascending", "longitude_order": "ascending",
                         "coverage": "global", "wrap_longitude": True,
                         "latitude_values": lat.tolist(), "longitude_values": lon.tolist()},
                "channel_order": list(CHANNELS),
                "variables": [{"id": name, "label": VARIABLE_LABELS[name], "units": unit,
                               "role": "target_and_input" if name == TARGET_CHANNEL else "optional_input",
                               "missing_rate": statistics[name]["missing_rate"],
                               "valid_mask": statistics[name]["valid_mask"]}
                              for name, unit in zip(CHANNELS, UNITS)],
                "splits": dict(manifest["splits"]),
                "limitations": [str(item) for item in manifest.get("limitations", [])],
            }
            release = VerifiedEarthRelease(metadata=metadata, signature=before,
                                           dates=readonly_array(ds.time.values, "datetime64[ns]"),
                                           latitude=lat, longitude=lon, fields=MappingProxyType({}),
                                           data_path=data_path)
    except EarthPackageError:
        raise
    except OSError as exc:
        # netCDF errors use negative errno values (e.g. -51 for an unknown
        # format). They describe invalid content, while filesystem/permission
        # failures remain an unreadable package; NC_EPERM is -37.
        reason = (REASON_INVALID_DATASET
                  if isinstance(exc.errno, int) and exc.errno < 0 and exc.errno != -37
                  else REASON_PACKAGE_UNREADABLE)
        raise EarthPackageError(reason, str(exc)) from exc
    except Exception as exc:
        raise EarthPackageError(REASON_INVALID_DATASET, str(exc)) from exc
    if package_signature(root, data_file_name=THREE_HOURLY_DATA_FILE_NAME) != before:
        raise EarthPackageError(REASON_PACKAGE_CHANGED, "package files changed during verification")
    return release
