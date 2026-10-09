# Training Queue Design

## Goal

Publishing several training tasks must execute them one at a time in FIFO order, while the task list exposes an explicit queued state and lets users cancel tasks that have not started.

## State model

`queued -> running -> completed|failed`

`queued -> cancelled`

Existing `pending` rows remain readable for compatibility, but newly published tasks use `queued`. A queued task has no process id and cannot be stopped as a running process. Cancelling a queued task keeps its database row, records the cancellation state, and removes it from scheduling. Running, completed, and failed task deletion keeps the existing behavior.

## Persistence and scheduling

The task table stores `queued_at` and a nullable `queue_position` for deterministic FIFO ordering and inspection. A single application-owned scheduler conditionally changes the oldest `queued` task to `running`, waits for its preparation and subprocess to finish, then proceeds to the next task. Cancellation uses the same conditional status transition so a task already claimed for execution cannot be cancelled as queued. The scheduler is stopped with the application lifespan.

On startup, orphaned `running` tasks follow the existing completion recovery policy: Earth checkpoints must pass strict artifact reload; Mars uses the existing saved-log/nonempty-file policy. Other interrupted runs fail. The scheduler then resumes queued tasks from the database. This execution-preparation change does not alter those completion policies.

## Execution preparation and restart

`TrainingService._prepare_training_execution` is the shared preparation module for admission, live execution and restart recovery. It derives runner selection, arguments, log/output paths and internal Earth spec from persisted task facts. There is no process-local queue plan or environment override needed to resume a task. Runner selection must match the saved dataset and model source, and parameters are parsed without silently renormalizing a saved task.

Mars transfer tasks retain the source task ID or uploaded weight ID. At actual execution, the module resolves the weight path again and checks source ownership, availability, status, a nonempty file and the existing task-model compatibility rules. Task-source access uses the task owner's **current** administrator role; administrator privileges do not allow access to another account's uploaded weights. An accepted task can therefore fail before launch if its dependency is deleted, becomes invalid, or permission is revoked while queued. Legacy tasks without a user may use userless shared task weights, but cannot use another user's private weights.

Mars uploaded models retain package ID/version, source path, parameter schema and custom parameters. New tasks also save the server-resolved source SHA-256. Execution checks the stored package's owner/valid status, version, path and file digest; old tasks lacking a frozen digest are checked against their existing package digest. It never substitutes a user's newer upload. Mars still requires its original source file; Earth retains its embedded frozen-source contract.

Earth preparation continues to rebuild the internal spec from verified dataset identity, fixed task split and frozen uploaded source. It rechecks the active release and server path, keeps new-task split requirements, and rejects retired daily datasets. It does not recompute partitions or revalidate a user's current upload in place of the frozen reference.

Preparation failures set `failed`, `end_time` and a readable `metrics.error`. Existing structured dataset errors keep their error code; other preparation errors use `training_execution_preparation_failed`. No subprocess is started, and the scheduler continues with the next queued task. No database columns or public request fields are added.

## API contract

- `POST /api/training/start` creates a `queued` task and returns its queue position.
- `GET /api/training/tasks` returns queued and cancelled states alongside existing states.
- `POST /api/training/tasks/{task_id}/cancel` cancels only a queued task; non-queued tasks return a conflict response.
- `POST /api/training/tasks/{task_id}/stop` remains for running subprocesses.

## UI behavior

The training page groups queued tasks separately, shows their queue position, and offers a cancel action. Cancelled tasks remain visible in history with a cancelled badge. The existing stop action remains available only for running tasks. Status filters and counts include queued and cancelled states.

## Verification

`tests/test_training_queue_recovery.py` exercises the real scheduler and temporary SQLite rows with a subprocess recorder: official/uploaded Mars models, task/uploaded-weight transfer sources, live/restarted execution, missing/invalid dependencies, changed permissions, FIFO, cancellation, and preparation failure followed by later tasks. Earth preparation/runner, uploaded-model and task-split tests use the shared preparation entry; existing artifact tests retain the completion gate.

Run backend files separately with the workspace's configured conda interpreter, `--asyncio-mode=auto`, `-p no:cacheprovider` and a new external English `--basetemp` for each run. The tests use synthetic data and subprocess stand-ins where stated; they do not establish real training accuracy. Frontend status/grouping/cancel behavior is unchanged.
