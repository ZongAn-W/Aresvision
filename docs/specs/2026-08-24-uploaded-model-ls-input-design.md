# Uploaded Model Ls Input Compatibility Design

## Goal

Extend the uploaded-model contract so a model may explicitly require an independent solar-longitude input, `ls`, while every existing single-input model continues to run without changes.

## Contract

Legacy uploaded models omit `MODEL_SPEC.auxiliary_inputs` and keep the existing interface:

```python
def forward(self, x):
    ...
```

Models that need solar longitude declare exactly this metadata:

```python
MODEL_SPEC = {
    "name": "ExamplePhaseModel",
    "description": "...",
    "auxiliary_inputs": {
        "ls": {
            "required": True,
            "shape": ["batch", "window"],
            "dtype": "float32",
            "unit": "degree",
        }
    },
    "parameters": {},
}
```

They implement:

```python
def forward(self, x, ls):
    ...
```

The validator rejects unknown auxiliary-input names and any `ls` declaration that does not exactly match the required keys and values above. Dispatch is based only on normalized metadata. It never probes the function signature and never catches `TypeError` to retry a different call.

The existing `build_model(config)` interface and output shape `[batch, horizon, 1, height, width]` remain unchanged.

## Architecture

`backend/training_backbones/user_model_runner.py` owns the runtime uploaded-model contract. It will provide focused helpers to:

- normalize and validate `MODEL_SPEC.auxiliary_inputs`;
- retain the normalized contract on a loaded uploaded model;
- validate an `ls` tensor against the current `x` batch;
- call either `model(x)` or `model(x, ls)` from explicit metadata.

All uploaded-model execution paths use this helper, including training, validation, test evaluation, formal prediction, prediction analysis, permutation importance, and upload dry-run. Official models retain their existing independent execution path.

`backend/services/user_model_validator.py` applies the same contract normalization during upload validation. Its dry-run constructs a finite `float32` tensor with shape `[2, 3]` only when the model declares `ls`; legacy dry-runs continue to pass only `x`.

No database migration or frontend change is required. Runtime behavior is derived from the uploaded source's explicit `MODEL_SPEC` whenever the model is loaded.

## Data Flow

The dataset preparation path preserves the timeline Ls values and builds samples with a shared start index:

```text
x_window  = x[i:i + window]
ls_window = ls[i:i + window]
y_window  = y[i + window:i + window + horizon]
```

Consequently, `ls_window` always has length `window`; it is independent of `horizon`, including when `window != horizon`.

For a model that requires Ls, training and evaluation datasets carry `(x, ls, y)` and each loop validates and calls the model through the shared helper. A legacy model retains `(x, y)` batches and never receives an additional positional argument.

Raw Ls values used as auxiliary input are converted to `torch.float32` without replacing `NaN` or infinity. Existing feature and target cleaning, scaling, losses, metrics, and output conversion are unchanged.

Ordinary models do not require an Ls tensor solely for model dispatch. Data sources without Ls remain usable where the selected feature-loading path itself does not depend on solar longitude. Existing OpenMars-to-MCD feature interpolation may still require Ls as part of its established data-alignment behavior; this feature does not invent a replacement timeline.

## Validation And Errors

Before a required-Ls model begins training or performs prediction, the shared validator checks:

1. Ls was provided.
2. Ls is a `torch.Tensor`.
3. Ls has a floating-point dtype.
4. Ls is two-dimensional.
5. Ls has the exact shape `(x.shape[0], x.shape[1])`.
6. Every Ls value is finite.

Failures raise `ValueError` with the execution context, expected contract, and actual property. Missing Ls is never replaced with zeroes, random values, or `None`. Metadata validation failures occur at upload validation and report the exact unsupported field or value.

## Compatibility

- Uploaded models without `auxiliary_inputs` continue to receive only `x`.
- Existing uploaded scripts require no changes.
- `build_model(config)`, training parameters, upload UI, losses, metrics, and prediction output formats do not change.
- Ls is never inserted into a fixed feature channel.
- Official-model behavior remains unchanged.

## Test Strategy

Focused unit and integration tests will demonstrate:

- a legacy model receives exactly one argument;
- a declared model receives finite `float32` Ls with shape `[batch, window]`;
- invalid or unsupported auxiliary metadata is rejected;
- missing Ls, non-tensor Ls, non-floating Ls, wrong rank, wrong window length, and `NaN`/`Inf` fail clearly;
- dry-run dispatch follows metadata;
- dataset windows align `x` and Ls by identical indices;
- `window != horizon` still produces Ls of historical-window length;
- training, validation, test evaluation, formal prediction, analysis, and permutation-importance paths use the shared dispatcher;
- current uploaded-model scripts and existing backend tests have no regressions.

Verification will run focused uploaded-model validator/runner/inference tests first, followed by the complete existing backend test suite.
