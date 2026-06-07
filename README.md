<div align="center">

<img src="https://github.com/alexmarqs/rollbackit/blob/main/.github/assets/rollbackit.png?raw=true" width="220px" align="center" alt="rollbackit logo" />

<h1 align="center">rollbackit</h1>

<p align="center">Type-safe, zero-dependency rollback for multi-step operations.<br/>Register an undo for each step; if anything fails, they run in reverse — automatically.</p>

<p align="center">
  <a href="https://github.com/alexmarqs/rollbackit/actions/workflows/ci.yml"><img src="https://github.com/alexmarqs/rollbackit/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/alexmarqs/rollbackit/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/rollbackit.svg" alt="license" /></a>
  <a href="https://www.npmjs.com/package/rollbackit"><img src="https://img.shields.io/npm/v/rollbackit.svg" alt="npm version" /></a>
</p>

</div>

## The problem

A multi-step operation fails halfway through and leaves a mess: a user row with
no storage bucket, a charge with no order. Cleaning up by hand means nested
`try/catch` blocks where every failure path has to remember to undo every prior
step, in the right order — and that logic drifts the moment you add a step.

**Without rollbackit** — undo logic duplicated across nested catches, easy to get wrong:

```ts
const user = await db.createUser(data);
try {
  const bucket = await storage.createBucket(user.id);
  try {
    await search.index(user);
  } catch (err) {
    await storage.deleteBucket(bucket.id);
    await db.deleteUser(user.id);
    throw err;
  }
} catch (err) {
  await db.deleteUser(user.id);
  throw err;
}
```

**With rollbackit** — each undo sits next to the step it reverses, and they all
run automatically in reverse order on any failure:

```ts
import { withRollback } from "rollbackit";

const user = await withRollback(async (rb) => {
  const created = await db.createUser(data);
  rb.add("delete user", () => db.deleteUser(created.id));

  const bucket = await storage.createBucket(created.id);
  rb.add("delete bucket", () => storage.deleteBucket(bucket.id));

  await search.index(created); // throws here? both undos run, newest-first

  return created; // success → nothing is rolled back
});
```

It's the saga / compensating-transaction pattern, distilled into one tiny
helper with no dependencies.

## Features

- 🪶 **Lightweight** — tiny footprint, **zero dependencies**.
- 🔒 **Type safe** — written in TypeScript, ships with full types.
- ↩️ **Reverse-order undo** — compensating operations run newest-first (LIFO), the right order to unwind dependent steps.
- 📦 **ESM & CJS** — works in both module systems, Node 18+.

## Install

```bash
npm install rollbackit
```

```bash
pnpm add rollbackit
```

```bash
yarn add rollbackit
```

```bash
bun add rollbackit
```

## Usage

### `withRollback` (recommended)

Wraps your steps in a scope (see [the example above](#the-problem)). If the
callback succeeds, the scope is committed and nothing is rolled back. If it
throws, the registered operations run automatically in reverse order before the
**original error is re-thrown**. Steps with no side effect to undo simply don't
register an `add`.

Because the original error propagates, `withRollback` does not return the
rollback failures. Pass `onRollbackError` to observe them (log, alert, metrics):

```ts
await withRollback(
  async (rb) => {
    /* ... */
  },
  {
    onRollbackError: ({ failures, pending }) =>
      logger.warn("rollback incomplete", { failures, pending }),
  },
);
```

### `createRollback` (manual control)

When you need to drive the lifecycle yourself:

```ts
import { createRollback } from "rollbackit";

const rb = createRollback();

try {
  const created = await db.createUser(data);
  rb.add("delete user", () => db.deleteUser(created.id));

  await storage.createBucket(created.id);
  rb.add("delete bucket", () => storage.deleteBucket(created.id));

  rb.commit(); // all good — keep the changes
} catch (error) {
  const { failures } = await rb.rollback(); // undo in reverse order
  if (failures.length) {
    logger.warn("rollback incomplete", failures); // operations that threw while undoing
  }
  throw error;
}
```

### Committing early (point of no return)

`commit()` doesn't have to run at the end. Call it mid-flow at the **pivot** —
the step after which undoing the earlier work would be wrong (money moved, an
event was published, an irreversible action happened). Everything registered so
far is sealed; a later failure rolls *forward* (retry, alert), never back.

```ts
const rb = createRollback();

try {
  const order = await db.createOrder(data);
  rb.add("delete order", () => db.deleteOrder(order.id));

  await inventory.reserve(order);
  rb.add("release stock", () => inventory.release(order));

  // Pivot: once the card is charged, we're committed to fulfilling —
  // rolling back the order now would be worse than the inconsistency.
  await payment.charge(order);
  rb.commit(); // seal everything; do not roll back from here

  // Post-pivot work. If this throws, rollback() is a no-op — handle it forward.
  await email.sendReceipt(order);

  return order;
} catch (error) {
  await rb.rollback(); // only undoes if we threw *before* commit (before charging)
  throw error;
}
```

`commit()` is all-or-nothing — it discards the whole undo log. To keep *part* of
the work reversible past this point, nest a separate `withRollback` for that
part rather than committing.

## API

### `createRollback(): Rollback`

Creates a rollback instance.

| Member | Type | Description |
| --- | --- | --- |
| `add(description, rollback)` | `(string, () => Promise<void>) => void` | Register a rollback operation. Throws `RollbackCommittedError` if called after `commit`/`rollback`. |
| `commit()` | `() => void` | Mark the work as successful and discard the undo log. Safe to call multiple times. |
| `rollback(options?)` | `(options?: RollbackOptions) => Promise<RollbackResult>` | Run the registered operations in reverse order. Returns the failures and any `pending` (un-run) operations. Safe to call multiple times; subsequent calls are no-ops. |
| `size` | `number` | Number of registered operations (read-only). |
| `operations` | `readonly RollbackOperation[]` | Snapshot of currently registered operations (read-only). |

`RollbackOptions`:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `stopOnRollbackError` | `boolean` | `false` | Stop at the first rollback operation that throws instead of unwinding the rest. |

`RollbackResult`:

| Field | Type | Description |
| --- | --- | --- |
| `failures` | `readonly FailedRollback[]` | Operations that threw while rolling back. |
| `pending` | `readonly RollbackOperation[]` | Operations never run because `stopOnRollbackError` halted early (carries the `rollback` fns, so you can log or retry them). Empty unless an early stop occurred. |

### `withRollback<T>(fn, options?): Promise<T>`

Runs `fn(rollback)` within a scope: commits on success, rolls back in reverse
order on failure (then re-throws the original error). `WithRollbackOptions`
extends `RollbackOptions` with:

| Option | Type | Description |
| --- | --- | --- |
| `onRollbackError` | `(result: RollbackResult) => void` | Called with the `RollbackResult` when `fn` throws and one or more rollback operations also throw while unwinding. Observation hook — it must not throw; any error it throws is ignored so it can't mask the original error. |

## Behavior notes

- **Reverse order** — rollbacks run newest-first (LIFO), the correct order to unwind dependent steps.
- **Failures don't stop the sequence** — by default a throwing rollback operation is collected into `result.failures` and the remaining operations still run. Set `stopOnRollbackError: true` to halt at the first failure; the older, un-run operations are returned in `result.pending` (use this only when compensations are ordered dependencies).
- **Idempotent lifecycle** — once committed or rolled back, the instance is finalized; further `add` calls throw `RollbackCommittedError`. Repeat `commit`/`rollback` calls are safe no-ops.


## Contributing

Contributions are welcome! Please open an issue or pull request.

## License

[MIT](./LICENSE) © [Alexandre Marques](https://github.com/alexmarqs)
