# Uploaded Model MOLA Topography Input Design

## Goal

Extend the existing uploaded-model auxiliary-input contract with an optional
static MOLA topography tensor while preserving every current `forward(x)` and
`forward(x, ls)` model unchanged.

The platform will ship a verified 36 x 72 MOLA global elevation asset and use
the actual latitude and longitude coordinates of each training dataset to
align that asset for upload validation, training, validation, final metrics,
test evaluation, permutation importance, and formal prediction.

## Uploaded Model Contract

`MODEL_SPEC.auxiliary_inputs` may be absent or may contain only `ls`, only
`topography`, or both. Each declared entry must exactly equal its canonical
metadata:

```python
LS_AUXILIARY_INPUT = {
    "required": True,
    "shape": ["batch", "window"],
    "dtype": "float32",
    "unit": "degree",
}

TOPOGRAPHY_AUXILIARY_INPUT = {
    "required": True,
    "shape": ["batch", 1, "height", "width"],
    "dtype": "float32",
    "unit": "meter",
}
```

Normalized metadata, rather than the Python function signature, selects one
of four fixed calls:

```python
model(x)
model(x, ls)
model(x, topography)
model(x, ls, topography)
```

The argument order is always `x`, then declared `ls`, then declared
`topography`. The dispatcher never inspects a callable signature, catches a
`TypeError` to select another call, or retries a failed invocation. Undeclared
inputs are never passed.

`build_model(config)`, the meaning of `in_channels`, the output contract
`[batch, horizon, 1, height, width]`, losses, metrics, and saved model weights
remain unchanged. Topography is not registered on uploaded models as a buffer
and therefore does not alter their `state_dict`.

## Components And Responsibilities

### MOLA asset module

A focused module under `backend/training_backbones` will own:

- loading and validating the packaged MOLA NetCDF asset;
- validating one-dimensional source and target coordinates;
- periodic longitude normalization and seam-free interpolation;
- latitude-order-independent interpolation that preserves target order;
- producing one static `torch.float32` tensor with shape `[1, H, W]`;
- expanding the static tensor to `[B, 1, H, W]` immediately before dispatch.

The static tensor is moved to the execution device once per loaded model and
expanded with `Tensor.expand`, so dataset samples and batches do not duplicate
the global terrain grid.

### Uploaded model contract module

`uploaded_model_contract.py` remains the single source of truth for normalized
auxiliary metadata, runtime tensor validation, and all uploaded-model calls.
It will expose explicit `requires_ls` and `requires_topography` checks and a
four-way `run_uploaded_model` dispatcher.

For topography, the dispatcher validates that the expanded value is a floating
point `torch.Tensor`, is four-dimensional, exactly matches
`(x.shape[0], 1, x.shape[-2], x.shape[-1])`, and contains only finite values.
The platform-generated value is `float32`; the runtime check accepts only the
canonical platform value and does not coerce user-provided invalid data.

### Dataset preparation

The uploaded-model data loader will preserve the real target grid in addition
to its existing tensors. It reads `lat` or `latitude` and `lon` or `longitude`
from the NetCDF files that provide the target ozone field. It verifies:

- both coordinates exist when topography is required;
- both are one-dimensional, finite, and non-empty;
- latitude and longitude lengths match the target field dimensions;
- latitude is strictly monotonic;
- longitude values identify unique positions modulo 360 degrees and cover one
  complete global period;
- every contributing file for a dataset uses the same spatial grid.

OpenMars and MCD overview data retain their file coordinates. Raw MCD data
continues to convert its 37 latitude-edge rows to the existing 36 center rows;
the returned target coordinates describe that transformed 36 x 72 field.
Selected MCD features are checked against the target field grid rather than
assumed aligned solely because their array dimensions match.

Legacy callers retain their current `prepare_tensors` return form. Uploaded
training and inference opt into the additional target-coordinate return.

### Training and inference orchestration

Training first prepares tensors and target coordinates, builds the uploaded
model, and reads its normalized contract. Only a model declaring topography
causes the MOLA asset to be loaded and resampled. The resulting static tensor
is validated before the first epoch and reused for training, validation, and
final metric evaluation.

The inference service uses the same dataset preparation, MOLA module, and
uploaded-model dispatcher for formal prediction, full test-set metrics, test
results, error-distribution inputs, and permutation importance. It does not
implement a second interpolation or dispatch path.

Permutation importance changes only the selected ordinary `x` channel. The
matching Ls batch and the static topography tensor remain unchanged across the
baseline and every permutation call.

## MOLA Platform Asset

The authoritative source is the NASA Planetary Data System Geosciences Node
Mars Global Surveyor MOLA Mission Experiment Gridded Data Record:

- product: `MEGT90N000CB`, global topography;
- archive: `MGS-M-MOLA-5-MEGDR-L3-V1`;
- source resolution: 4 pixels per degree;
- source files: `megt90n000cb.img` and `megt90n000cb.lbl`;
- source landing page:
  `https://pds-geosciences.wustl.edu/missions/mgs/megdr.html`.

A reproducible script downloads the PDS label and image, verifies their
expected metadata and byte count, decodes the image according to the label,
converts elevation to meters, and aggregates/samples it onto the platform's
5-degree global coordinate grid. Longitude processing is periodic, including
the bin centered at -180 degrees. The generated asset is a compressed NetCDF
file committed under the backend's project data assets; the downloaded PDS
source files are not committed.

The generated NetCDF contains:

- `elevation(latitude, longitude)`, `float32`, unit `meter`, shape `[36, 72]`;
- `latitude`, `float32`, shape `[36]`, ordered 87.5 to -87.5 degrees;
- `longitude`, `float32`, shape `[72]`, ordered -180 to 175 degrees;
- source archive, product name, source URLs, source resolution, preprocessing
  method, generation timestamp, and source checksum attributes.

The build fails if decoded or generated values are non-finite, coordinates are
invalid, longitude coverage is incomplete, dimensions differ from 36 x 72, or
the source metadata does not match the expected product. A separate validation
mode verifies a previously generated asset without downloading the source.

## Spatial Resampling

Runtime alignment is coordinate-based even when source and target arrays have
the same dimensions. The interpolation algorithm:

1. validates source elevation against source latitude and longitude lengths;
2. sorts source latitude internally into ascending order;
3. normalizes source longitudes into a common 360-degree interval and sorts
   them without duplicates;
4. adds wrapped longitude columns on both sides of the interpolation domain;
5. normalizes target longitude values into that periodic domain;
6. evaluates bilinear interpolation on the Cartesian latitude/longitude grid;
7. emits rows and columns in the target coordinates' original order;
8. verifies output shape `(len(target_latitude), len(target_longitude))` and
   rejects any NaN or infinity.

This rule has no array-only crop or resize fallback. Target coordinates outside
the MOLA latitude domain, non-rectilinear coordinates, incomplete longitude
coverage, or other unalignable grids fail explicitly.

The packaged source asset is currently 36 x 72 because all supported platform
training grids resolve to that 5-degree grid. The resampler nevertheless uses
coordinates and can produce a different `H x W` tensor for a valid future
rectilinear target grid; its physical detail remains limited by the packaged
5-degree source asset.

## Dry-Run Behavior

Upload validation continues to use the existing small synthetic `x` tensor for
ordinary and Ls-only models. When topography is declared, validation loads the
real packaged MOLA asset and resamples it to a deterministic small global
rectilinear dry-run grid matching `x.shape[-2:]`. It passes that real terrain
through the same dispatcher used at runtime. It never supplies zeros, random
terrain, `None`, or a flat fallback.

Consequently, a topography model cannot pass upload validation when the asset
is missing or invalid. A model that does not declare topography does not touch
the asset and remains valid in an installation where MOLA was not loaded.

## Errors And Preflight

Before training or inference for a declared topography model, the platform
checks the asset, variables, coordinates, interpolation result, static tensor,
expanded batch tensor, spatial dimensions, dtype, and finite values. Failures
use `FileNotFoundError` for an absent asset and `ValueError` for invalid data or
alignment.

Messages include the execution context and relevant evidence: asset path,
variable or metadata field, expected value, actual value, source shape, target
shape, and target coordinate lengths. Metadata errors name the exact
`MODEL_SPEC.auxiliary_inputs.<name>.<field>` path and show expected and actual
values. No error path silently substitutes terrain.

Ls validation remains unchanged. A model declaring both inputs must pass both
independent preflight checks before its first call.

## Upload Template And Guide

The executable template retains `def forward(self, x)`. Comment-only opt-in
examples add:

- canonical topography-only metadata;
- canonical combined Ls and topography metadata;
- `forward(self, x, topography)`;
- `forward(self, x, ls, topography)`;
- the exact topography shape, `float32` dtype, and meter unit;
- a small terrain encoder and a fusion example that does not insert terrain
  into a fixed `x` channel.

Tests parse the template AST and prove that the executable default signature
still has only `self` and `x`.

## Test Strategy

Focused contract tests cover all four dispatch combinations, fixed argument
order, strict metadata, undeclared-input omission, topography tensor type,
rank, dtype, shape, spatial alignment, finite values, and changing batch size.
They verify that `window != horizon` never adds a time dimension to terrain.

MOLA unit tests build small deterministic NetCDF fixtures and cover missing
files, missing variables, invalid coordinates, NaN, infinity, ascending and
descending target latitude, periodic longitude interpolation across -180/180,
absence of a seam, same-size grids with different coordinates, and multiple
target heights and widths. The committed platform asset receives a separate
integrity test for exact variables, shapes, dtype, units, finite data, global
coverage, and provenance attributes.

Integration tests record model arguments across upload dry-run, training,
validation, final metrics, test-set evaluation, formal prediction, and
permutation importance. They prove legacy models receive only `x`, Ls models
receive only `x, ls`, terrain is shared rather than repeated through the
window, and permutation importance preserves the matching Ls and topography.

Regression verification runs the focused uploaded-model suites, current upload
script tests, training and prediction contract suites, then the complete
backend test suite. It also runs the MOLA asset validator and checks the
generated asset checksum/provenance against the committed file.

## Compatibility Summary

- Existing `forward(x)` and `forward(x, ls)` source files need no changes.
- Models without a topography declaration never load or receive MOLA data.
- Topography is static, independent of time, and never added to `x` channels.
- `build_model(config)`, weights, UI, training parameters, losses, metrics, and
  output formatting remain unchanged.
- Training and every uploaded-model inference/analysis path share one explicit
  metadata-driven dispatcher and one coordinate-based MOLA resampling rule.
