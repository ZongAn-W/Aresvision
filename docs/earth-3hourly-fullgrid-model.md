# Earth Three-Hour Full-Grid Models v2

An opt-in uploaded-model contract for `earth_merra2_3hourly_v1`. The model receives
the complete global map in one call. Existing v1 tile models remain supported.
Download [the PyTorch template](earth-3hourly-fullgrid-model-template.py) and upload
it as a new model; changing an existing uploaded source invalidates its hash.

| Property | Full-Grid Contract |
| --- | --- |
| Schema | `aresvision_earth_3hourly_fullgrid_model_v2` |
| Implementation | `aresvision_earth_3hourly_fullgrid_runner_v2` |
| Input | finite float32 `[B,window,C,240,480]` |
| Output | finite float32 `[B,horizon,1,240,480]`, same input device |
| Channels | TO3 first, then selected U10M, V10M, T2M, SWGDN in order |
| Batch | 1-64 complete global time windows, default 1 |
| Time | 1-240 three-hour UTC steps for window and horizon |
| Normalization | Training-only statistics and frozen task partitions |
| Evaluation | All validation/test windows and global grid cells, DU metrics |

The feed uses the same fields as v1, with the v2 schema and
`spatial_tile_shape=[240,480]`. This retained field name describes the actual call
size; v2 does not spatially subdivide inputs, outputs or diagnostic permutations.
No coordinates, separate time embeddings or halo arguments are supplied.

The SimVP template has lighter defaults: spatial hidden dimension 8, temporal
hidden dimension 16 and 2 temporal blocks. Original 32/64/3 parameters remain
available. The model receives full maps, but this alone does not guarantee global
receptive fields, physically conserved transport or a spherical solution.
Conv2d longitude padding is circular; latitude padding and the transposed
decoder retain ordinary numerical boundaries. Surface winds are optional inputs.
Start with batch 1 and measure memory for the requested windows before increasing
to 2, 4 or 8. The batch ceiling is the platform parameter limit, not a guarantee
that a model or GPU can hold 64 global windows. The server never
silently reduces resolution, batch or precision when a task runs out of memory.

Upload checks all 16 channel combinations on complete maps, using declared short
windows 2->1 when available, otherwise the first declared values. Reports record
`validation_scope=declared_channels_probe_windows`; admission is not proof for
every time configuration. Creating each task separately checks its actual
window/horizon, channel subset, batch and parameters, including backward, finite
gradients and eval sample independence, including the requested batch rather than
only the upload's small probes. This isolated CPU check does not guarantee CUDA
memory capacity. Larger batches can take longer or exhaust memory during validation.
The configured isolated process budget is
`USER_MODEL_VALIDATION_TIMEOUT_SECONDS`. Unknown or failed checks prohibit training.

The server freezes the schema in the model reference and
`_earth_uploaded_contract_schema`. Source, task, saved build configuration and
checkpoint schema must agree. The three-hour artifact container stays compatible,
while the v2 model implementation and full spatial call size are independently
recorded. Strict reload and eval independence use full maps. The parent completion
and recovery check use the configured validation budget for v2; v1 retains its
separate 30-second checkpoint gate. Old weights are not automatically promoted.

The normalized cache is time-major `[time,C,240,480]`, tagged
`earth_full_grid_v1` with explicit schema/version, data identity and normalization.
Temporal windows are read as needed, without expanding overlapping windows into
a second dataset. Preparation reuses shared validation proofs, train-only statistics, and content-addressed full-grid or tile caches. Changing model parameters, batch size, learning rate, or epochs does not rebuild the normalized volume; changing windows only rebuilds it when the actual training interval changes. Logs show hit/miss status, chunk progress, integrity checks, and stage times. See [preparation cache](earth-preparation-cache.md).
One temporal origin is one sample, rather than 100 spatial samples. This changes
the optimization batch composition even when the loss still weights all pixels.

Historical prediction uses one model call per origin. Diagnostics/PFI process one
complete origin at a time, preserve whole-window channel permutation and DU
metrics, and keep at most the recipient/source windows resident. The final global
evaluation covers all selected leads/cells. V1 continues using spatial tiles.

The local 8 GB RTX 4060 passed a synthetic float32 20->20, five-channel, batch-1
forward/backward probe with 32/64/3 parameters. This short GPU-only probe is not an
end-to-end speed, convergence or real-data accuracy acceptance result. Measure
memory and throughput for the selected model and task configuration.

See [task partitions](earth-task-splits.md), [metrics](earth-evaluation-metrics.md)
and [v1 compatibility](earth-3hourly-uploaded-model.md).
