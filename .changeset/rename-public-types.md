---
"rollbackit": patch
---

Rename two public types so they match the `Rollback*` naming of their siblings and signal their scope:

- `FailedRollback` → `RollbackFailure` (a failure record, grouping with `RollbackResult`).
- `OperationOptions` → `RollbackOperationOptions` (the per-operation options on a `RollbackOperation`, distinct from the run-level `RollbackOptions`).

The old names are removed (no consumers yet).
