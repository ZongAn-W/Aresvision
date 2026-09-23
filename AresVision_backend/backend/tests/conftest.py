"""Shared fixtures for backend tests.

Fixtures here are opt-in only: nothing in this module runs automatically, so
importing heavyweight data dependencies stays scoped to the tests that ask for
them.
"""

import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture
def earth_release(tmp_path):
    """Build a temporary Earth compact release with the real dimensions.

    Covers the full 731 day / 31 x 49 grid of the production package so registry
    and route contracts can be exercised without the multi-megabyte local file.
    """
    import hashlib
    import json
    import numpy as np
    from scripts.build_earth_ozone_dataset import build_dataset

    dates = np.arange("2020-01-01", "2022-01-01", dtype="datetime64[D]")
    lat = np.arange(-60, 61, 4, dtype=np.float32)
    lon = np.arange(-120, 121, 5, dtype=np.float32)
    cube = np.broadcast_to(
        np.arange(len(dates), dtype=np.float32)[:, None, None],
        (len(dates), len(lat), len(lon)),
    )
    source = tmp_path / "source.npz"
    np.savez_compressed(
        source, **{key: cube + offset for offset, key in enumerate(("O3", "U", "V", "T", "S"))},
        lat=lat, lon=lon, time_iso=dates.astype(str),
        metadata=json.dumps({
            "source": "MERRA2", "temporal": "daily", "lat_stride": 8, "lon_stride": 8,
            "used_variables": {"O3": ["TO3"], "U": ["U10M"], "V": ["V10M"], "T": ["T2M"], "S": ["SWGDN"]},
        }),
    )
    path = build_dataset(source, tmp_path / "earth")
    return {
        "earth_package_dir": path.parent,
        "expected_manifest_sha256": hashlib.sha256(path.with_name("manifest.json").read_bytes()).hexdigest(),
        "expected_data_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


@pytest.fixture
def earth_spatial_release(tmp_path):
    """Temporary Earth release whose fields vary along both spatial axes.

    Values are ``1000 * t + 10 * row + col`` plus a per-variable offset, so a
    transposed, flipped or mis-indexed read differs visibly instead of happening
    to match. Dimensions, dates, units and splits follow the same protocol as the
    production package (731 days, 31 x 49).
    """
    import hashlib
    import json
    import numpy as np
    from scripts.build_earth_ozone_dataset import build_dataset

    dates = np.arange("2020-01-01", "2022-01-01", dtype="datetime64[D]")
    lat = np.arange(-60, 61, 4, dtype=np.float32)
    lon = np.arange(-120, 121, 5, dtype=np.float32)
    base = (
        1000.0 * np.arange(len(dates), dtype=np.float32)[:, None, None]
        + 10.0 * np.arange(len(lat), dtype=np.float32)[None, :, None]
        + np.arange(len(lon), dtype=np.float32)[None, None, :]
    )
    source = tmp_path / "spatial_source.npz"
    np.savez_compressed(
        source,
        **{key: base + offset for offset, key in enumerate(("O3", "U", "V", "T", "S"))},
        lat=lat, lon=lon, time_iso=dates.astype(str),
        metadata=json.dumps({
            "source": "MERRA2", "temporal": "daily", "lat_stride": 8, "lon_stride": 8,
            "used_variables": {"O3": ["TO3"], "U": ["U10M"], "V": ["V10M"], "T": ["T2M"], "S": ["SWGDN"]},
        }),
    )
    path = build_dataset(source, tmp_path / "earth_spatial")
    return {
        "earth_package_dir": path.parent,
        "expected_manifest_sha256": hashlib.sha256(path.with_name("manifest.json").read_bytes()).hexdigest(),
        "expected_data_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }
