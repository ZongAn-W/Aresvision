"""Standalone Earth daily data contract; independent of the Mars MY/Ls services."""

from pathlib import Path
import operator

import numpy as np
import xarray as xr

CHANNELS = ('TO3', 'U10M', 'V10M', 'T2M', 'SWGDN')
UNITS = ('DU', 'm s-1', 'm s-1', 'K', 'W m-2')
SPLITS = {'train': 0, 'validation': 1, 'test': 2}
SCHEMA = 'aresvision_earth_daily_v1'


def split_days(dates, train_end, validation_end):
    train_end = np.datetime64(train_end, 'D')
    validation_end = np.datetime64(validation_end, 'D')
    if np.isnat(train_end) or np.isnat(validation_end) or train_end >= validation_end:
        raise ValueError('train_end must be earlier than validation_end')
    splits = np.where(dates <= train_end, 0, np.where(dates <= validation_end, 1, 2)).astype('int8')
    if set(splits.tolist()) != {0, 1, 2}:
        raise ValueError('Each chronological split must contain at least one day')
    return splits


def validate_dataset(ds):
    if ds.attrs.get('planet') != 'Earth' or ds.attrs.get('schema') != SCHEMA:
        raise ValueError('Expected an AresVision Earth daily dataset')
    for name, limit in (('lat', 90), ('lon', 180)):
        if name not in ds.coords or ds[name].dims != (name,):
            raise ValueError(f'{name} must be a one-dimensional coordinate')
        values = ds[name].values
        if (len(values) < 2 or not np.isfinite(values).all()
                or np.any(np.abs(values) > limit) or np.any(np.diff(values) <= 0)):
            raise ValueError(f'{name} must be finite, increasing and within +/-{limit}')
    has_bounds = ('lat_bounds' in ds, 'lon_bounds' in ds)
    if any(has_bounds) and not all(has_bounds):
        raise ValueError('Both latitude and longitude cell bounds are required')
    for axis, limit in (('lat', 90), ('lon', 180)):
        name = f'{axis}_bounds'
        if name not in ds:
            continue  # v1 point-sampled compatibility package
        bounds = ds[name].values
        if (ds[name].dims != (axis, 'bounds') or bounds.shape != (ds.sizes[axis], 2)
                or not np.isfinite(bounds).all() or np.any(np.abs(bounds) > limit)
                or np.any(bounds[:, 1] <= bounds[:, 0])
                or not np.allclose(bounds[:-1, 1], bounds[1:, 0], rtol=0, atol=1e-8)
                or not np.allclose(bounds.mean(axis=1), ds[axis].values, rtol=0, atol=1e-8)
                or not np.allclose(bounds[:, 1] - bounds[:, 0], np.diff(ds[axis])[0], rtol=0, atol=1e-8)):
            raise ValueError(f'{name} must describe contiguous uniform cells centred on {axis}')
    if 'time' not in ds.coords or ds.time.dims != ('time',):
        raise ValueError('time must be a one-dimensional coordinate')
    times = ds.time.values
    if not np.issubdtype(times.dtype, np.datetime64):
        raise ValueError('time must contain decoded Earth dates')
    dates = times.astype('datetime64[D]')
    if (len(dates) < 3 or np.isnat(dates).any() or np.any(times != dates)
            or np.any(np.diff(dates) != np.timedelta64(1, 'D'))):
        raise ValueError('time must contain continuous, unique daily dates at midnight')
    for name, unit in zip(CHANNELS, UNITS):
        if name not in ds or ds[name].dims != ('time', 'lat', 'lon'):
            raise ValueError(f'{name} must have dimensions (time, lat, lon)')
        if ds[name].attrs.get('units') != unit:
            raise ValueError(f'{name} must use units {unit}')
        values = ds[name].values
        if not np.isfinite(values).all() or np.any(np.abs(values) >= 1e14):
            raise ValueError(f'{name} contains missing or invalid values')
    if 'train_end' not in ds.attrs or 'validation_end' not in ds.attrs:
        raise ValueError('Missing chronological split boundaries')
    expected = split_days(dates, ds.attrs['train_end'], ds.attrs['validation_end'])
    if 'split' not in ds or ds['split'].dims != ('time',) or not np.array_equal(ds['split'], expected):
        raise ValueError('split does not match chronological boundaries')


def load_earth_dataset(path):
    """Load the small package into memory and release the NetCDF file handle."""
    with xr.open_dataset(Path(path), engine='netcdf4') as source:
        ds = source.load()
    validate_dataset(ds)
    return ds


class EarthOzoneWindows:
    """NumPy map-style dataset usable directly with torch.utils.data.DataLoader.

    Inputs: [window, 5, lat, lon]; targets: [horizon, 1, lat, lon].
    Both use per-channel normalization fitted exclusively on training dates.
    Windows are formed within each split, never across split boundaries.
    """

    def __init__(self, path, *, split='train', window=7, horizon=3):
        if split not in SPLITS:
            raise ValueError(f'Unknown split: {split}')
        self.window, self.horizon = operator.index(window), operator.index(horizon)
        if self.window < 1 or self.horizon < 1:
            raise ValueError('window and horizon must be positive integers')
        with load_earth_dataset(path) as ds:
            cube = np.stack([ds[name].values for name in CHANNELS], axis=1).astype('float32')
            split_ids = ds['split'].values
            training = cube[split_ids == SPLITS['train']]
            self.mean = training.mean(axis=(0, 2, 3), dtype='float64').astype('float32')
            self.std = training.std(axis=(0, 2, 3), dtype='float64').astype('float32')
            self.std[self.std < 1e-6] = 1.0
            selected = split_ids == SPLITS[split]
            self.dates = ds.time.values[selected].astype('datetime64[D]')
            self.lat, self.lon = ds.lat.values.copy(), ds.lon.values.copy()
            self.data = ((cube[selected] - self.mean[None, :, None, None])
                         / self.std[None, :, None, None])
        self.length = len(self.dates) - self.window - self.horizon + 1
        if self.length < 1:
            raise ValueError('Not enough days in the selected split for window + horizon')

    def __len__(self):
        return self.length

    def __getitem__(self, index):
        index = operator.index(index)
        if index < 0 or index >= self.length:
            raise IndexError(index)
        forecast = index + self.window
        return (self.data[index:forecast].copy(),
                self.data[forecast:forecast + self.horizon, :1].copy())

    def denormalize_ozone(self, values):
        """Convert normalized target or model output back to Dobson units."""
        return values * self.std[0] + self.mean[0]
