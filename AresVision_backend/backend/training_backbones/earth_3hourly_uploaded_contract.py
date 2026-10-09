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
EVAL_BATCH_POLICY = "earth_eval_sample_independent_v1"


def prepare_model(model, *, window):
    """Use the same floating-point/device setup for admission and reconstruction."""
    import torch

    if not isinstance(model, torch.nn.Module):
        raise ValueError("build_model(config) must return torch.nn.Module")
    model.to(device="cpu", dtype=torch.float32)
    model._aresvision_earth_3hourly_contract = CONTRACT_SCHEMA
    model._aresvision_earth_window = window
    return model


def build_config(order, params=None, *, window=56, horizon=24):
    from services.earth_training_contract import earth_training_profile
    profile = earth_training_profile(DATASET_ID, {'window': window, 'horizon': horizon})
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
        "window": profile['window'], "horizon": profile['horizon'], "height": 24, "width": 48,
        "global_grid_shape": [240, 480], "spatial_tile_shape": [24, 48],
    }


def channel_orders():
    return [["TO3", *subset] for count in range(5) for subset in combinations(CHANNELS[1:], count)]


def forward(model, inputs, *, horizon=24):
    import torch

    if (not isinstance(inputs, torch.Tensor) or inputs.dtype != torch.float32
            or inputs.ndim != 5 or inputs.shape[0] < 1
            or inputs.shape[1] != getattr(model, '_aresvision_earth_window', inputs.shape[1])
            or not 1 <= inputs.shape[1] <= 240 or not 1 <= inputs.shape[2] <= 5
            or tuple(inputs.shape[-2:]) != TILE_SHAPE or not torch.isfinite(inputs).all()):
        raise ValueError("Earth three-hour input must be finite float32 [B,window,C,24,48]")
    output = model(inputs)
    expected = (inputs.shape[0], horizon, 1, *TILE_SHAPE)
    if (not isinstance(output, torch.Tensor) or tuple(output.shape) != expected
            or output.dtype != torch.float32 or output.device != inputs.device
            or not torch.isfinite(output).all()):
        raise ValueError(f"Earth three-hour output must be finite float32 {expected} on the input device")
    return output


def validate_eval_batch_independence(model, *, window, channels, horizon, batch_size=8):
    """Reject eval outputs that depend on batch neighbours, order or call state."""
    import torch

    if type(batch_size) is not int or not 1 <= batch_size <= 64:
        raise ValueError("Earth eval batch size must be an integer between 1 and 64")
    generator = torch.Generator().manual_seed(1107)
    modes = [(module, module.training) for module in model.modules()]
    registries = [(module, group, dict(getattr(module, group)))
                  for module in model.modules() for group in ("_parameters", "_buffers")]
    state = [(module, group, name, value, value.detach().clone())
             for module, group, entries in registries for name, value in entries.items() if value is not None]

    def probe(inputs):
        output = forward(model, inputs, horizon=horizon).clone()
        if (any(getattr(module, group).keys() != entries.keys()
                or any(getattr(module, group)[name] is not value for name, value in entries.items())
                for module, group, entries in registries)
                or any(not torch.equal(value, saved) for _, _, _, value, saved in state)):
            raise ValueError("Earth eval must not mutate model parameters or buffers")
        return output

    model.eval()
    try:
        with torch.no_grad():
            for batch in sorted({2, 3, batch_size}):
                inputs = torch.randn((batch, window, channels, *TILE_SHAPE), generator=generator, dtype=torch.float32)
                inputs[1:] = inputs[1:] * 0.5 + 2.0
                together = probe(inputs)
                separate = torch.cat([probe(sample[None]) for sample in inputs])
                reordered = probe(inputs.flip(0)).flip(0)
                changed = inputs.clone()
                changed[1:] = changed[1:] * -2.0 - 3.0
                changed_output = probe(changed)
                repeated = probe(inputs)
                comparisons = ((together, separate), (together, reordered),
                               (together[:1], changed_output[:1]), (together, repeated))
                if any(not torch.allclose(left, right, rtol=1e-5, atol=1e-5) for left, right in comparisons):
                    raise ValueError("Earth eval predictions must be sample-independent across batch size, "
                                     "neighbours, order and repeated calls")
    finally:
        with torch.no_grad():
            for module, group, name, value, saved in state:
                if value.shape == saved.shape and value.dtype == saved.dtype and value.device == saved.device:
                    value.copy_(saved)
                else:
                    value.data = saved
            for module, group, entries in registries:
                getattr(module, group).clear()
                getattr(module, group).update(entries)
        for module, training in modes:
            module.training = training


def dry_run(build_model, order, params, *, window=56, horizon=24, batch_size=8):
    import torch

    model = prepare_model(build_model(build_config(order, params, window=window, horizon=horizon)), window=window)
    if not any(p.requires_grad for p in model.parameters()):
        raise ValueError("Earth training requires trainable model parameters")
    validate_eval_batch_independence(model, window=window, channels=len(order), horizon=horizon, batch_size=batch_size)
    generator = torch.Generator().manual_seed(1107)
    for batch in (1, 2):
        inputs = torch.randn((batch, window, len(order), *TILE_SHAPE), generator=generator, dtype=torch.float32)
        model.eval()
        with torch.no_grad():
            output = forward(model, inputs, horizon=horizon)
        model.train()
        model.zero_grad(set_to_none=True)
        loss = forward(model, inputs, horizon=horizon).square().mean()
        loss.backward()
        gradients = [p.grad for p in model.parameters() if p.requires_grad and p.grad is not None]
        if not gradients or any(not torch.isfinite(g).all() for g in gradients):
            raise ValueError("Earth model must produce finite training gradients")
    validate_eval_batch_independence(model, window=window, channels=len(order), horizon=horizon, batch_size=batch_size)
    return list(output.shape)
