---
"rollbackit": minor
---

Add `step()` and timeouts.

- **`step(description, run, rollback, options?)`** — runs a forward action and registers its compensation in one call, registering the rollback only if the action resolves and threading its result into the rollback. Returns whatever `run` returns.
- **Timeouts & cancellation** — bound a single `step` (`StepOptions.timeout`) or the whole operation (`WithRollbackOptions.timeout`). On timeout a `TimeoutError` (a `RollbackError` subclass) is thrown and an `AbortSignal` is fired so in-flight work can cancel; `withRollback` still unwinds whatever was registered before re-throwing. `withRollback`'s callback now receives that signal as its second argument.
- Export `TimeoutError` and the `StepOptions` type.
