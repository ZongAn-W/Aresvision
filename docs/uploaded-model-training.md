# Uploaded Model Training

Trusted lab users can upload a single Python file from the model training page and train it with the platform datasets.

The platform owns data loading, normalization, batching, the training loop, metrics, checkpoints, logs, and model testing. The uploaded file only defines the PyTorch architecture and a small parameter schema.

## Required Exports

Every upload must export:

- `MODEL_SPEC`: metadata and adjustable parameters.
- `build_model(config)`: a callable that returns a `torch.nn.Module`.
- One or more `torch.nn.Module` classes used by `build_model`.

Use [uploaded-model-template.py](uploaded-model-template.py) as the starting point.

## Tensor Contract

The model receives tensors with this shape:

```text
[batch, window, channels, height, width]
```

It must return predictions with this shape:

```text
[batch, horizon, 1, height, width]
```

The platform passes these core config keys to `build_model(config)`:

- `in_channels`
- `window`
- `horizon`
- `height`
- `width`
- `selected_channels`

Any custom fields declared in `MODEL_SPEC["parameters"]` are also included in `config`.

## Optional Ls Input

Models that use historical solar longitude can opt into a separate `ls` tensor. The declaration must exactly match this contract:

```python
MODEL_SPEC = {
    "name": "ExamplePhaseModel",
    "description": "Model with explicit solar-longitude context.",
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

The model then accepts two inputs:

```python
def forward(self, x, ls):
    # x:  [batch, window, channels, height, width]
    # ls: [batch, window]
    ...
```

Each Ls value is measured in degrees and corresponds to the historical frame at the same window index. Ls always covers the input window, even when `window` and `horizon` differ.

Models that omit `auxiliary_inputs` remain single-input models and receive only `model(x)`. The platform does not inspect the function signature, insert Ls into a feature channel, or retry calls after `TypeError`.

For declared Ls models, the platform rejects missing data, non-floating tensors, values with the wrong `[batch, window]` shape, and any `NaN` or infinite value. It never substitutes zeros, random values, or `None` for required Ls data. Unknown auxiliary inputs and deviations from the metadata block above are rejected during upload validation.

## Optional MOLA Topography Input

Models can opt into static Mars surface elevation independently of Ls:

```python
MODEL_SPEC = {
    "name": "ExampleTopographyModel",
    "description": "Model with explicit MOLA terrain context.",
    "auxiliary_inputs": {
        "topography": {
            "required": True,
            "shape": ["batch", 1, "height", "width"],
            "dtype": "float32",
            "unit": "meter",
        }
    },
    "parameters": {},
}
```

The corresponding method is:

```python
def forward(self, x, topography):
    # x:           [batch, window, channels, height, width]
    # topography:  [batch, 1, height, width], float32 meters
    ...
```

Topography is static. It has no window dimension, is not repeated through time,
and is not included in `in_channels`. The platform reads the actual latitude
and longitude coordinates of the selected training dataset and periodically
resamples its built-in NASA/PDS MOLA grid to those coordinates. Matching array
dimensions alone are not treated as spatial alignment.

A model can declare both auxiliary inputs:

```python
MODEL_SPEC = {
    "name": "ExampleLsTopographyModel",
    "auxiliary_inputs": {
        "ls": {
            "required": True,
            "shape": ["batch", "window"],
            "dtype": "float32",
            "unit": "degree",
        },
        "topography": {
            "required": True,
            "shape": ["batch", 1, "height", "width"],
            "dtype": "float32",
            "unit": "meter",
        },
    },
    "parameters": {},
}

def forward(self, x, ls, topography):
    ...
```

Dispatch is based only on `MODEL_SPEC` and always uses this order: `x`, then
declared `ls`, then declared `topography`. The platform does not inspect the
function signature, catch `TypeError` to retry, or pass undeclared inputs.

Upload dry-run, training, validation, final metrics, test evaluation,
permutation importance, and formal prediction all use the same dispatcher.
Permutation importance shuffles only ordinary `x` features; Ls and topography
remain fixed. The static `[1, height, width]` terrain tensor is expanded to
`[batch, 1, height, width]` without copying it for each sample.

A declared topography model fails clearly if the MOLA asset is absent, corrupt,
non-finite, or cannot align to the target coordinates. There is no zero, random,
`None`, or flat-terrain fallback. Models without a topography declaration do
not load the asset. See [mola-topography-asset.md](mola-topography-asset.md) for
the source product and reproduction process.

## Parameter Schema

Supported parameter types:

- `int`: requires `default`, `min`, and `max`.
- `float`: requires `default`, `min`, and `max`.
- `bool`: requires `default`.
- `select`: requires string `default` and non-empty string `options`.

Example:

```python
MODEL_SPEC = {
    "name": "ExampleUploadedModel",
    "description": "Small convolutional baseline.",
    "parameters": {
        "hidden_dim": {"type": "int", "default": 16, "min": 4, "max": 128},
        "dropout": {"type": "float", "default": 0.1, "min": 0.0, "max": 0.9},
        "use_bias": {"type": "bool", "default": True},
        "activation": {"type": "select", "default": "relu", "options": ["relu", "gelu"]},
    },
}
```

## Validation Rules

Version 1 accepts these import roots:

- `torch`
- `numpy`

The validator rejects filesystem, subprocess, dynamic execution, and network-style escape hatches such as `open`, `eval`, `exec`, `compile`, `__import__`, `system`, `popen`, `Popen`, and `run`.

Before a model can be trained, the platform:

1. Parses the file as UTF-8 Python.
2. Checks imports and disallowed calls.
3. Imports the module in a validation process.
4. Normalizes `MODEL_SPEC["parameters"]` and validates optional auxiliary-input metadata.
5. Calls `build_model(config)`.
6. Runs a dry forward pass with x shape `[2, 3, 1, 8, 16]` and, when declared, Ls shape `[2, 3]`.
7. Requires dry-run output shape `[2, 3, 1, 8, 16]`.

## Minimal Model

```python
from torch import nn


MODEL_SPEC = {
    "name": "RepeatLastFrame",
    "parameters": {},
}


class RepeatLastFrame(nn.Module):
    def __init__(self, horizon):
        super().__init__()
        self.horizon = horizon

    def forward(self, x):
        last_frame = x[:, -1, :1]
        return last_frame.unsqueeze(1).repeat(1, self.horizon, 1, 1, 1)


def build_model(config):
    return RepeatLastFrame(config["horizon"])
```
