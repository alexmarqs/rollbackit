# rollbackit

## 1.1.0

### Minor Changes

- 1938483: Add `step()` and timeouts.

  - **`step(description, run, rollback, options?)`** — runs a forward action and registers its compensation in one call, registering the rollback only if the action resolves and threading its result into the rollback. Returns whatever `run` returns.
  - **Timeouts & cancellation** — bound a single `step` (`StepOptions.timeout`) or the whole operation (`WithRollbackOptions.timeout`). On timeout a `TimeoutError` (a `RollbackError` subclass) is thrown and an `AbortSignal` is fired so in-flight work can cancel; `withRollback` still unwinds whatever was registered before re-throwing. `withRollback`'s callback now receives that signal as its second argument.
  - Export `TimeoutError` and the `StepOptions` type.

## 1.0.1

### Patch Changes

- f2c5c91: Rename two public types so they match the `Rollback*` naming of their siblings and signal their scope:

  - `FailedRollback` → `RollbackFailure` (a failure record, grouping with `RollbackResult`).
  - `OperationOptions` → `RollbackOperationOptions` (the per-operation options on a `RollbackOperation`, distinct from the run-level `RollbackOptions`).

  The old names are removed (no consumers yet).

## 1.0.0

### Major Changes

- 55bfe34: Trim the rollback instance to its core surface: `add`, `commit`, `rollback`.

  Removed the `operations` and `size` getters. `operations` leaked the live `rollback` callbacks for every registered operation, inviting them to be invoked out of band and bypass the LIFO/finalize guarantees. `size` had no internal consumer and no use case not already covered (rolling back an empty batch is already a no-op). The legitimate "what's left to undo" need is still served by `RollbackResult.pending` after an early `stopOnFailure` stop.

## 0.0.2

### Patch Changes

- c798fe1: Docs improvements and badges

## 0.0.1

### Patch Changes

- 6003481: First Release
