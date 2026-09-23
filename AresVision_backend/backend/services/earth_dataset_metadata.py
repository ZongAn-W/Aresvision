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
import re
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping, Optional

import numpy as np

from services.dataset_identity import build_dataset_fingerprint
from services.earth_dataset import CHANNELS, SCHEMA, SPLITS, UNITS, load_earth_dataset

logger = logging.getLogger("aresvision.datasets.earth")

MANIFEST_FILE_NAME = "manifest.json"
DATA_FILE_NAME = "earth_merra2_daily.nc"

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

    Holds the metadata plus the read-only arrays needed by the overview APIs, so
    a request never re-opens the NetCDF file. The server never returns this
    object over HTTP.
    """

    metadata: dict
    signature: tuple
    dates: np.ndarray
    latitude: np.ndarray
    longitude: np.ndarray
    fields: Mapping[str, np.ndarray]


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
