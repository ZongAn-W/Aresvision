"""Independent, versioned contract for server-fed Earth three-hour models."""

from itertools import combinations

DATASET_ID = "earth_merra2_3hourly_v1"
CONTRACT_SCHEMA = "aresvision_earth_3hourly_uploaded_model_v1"
IMPLEMENTATION_ID = "aresvision_earth_3hourly_uploaded_runner_v1"
TILE_SHAPE = (24, 48)
CHANNELS = ("TO3", "U10M", "V10M", "T2M", "SWGDN")
UNITS = ("DU", "m s-1", "m s-1", "K", "W m-2")
FEED = {
    "schema": CONTRACT_SCHEMA,
    "frequency_hours": 3, "step_unit": "hour", "step": 3, "time_zone": "UTC",
    "window": [56], "horizon": [24], "grid": [[240, 480]],
    "target": "TO3", "target_unit": "DU",
    "input_channels": list(CHANNELS), "input_units": list(UNITS),
    "dtype": "float32", "tensor_layout": "BTCHW",
    "auxiliary_inputs": list(CHANNELS[1:]), "spatial_tile_shape": list(TILE_SHAPE),
    "output_channels": ["TO3"], "output_units": ["DU"],
}
RESERVED_PARAMETERS = frozenset({
    *FEED, "dataset_id", "dataset_version", "dataset_fingerprint", "dataset_snapshot",
    "fingerprint", "snapshot", "version", "data_dir", "data_path", "dataset_dir", "dataset_path",
    "data_directories", "data_binding", "dataset_binding", "dataset_identity_status",
    "training_dataset", "planet", "data_source",
    "in_channels", "height", "width", "selected_channels", "target_channel",
    "global_grid_shape", "device", "normalization", "contract_schema", "implementation_id",
})


def build_config(order, params=None):
    order = list(order)
    if not order or order[0] != "TO3" or order != [c for c in CHANNELS if c in order]:
        raise ValueError("Earth three-hour channels must be unique and canonical with TO3 first")
    if len(order) != len(set(order)) or any(c not in CHANNELS for c in order):
        raise ValueError("Unsupported Earth three-hour channel order")
    params = dict(params or {})
    if any(key in RESERVED_PARAMETERS or key.startswith("_") for key in params):
        raise ValueError("Custom parameters cannot override the server Earth contract")
    return {
        **params, "dataset_id": DATASET_ID, "contract_schema": CONTRACT_SCHEMA,
        "in_channels": len(order), "selected_channels": order, "target_channel": "TO3",
        "window": 56, "horizon": 24, "height": 24, "width": 48,
        "global_grid_shape": [240, 480], "spatial_tile_shape": [24, 48],
    }


def channel_orders():
    return [["TO3", *subset] for count in range(5) for subset in combinations(CHANNELS[1:], count)]


def forward(model, inputs):
    import torch

    if (not isinstance(inputs, torch.Tensor) or inputs.dtype != torch.float32
            or inputs.ndim != 5 or inputs.shape[0] < 1 or inputs.shape[1] != 56 or not 1 <= inputs.shape[2] <= 5
            or tuple(inputs.shape[-2:]) != TILE_SHAPE or not torch.isfinite(inputs).all()):
        raise ValueError("Earth three-hour input must be finite float32 [B,56,C,24,48]")
    output = model(inputs)
    expected = (inputs.shape[0], 24, 1, *TILE_SHAPE)
    if (not isinstance(output, torch.Tensor) or tuple(output.shape) != expected
            or output.dtype != torch.float32 or output.device != inputs.device
            or not torch.isfinite(output).all()):
        raise ValueError(f"Earth three-hour output must be finite float32 {expected} on the input device")
    return output


def dry_run(build_model, order, params):
    import torch

    model = build_model(build_config(order, params))
    if not isinstance(model, torch.nn.Module):
        raise ValueError("build_model(config) must return torch.nn.Module")
    model.to(device="cpu", dtype=torch.float32)
    if not any(p.requires_grad for p in model.parameters()):
        raise ValueError("Earth training requires trainable model parameters")
    generator = torch.Generator().manual_seed(1107)
    for batch in (1, 2):
        inputs = torch.randn((batch, 56, len(order), *TILE_SHAPE), generator=generator)
        model.eval()
        with torch.no_grad():
            output = forward(model, inputs)
        model.train()
        model.zero_grad(set_to_none=True)
        loss = forward(model, inputs).square().mean()
        loss.backward()
        gradients = [p.grad for p in model.parameters() if p.requires_grad and p.grad is not None]
        if not gradients or any(not torch.isfinite(g).all() for g in gradients):
            raise ValueError("Earth model must produce finite training gradients")
    return list(output.shape)
