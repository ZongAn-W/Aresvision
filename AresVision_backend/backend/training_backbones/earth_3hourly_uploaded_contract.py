"""Independent, versioned contract for server-fed Earth three-hour models."""

from itertools import combinations

DATASET_ID = "earth_merra2_3hourly_v1"
CONTRACT_SCHEMA = "aresvision_earth_3hourly_uploaded_model_v1"
IMPLEMENTATION_ID = "aresvision_earth_3hourly_uploaded_runner_v1"
TILE_SHAPE = (24, 48)
FULL_GRID_CONTRACT_SCHEMA = "aresvision_earth_3hourly_fullgrid_model_v2"
FULL_GRID_IMPLEMENTATION_ID = "aresvision_earth_3hourly_fullgrid_runner_v2"
FULL_GRID_SHAPE = (240, 480)
SUPPORTED_CONTRACT_SCHEMAS = frozenset({CONTRACT_SCHEMA, FULL_GRID_CONTRACT_SCHEMA})
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
FULL_GRID_FEED = {**FEED, "schema": FULL_GRID_CONTRACT_SCHEMA,
                  "spatial_tile_shape": list(FULL_GRID_SHAPE)}
RESERVED_PARAMETERS = frozenset({
    *FEED, "dataset_id", "dataset_version", "dataset_fingerprint", "dataset_snapshot",
    "fingerprint", "snapshot", "version", "data_dir", "data_path", "dataset_dir", "dataset_path",
    "data_directories", "data_binding", "dataset_binding", "dataset_identity_status",
    "training_dataset", "planet", "data_source",
    "in_channels", "height", "width", "selected_channels", "target_channel",
    "global_grid_shape", "device", "normalization", "contract_schema", "implementation_id",
})
EVAL_BATCH_POLICY = "earth_eval_sample_independent_v1"


def contract_profile(schema=CONTRACT_SCHEMA):
    if schema not in SUPPORTED_CONTRACT_SCHEMAS:
        raise ValueError("Unsupported Earth three-hour uploaded model schema")
    full_grid = schema == FULL_GRID_CONTRACT_SCHEMA
    return {"schema": schema, "shape": FULL_GRID_SHAPE if full_grid else TILE_SHAPE,
            "implementation_id": FULL_GRID_IMPLEMENTATION_ID if full_grid else IMPLEMENTATION_ID,
            "full_grid": full_grid, "default_batch_size": 1 if full_grid else 8,
            "max_batch_size": 64,
            "probe_window": 2 if full_grid else 56,
            "probe_horizon": 1 if full_grid else 24}


def contract_schema_from_spec(model_spec):
    feed = (model_spec.get("datasets") or {}).get(DATASET_ID) or {}
    schema = feed.get("schema")
    contract_profile(schema)
    return schema


def contract_schema_from_source(source):
    """Read only a literal schema declaration; never execute uploaded code here."""
    import ast

    def field(node, key):
        if not isinstance(node, ast.Dict):
            raise ValueError("Earth MODEL_SPEC must declare its dataset schema literally")
        matches = [value for name, value in zip(node.keys, node.values)
                   if isinstance(name, ast.Constant) and name.value == key]
        if len(matches) != 1:
            raise ValueError(f"Earth MODEL_SPEC must declare one {key!r} field")
        return matches[0]

    assignments = [node.value for node in ast.parse(source).body if isinstance(node, ast.Assign)
                   and any(isinstance(name, ast.Name) and name.id == "MODEL_SPEC" for name in node.targets)]
    if len(assignments) != 1:
        raise ValueError("Earth source must export one MODEL_SPEC assignment")
    schema = ast.literal_eval(field(field(field(assignments[0], "datasets"), DATASET_ID), "schema"))
    contract_profile(schema)
    return schema


def contract_schema_for_reference(reference):
    """Use the isolated validator's frozen schema, with v1 legacy fallback."""
    schema = reference.get("contract_schema") or CONTRACT_SCHEMA
    contract_profile(schema)
    try:
        declared = contract_schema_from_source(reference.get("source_text"))
    except (ValueError, TypeError, SyntaxError):
        # Valid MODEL_SPEC declarations may use constants or compose dictionaries.
        # The hash-verified model build checks the executed declaration again.
        declared = None
    if declared is not None and declared != schema:
        raise ValueError("Frozen model schema disagrees with its source")
    return schema


def prepare_model(model, *, window, contract_schema=CONTRACT_SCHEMA):
    """Use the same floating-point/device setup for admission and reconstruction."""
    import torch

    if not isinstance(model, torch.nn.Module):
        raise ValueError("build_model(config) must return torch.nn.Module")
    model.to(device="cpu", dtype=torch.float32)
    profile = contract_profile(contract_schema)
    model._aresvision_earth_3hourly_contract = contract_schema
    model._aresvision_earth_spatial_shape = profile["shape"]
    model._aresvision_earth_window = window
    return model


def build_config(order, params=None, *, window=56, horizon=24, contract_schema=CONTRACT_SCHEMA):
    from services.earth_training_contract import earth_training_profile
    profile = earth_training_profile(DATASET_ID, {'window': window, 'horizon': horizon})
    order = list(order)
    if not order or order[0] != "TO3" or order != [c for c in CHANNELS if c in order]:
        raise ValueError("Earth three-hour channels must be unique and canonical with TO3 first")
    if len(order) != len(set(order)) or any(c not in CHANNELS for c in order):
        raise ValueError("Unsupported Earth three-hour channel order")
    params = dict(params or {})
    execution = contract_profile(contract_schema)
    if any(key in RESERVED_PARAMETERS or key.startswith("_") for key in params):
        raise ValueError("Custom parameters cannot override the server Earth contract")
    return {
        **params, "dataset_id": DATASET_ID, "contract_schema": contract_schema,
        "in_channels": len(order), "selected_channels": order, "target_channel": "TO3",
        "window": profile['window'], "horizon": profile['horizon'],
        "height": execution["shape"][0], "width": execution["shape"][1],
        "global_grid_shape": [240, 480], "spatial_tile_shape": list(execution["shape"]),
    }


def channel_orders():
    return [["TO3", *subset] for count in range(5) for subset in combinations(CHANNELS[1:], count)]


def forward(model, inputs, *, horizon=24):
    import torch

    shape = contract_profile(getattr(model, '_aresvision_earth_3hourly_contract', CONTRACT_SCHEMA))["shape"]
    if (not isinstance(inputs, torch.Tensor) or inputs.dtype != torch.float32
            or inputs.ndim != 5 or inputs.shape[0] < 1
            or inputs.shape[1] != getattr(model, '_aresvision_earth_window', inputs.shape[1])
            or not 1 <= inputs.shape[1] <= 240 or not 1 <= inputs.shape[2] <= 5
            or tuple(inputs.shape[-2:]) != shape or not torch.isfinite(inputs).all()):
        raise ValueError(f"Earth three-hour input must be finite float32 [B,window,C,{shape[0]},{shape[1]}]")
    output = model(inputs)
    expected = (inputs.shape[0], horizon, 1, *shape)
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
    execution = contract_profile(getattr(model, '_aresvision_earth_3hourly_contract', CONTRACT_SCHEMA))
    if batch_size > execution["max_batch_size"]:
        raise ValueError(f"Full-grid Earth batch size cannot exceed {execution['max_batch_size']}")
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
            batches = {1, 2, batch_size} if execution["full_grid"] else {2, 3, batch_size}
            for batch in sorted(batches):
                inputs = torch.randn((batch, window, channels, *execution["shape"]), generator=generator, dtype=torch.float32)
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


def dry_run(build_model, order, params, *, window=56, horizon=24, batch_size=8, contract_schema=CONTRACT_SCHEMA):
    import torch

    execution = contract_profile(contract_schema)
    model = prepare_model(build_model(build_config(order, params, window=window, horizon=horizon,
                                                   contract_schema=contract_schema)),
                          window=window, contract_schema=contract_schema)
    if not any(p.requires_grad for p in model.parameters()):
        raise ValueError("Earth training requires trainable model parameters")
    validate_eval_batch_independence(model, window=window, channels=len(order), horizon=horizon, batch_size=batch_size)
    generator = torch.Generator().manual_seed(1107)
    batches = tuple(dict.fromkeys((1, batch_size, 2))) if execution["full_grid"] else (1, 2)
    for batch in batches:
        inputs = torch.randn((batch, window, len(order), *execution["shape"]), generator=generator, dtype=torch.float32)
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
