---
"rollbackit": major
---

Trim the rollback instance to its core surface: `add`, `commit`, `rollback`.

Removed the `operations` and `size` getters. `operations` leaked the live `rollback` callbacks for every registered operation, inviting them to be invoked out of band and bypass the LIFO/finalize guarantees. `size` had no internal consumer and no use case not already covered (rolling back an empty batch is already a no-op). The legitimate "what's left to undo" need is still served by `RollbackResult.pending` after an early `stopOnFailure` stop.
