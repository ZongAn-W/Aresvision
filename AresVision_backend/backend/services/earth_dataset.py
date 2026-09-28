"""Standalone Earth daily data contract; independent of the Mars MY/Ls services.

Two entry points share one implementation:

* :meth:`EarthOzoneWindows.__init__` keeps the original standalone behaviour of
  reading a package path directly, which the dataset verification and smoke
  scripts use.
* :meth:`EarthOzoneWindows.from_release` builds windows from an already verified
  :class:`VerifiedEarthRelease`, selects channels and reuses normalization
  statistics instead of fitting them again.

Normalization is always fitted on the **training dates only** and then reused by
validation, test and prediction. Nothing here mutates the release arrays: they
are read-only and shared with the overview API.
"""

from pathlib import Path
import operator

import numpy as np
import xarray as xr

CHANNELS = ('TO3', 'U10M', 'V10M', 'T2M', 'SWGDN')
UNITS = ('DU', 'm s-1', 'm s-1', 'K', 'W m-2')
SPLITS = {'train': 0, 'validation': 1, 'test': 2}
SCHEMA = 'aresvision_earth_daily_v1'

TARGET_CHANNEL = 'TO3'
TARGET_CHANNEL_INDEX = 0
OPTIONAL_CHANNELS = ('U10M', 'V10M', 'T2M', 'SWGDN')

# Published normalization contract. The stored values are valid float32 numbers
# computed with population statistics over the training dates.
NORMALIZATION_METHOD = 'per_channel_standard'
NORMALIZATION_DDOF = 0
NORMALIZATION_EPSILON = 1e-6
MINIMUM_SCALE = 1e-6


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


def canonical_input_channels(selected_channels=None):
    """Return the canonical model input order for a channel selection.

    ``TO3`` is always the first input and the only target. Auxiliary variables
    follow ``U10M, V10M, T2M, SWGDN`` regardless of request order.
    """
    if selected_channels is None:
        return [TARGET_CHANNEL, *OPTIONAL_CHANNELS]
    requested = set()
    for item in selected_channels:
        name = str(item).strip().upper()
        if name == TARGET_CHANNEL:
            continue
        if name not in OPTIONAL_CHANNELS:
            raise ValueError(f'Unsupported Earth input channel: {item}')
        if name in requested:
            raise ValueError(f'Duplicate Earth input channel: {item}')
        requested.add(name)
    return [TARGET_CHANNEL] + [name for name in OPTIONAL_CHANNELS if name in requested]


def input_units(channel_order):
    """Return the physical unit of each channel in model input order."""
    return [UNITS[CHANNELS.index(name)] for name in channel_order]


def stack_release_cube(release):
    """Stack the five published fields into ``[time, channel, lat, lon]`` float32."""
    return np.stack(
        [np.asarray(release.fields[name], dtype='float32') for name in CHANNELS], axis=1
    )


def fit_normalization(cube, input_channels, *, fit_dates=None):
    """Fit per-channel training statistics and return the serialisable contract.

    ``cube`` is ``[time, channel, lat, lon]`` for the **training dates only**, so
    validation and test values can never influence the statistics. Accumulation
    is float64 and the stored values are float32, matching the published manifest
    statistics. A near-constant channel keeps a scale of ``1.0`` and is flagged
    instead of being divided into NaN.
    """
    channels = list(input_channels)
    indices = [CHANNELS.index(name) for name in channels]
    array = np.asarray(cube, dtype='float64')
    if array.shape[1] != len(CHANNELS):
        raise ValueError('Normalization must be fitted on all five published channels')
    selected = array[:, indices]
    if not np.isfinite(selected).all():
        raise ValueError('Cannot fit normalization on non-finite values')
    mean = selected.mean(axis=(0, 2, 3))
    std = selected.std(axis=(0, 2, 3))
    constant = std < MINIMUM_SCALE
    scale = np.where(constant, 1.0, std)
    dates = [str(value) for value in (fit_dates if fit_dates is not None else [])]
    return {
        'method': NORMALIZATION_METHOD,
        'fit_split': 'train',
        'fit_date_start': dates[0] if dates else None,
        'fit_date_end': dates[-1] if dates else None,
        'ddof': NORMALIZATION_DDOF,
        'epsilon': NORMALIZATION_EPSILON,
        'channel_order': channels,
        'mean': [float(value) for value in mean.astype('float32')],
        'scale': [float(value) for value in scale.astype('float32')],
        'constant_channel_mask': [bool(value) for value in constant],
        'target_channel_index': TARGET_CHANNEL_INDEX,
    }


def validate_normalization(normalization, input_channels):
    """Return ``(mean, scale)`` float64 arrays for a saved normalization block.

    The saved channel order must match the model input order exactly: reusing a
    statistic fitted for different channels would silently rescale the inputs.
    """
    if not isinstance(normalization, dict):
        raise ValueError('Normalization must be a mapping')
    if normalization.get('method') != NORMALIZATION_METHOD:
        raise ValueError('Unsupported normalization method')
    if normalization.get('fit_split') != 'train':
        raise ValueError('Normalization must have been fitted on the training split')
    if list(normalization.get('channel_order') or []) != list(input_channels):
        raise ValueError('Normalization channel order does not match the model inputs')
    mean = np.asarray(normalization.get('mean'), dtype='float64')
    scale = np.asarray(normalization.get('scale'), dtype='float64')
    if mean.shape != (len(input_channels),) or scale.shape != (len(input_channels),):
        raise ValueError('Normalization vectors must have one value per input channel')
    if not np.isfinite(mean).all() or not np.isfinite(scale).all():
        raise ValueError('Normalization contains non-finite values')
    if np.any(scale <= 0):
        raise ValueError('Normalization scale must be positive')
    return mean, scale


def normalize_cube(cube, input_channels, mean, scale):
    """Standardise a ``[time, channel, lat, lon]`` cube with saved statistics."""
    indices = [CHANNELS.index(name) for name in input_channels]
    selected = np.asarray(cube, dtype='float32')[:, indices, :, :]
    scaled = (selected.astype('float64') - mean[None, :, None, None]) / scale[None, :, None, None]
    return scaled.astype('float32')


class EarthOzoneWindows:
    """NumPy map-style dataset usable directly with torch.utils.data.DataLoader.

    Inputs: ``[window, C, lat, lon]``; targets: ``[horizon, 1, lat, lon]``.
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
            all_dates = ds.time.values.astype('datetime64[D]')
            training = split_ids == SPLITS['train']
            self.normalization = fit_normalization(
                cube[training], list(CHANNELS), fit_dates=all_dates[training]
            )
            mean, scale = validate_normalization(self.normalization, list(CHANNELS))
            self.input_channels = list(CHANNELS)
            self.input_units = input_units(self.input_channels)
            self.dates = all_dates[split_ids == SPLITS[split]]
            self.lat, self.lon = ds.lat.values.copy(), ds.lon.values.copy()
            self.data = normalize_cube(cube[split_ids == SPLITS[split]], self.input_channels, mean, scale)
        self.target_channel_index = TARGET_CHANNEL_INDEX
        self._set_compat_statistics()
        self._set_length()

    @classmethod
    def from_release(
        cls,
        release,
        *,
        split='train',
        window=7,
        horizon=3,
        selected_channels=None,
        normalization=None,
        require_split_coverage=True,
    ):
        """Build windows from a verified release with optional channel selection.

        Only the training split may fit statistics (``normalization=None``); the
        validation, test and prediction paths must reuse the saved block.
        ``require_split_coverage=False`` selects the whole release instead of one
        published split, which the prediction path uses for its input window.
        """
        if split not in SPLITS:
            raise ValueError(f'Unknown split: {split}')
        window = operator.index(window)
        horizon = operator.index(horizon)
        if window < 1 or horizon < 1:
            raise ValueError('window and horizon must be positive integers')
        channels = canonical_input_channels(selected_channels)
        if normalization is None and split != 'train':
            raise ValueError('Only the training split may fit normalization statistics')

        dataset = cls.__new__(cls)
        dataset.window, dataset.horizon = window, horizon
        dates = np.asarray(release.dates, dtype='datetime64[D]')
        dataset.lat = np.array(release.latitude, dtype='float64', copy=True)
        dataset.lon = np.array(release.longitude, dtype='float64', copy=True)
        cube = stack_release_cube(release)
        split_ids = release_split_codes(dates, release.metadata)

        if normalization is None:
            training = split_ids == SPLITS['train']
            dataset.normalization = fit_normalization(
                cube[training], channels, fit_dates=dates[training]
            )
        else:
            dataset.normalization = normalization
        mean, scale = validate_normalization(dataset.normalization, channels)

        selected = (split_ids == SPLITS[split]) if require_split_coverage else np.ones(len(dates), dtype=bool)
        dataset.dates = dates[selected]
        dataset.data = normalize_cube(cube[selected], channels, mean, scale)
        dataset.input_channels = channels
        dataset.input_units = input_units(channels)
        dataset.target_channel_index = TARGET_CHANNEL_INDEX
        dataset._set_compat_statistics()
        dataset._set_length()
        return dataset

    def _set_compat_statistics(self):
        """Expose the historical ``mean``/``std`` attributes for existing callers."""
        self.mean = np.asarray(self.normalization['mean'], dtype='float32')
        self.std = np.asarray(self.normalization['scale'], dtype='float32')

    def _set_length(self):
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
        """Convert normalized target values back to Dobson units.

        Accepts either a NumPy array or a Tensor and returns the same kind; a
        tensor is never moved between devices implicitly.
        """
        mean = float(self.normalization['mean'][self.target_channel_index])
        scale = float(self.normalization['scale'][self.target_channel_index])
        if hasattr(values, 'dim') and hasattr(values, 'to'):
            return values * scale + mean
        return np.asarray(values) * scale + mean


def release_split_codes(dates, metadata):
    """Derive the per-day split code from the verified manifest split ranges.

    The published manifest is the authority, not a recomputed boundary: a
    package whose split flags disagree with its manifest fails verification
    before reaching this function.
    """
    splits = metadata.get('splits') or {}
    codes = np.full(len(dates), -1, dtype='int8')
    for name, code in SPLITS.items():
        entry = splits.get(name)
        if not isinstance(entry, dict):
            raise ValueError(f'Verified release has no published {name} split')
        start = np.datetime64(str(entry['start']), 'D')
        end = np.datetime64(str(entry['end']), 'D')
        codes[(dates >= start) & (dates <= end)] = code
    if np.any(codes < 0):
        raise ValueError('Published splits do not cover every release date')
    return codes


def release_date_index(release, date):
    """Return the position of ``date`` in the release, or raise ``KeyError``."""
    dates = np.asarray(release.dates, dtype='datetime64[D]')
    target = np.datetime64(date, 'D')
    matches = np.flatnonzero(dates == target)
    if matches.size == 0:
        raise KeyError(str(target))
    return int(matches[0])


def reference_ozone(release, start_date, horizon):
    """Return ``[horizon, lat, lon]`` reference TO3 in DU for a date range."""
    begin = release_date_index(release, start_date)
    stop = begin + int(horizon) - 1
    dates = np.asarray(release.dates, dtype='datetime64[D]')
    if stop >= len(dates):
        raise KeyError(str(np.datetime64(start_date, 'D') + np.timedelta64(horizon - 1, 'D')))
    span = dates[begin:stop + 1]
    if len(span) != int(horizon) or np.any(np.diff(span) != np.timedelta64(1, 'D')):
        raise ValueError('Reference dates are not contiguous in the release')
    field = np.asarray(release.fields[TARGET_CHANNEL], dtype='float32')
    return np.array(field[begin:stop + 1], dtype='float32', copy=True)


__all__ = [
    'CHANNELS',
    'EarthOzoneWindows',
    'MINIMUM_SCALE',
    'NORMALIZATION_METHOD',
    'OPTIONAL_CHANNELS',
    'SCHEMA',
    'SPLITS',
    'TARGET_CHANNEL',
    'TARGET_CHANNEL_INDEX',
    'UNITS',
    'canonical_input_channels',
    'fit_normalization',
    'input_units',
    'load_earth_dataset',
    'normalize_cube',
    'reference_ozone',
    'release_date_index',
    'release_split_codes',
    'split_days',
    'stack_release_cube',
    'validate_dataset',
    'validate_normalization',
]
