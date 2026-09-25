# Predict Cache Identity Isolation Design

## Goal

Prevent prediction results and analysis state from crossing authentication boundaries within the SPA lifetime. A signed-in user can only restore and update their own cache, anonymous state is isolated, and no prediction cache is accessible while authentication initialization is unresolved.

## Scope Model

Prediction cache scopes are stable strings derived only from authentication identity:

- `user:<userId>` for an authenticated user with a stable ID.
- `anonymous` after authentication has definitively resolved to signed out.
- No scope while authentication is loading.

Tokens are neither cache keys nor cached values. Prediction data remains in module memory and is never written to `localStorage`.

The cache module owns two distinct state categories:

- Scoped prediction data: parameters, model and training-task selections, prediction results, metrics, error distributions, PFI, performance comparisons, multi-model results and their context keys.
- Global non-sensitive UI preferences: presentation-only settings such as view mode.

## Cache API

`predictCache.js` stores scoped entries in an in-memory `Map`. Every prediction-data read, write, validation, and clear operation requires an explicit scope. Missing or invalid scopes return an empty snapshot and reject writes, so callers cannot accidentally fall back to another identity.

Snapshots include their owning scope. Restore helpers require both the expected scope and the exact request/model context key. A scope mismatch or context mismatch produces an empty result bundle.

The module exposes a complete sensitive-state template so both cache clearing and page clearing cover the same fields. Clearing one user removes that scope's entry without touching another user's entry. A session-security clear removes the outgoing authenticated scope and leaves presentation preferences intact.

## Authentication Cleanup

An independent session cleanup module coordinates authentication-bound state without importing `AuthContext`. It clears prediction cache state for an explicit outgoing user scope and dispatches the existing global logout event when needed.

All authentication termination paths use this shared behavior:

- Active logout clears the outgoing user's scope before setting `user` and `token` to null.
- A 401 clears authentication storage and emits the global logout event; `AuthContext` handles that event through the same cleanup transition.
- Startup token validation failure clears the candidate authenticated session and leaves authentication loading until cleanup is complete.
- A user ID change clears the previous user's scope before exposing/restoring the new scope.
- Authenticated-to-anonymous transitions clear the old user scope. Anonymous cache remains a separate scope and is not restored until authentication has definitively resolved.

The cleanup helper never imports authentication code, preventing a dependency cycle between the API/authentication layer and prediction cache.

## Predict Page Lifecycle

`PredictPage` derives its scope from `{ user, isLoading }`. During authentication loading it initializes with empty sensitive state and does not read or write scoped cache.

On scope change, a layout effect runs before paint. It invalidates in-flight prediction requests, clears all sensitive component state and loading/error state, changes the active scope, and then restores only the new scope's validated snapshot. This prevents a frame containing the previous identity's data.

The sensitive reset includes:

- Single-model results, metrics, error distribution, PFI, and performance data.
- Selected trained model, comparison model selections, training task ID, and multi-model metrics/error/PFI.
- All result and analysis context keys.
- Errors, loading flags, fullscreen analysis state, and other result-bound UI state.

Presentation-only preferences such as view mode may survive the transition.

Every async prediction or analysis completion captures its starting scope. It may update React state or cache only if both the request context and active scope still match. Authentication changes invalidate outstanding requests.

## Training Task Validation

Cached trained-model and multi-model selections are provisional until the current user's completed training tasks load. The page intersects cached task IDs with the current user's accessible task IDs.

If a selected task is missing or inaccessible, the page removes that task selection and all single-model results and analysis derived from it. If any comparison task is invalid, the comparison selection is reduced to accessible IDs and all cached multi-model metrics, error distributions, PFI, keys, and loading/error state are discarded rather than partially restoring stale results.

Anonymous scope cannot restore trained-task data because no authenticated task list is available.

## Testing

Unit and structure-level tests cover:

1. User A writes data that user B cannot read or overwrite.
2. Active logout removes user A's prediction cache.
3. A 401 follows the same cleanup path.
4. Failed startup token validation does not expose stale authenticated data.
5. A user ID change causes an immediate complete page-sensitive reset.
6. Anonymous scope cannot read authenticated cache.
7. Authenticated scope cannot read anonymous prediction results.
8. User switching clears trained-model selection, task IDs, metrics, error distributions, PFI, comparison data, errors, loading flags, and all corresponding keys.
9. Cache restore requires both scope and exact request/model parameter context.
10. Missing or inaccessible training tasks invalidate related cached state.

Existing prediction request cancellation and context-consistency changes in the worktree remain intact and are extended with scope checks.
