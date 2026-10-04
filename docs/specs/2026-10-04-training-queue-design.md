# Training Queue Design

## Goal

Publishing several training tasks must execute them one at a time in FIFO order, while the task list exposes an explicit queued state and lets users cancel tasks that have not started.

## State model

`queued -> running -> completed|failed`

`queued -> cancelled`

Existing `pending` rows remain readable for compatibility, but newly published tasks use `queued`. A queued task has no process id and cannot be stopped as a running process. Cancelling a queued task keeps its database row, records the cancellation state, and removes it from scheduling. Running, completed, and failed task deletion keeps the existing behavior.

## Persistence and scheduling

The task table stores `queued_at` and a nullable `queue_position` for deterministic FIFO ordering and inspection. A single application-owned scheduler claims the oldest queued task only when no training subprocess is running. Claiming is atomic with the status change to prevent duplicate launches. On startup, orphaned `running` tasks are marked failed and the scheduler resumes queued tasks from the database. The scheduler is stopped with the application lifespan.

## API contract

- `POST /api/training/start` creates a `queued` task and returns its queue position.
- `GET /api/training/tasks` returns queued and cancelled states alongside existing states.
- `POST /api/training/tasks/{task_id}/cancel` cancels only a queued task; non-queued tasks return a conflict response.
- `POST /api/training/tasks/{task_id}/stop` remains for running subprocesses.

## UI behavior

The training page groups queued tasks separately, shows their queue position, and offers a cancel action. Cancelled tasks remain visible in history with a cancelled badge. The existing stop action remains available only for running tasks. Status filters and counts include queued and cancelled states.

## Verification

Backend tests cover FIFO ordering, one active subprocess, cancellation rules, and startup recovery. Frontend tests cover status metadata, grouping, queue position display, and the cancel API action. README documentation describes the state model and endpoints.
