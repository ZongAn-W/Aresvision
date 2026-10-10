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
every time configuration. Task creation reuses the report saved by upload or
manual revalidation. It checks ownership, valid status, evidence for the concrete
dataset/schema, the source hash, parameter schema and valid batch range, then
freezes the source, schema and parameters and queues the task. It does not repeat
an isolated dry-run for the task's actual window/horizon, channel subset, batch or
parameters. Training still checks outputs and finite gradients, and checkpoint
strict reload still checks eval sample independence with the saved batch.
The upload's isolated CPU check does not guarantee CUDA memory capacity or that
every task configuration can run.
Upload/revalidation uses `USER_MODEL_VALIDATION_TIMEOUT_SECONDS` (default 120
seconds). Explicit `earth_probe` calls can still check a complete configuration;
the full-grid probe uses the larger of that budget and
`USER_MODEL_FULL_GRID_VALIDATION_TIMEOUT_SECONDS` (default 300 seconds); both must
be positive integers. This full-grid budget is retained for explicit probes and
is not used during task creation. The probe receives the frozen schema from the
upload report and checks it against the executed model declaration. Explicit
validator budgets, including short test timeouts and the in-process `None`
override, keep their original semantics. Tile/Mars checks keep the ordinary
budget. Unknown or failed saved upload reports prohibit training.

An available upload report covers its declared short windows, not an arbitrary
20->20 configuration or requested batch. An explicit probe timeout is reported as
`uploaded_model_validation_timeout`: the actual configuration has not finished
validation; it is not proof of incompatibility. The parent
drains the validation result before joining the child so reports larger than the
Windows process pipe do not cause false timeouts. A result alone is insufficient:
the child must exit successfully within the same deadline. Infinite model code
and hung process exit still terminate at the deadline.

Historical 2026-10-10 isolated CPU admission measurements, made while task
creation still ran a configuration probe, used the stored full-grid
SimVP source with five channels, 20->20 and parameters 8/16/2/0.1. Batch 8
completed in 45.46 seconds under the original 120-second budget; batch 32 timed
out after 120.56 seconds, then passed the complete check in 234.64 seconds under
the new default 300-second task budget. The screenshot does not reveal the
requested batch/parameters, so these runs reproduce the budget failure for the
stored model, not its exact screenshot configuration. Larger batches may still
time out or exhaust CPU/GPU memory. This is a budget correction, not a measured
compute speedup; the tests use synthetic tensors and create no training task,
read no release data, upload no model and publish no checkpoint. A separate
large-report regression covers the pipe issue; the stored model's normal report
is smaller than the Windows pipe and does not establish that issue as its cause.
Validation covered 158 upload/admission/tile-regression tests plus seven focused
deadline/explicit-budget/report tests (partly overlapping). No real training was
started; defaults still cannot guarantee that every full-grid configuration fits
an explicit probe's validation budget or device memory. These measurements describe
the previous admission flow; task creation now reuses the saved upload report.

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
