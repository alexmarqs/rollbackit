<div align="center">

<img src="https://github.com/alexmarqs/rollbackit/blob/main/.github/assets/rollbackit.png?raw=true" width="220px" align="center" alt="rollbackit logo" />

<h1 align="center">rollbackit</h1>

<p align="center">Roll back your operations type safely when something goes wrong — simple, lightweight, zero dependencies.</p>

<p align="center">
  <a href="https://github.com/alexmarqs/rollbackit/actions/workflows/ci.yml"><img src="https://github.com/alexmarqs/rollbackit/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/alexmarqs/rollbackit/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/rollbackit.svg" alt="license" /></a>
  <a href="https://www.npmjs.com/package/rollbackit"><img src="https://img.shields.io/npm/v/rollbackit.svg" alt="npm version" /></a>
</p>

</div>

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

## Quick Start

```ts
import { withRollback } from "rollbackit";

const user = await withRollback(async (rb) => {
  const created = await db.createUser(data);
  rb.add("delete user", () => db.deleteUser(created.id));

  await storage.createBucket(created.id);
  rb.add("delete bucket", () => storage.deleteBucket(created.id));

  return created; // success → committed, nothing is rolled back
});
// if anything above throws: "delete bucket" then "delete user" run, then the error re-throws
```

## Why

When an operation is made up of several steps that each have a side effect, a
failure partway through leaves you in an inconsistent state. `rollbackit` lets
you register a compensating "undo" for each step as you go, then run them all in
reverse order if something fails — the same idea as a saga's compensating
transactions, but as a tiny local helper with no dependencies.

## Usage

### `withRollback` (recommended)

Wraps your steps in a scope. If the callback succeeds, the scope is committed
and nothing is rolled back. If it throws, the registered operations run
automatically in reverse order before the error is re-thrown.

```ts
import { withRollback } from "rollbackit";

const user = await withRollback(async (rb) => {
  const created = await db.createUser(data);
  rb.add("delete user", () => db.deleteUser(created.id));

  await storage.createBucket(created.id);
  rb.add("delete bucket", () => storage.deleteBucket(created.id));

  await email.sendWelcome(created.email); // no undo needed

  return created;
});
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
  const failures = await rb.rollback(); // undo in reverse order
  // `failures` lists any rollback operations that themselves threw
  throw error;
}
```

## API

### `createRollback(): Rollback`

Creates a rollback instance.

| Member | Type | Description |
| --- | --- | --- |
| `add(description, rollback)` | `(string, () => Promise<void>) => void` | Register a rollback operation. Throws `RollbackCommittedError` if called after `commit`/`rollback`. |
| `commit()` | `() => void` | Mark the work as successful and discard the undo log. Safe to call multiple times. |
| `rollback()` | `() => Promise<readonly FailedRollback[]>` | Run the registered operations in reverse order. Returns the operations that threw. Safe to call multiple times; subsequent calls are no-ops. |
| `size` | `readonly number` | Number of registered operations. |
| `operations` | `readonly RollbackOperation[]` | Snapshot of currently registered operations. |

### `withRollback<T>(fn): Promise<T>`

Runs `fn(rollback)` within a scope: commits on success, rolls back in reverse
order on failure (then re-throws).

## Behavior notes

- **Reverse order** — rollbacks run newest-first (LIFO), the correct order to unwind dependent steps.
- **Failures don't stop the sequence** — if a rollback operation throws, it's collected into the returned `FailedRollback[]` and the remaining operations still run. Nothing else throws during `rollback()`.
- **Idempotent lifecycle** — once committed or rolled back, the instance is finalized; further `add` calls throw `RollbackCommittedError`.

> The `Rollback`, `RollbackOperation`, `FailedRollback` types and the `RollbackError` / `RollbackCommittedError` classes are also exported.

## Contributing

Contributions are welcome! Please open an issue or pull request.

## License

[MIT](./LICENSE) © [Alexandre Marques](https://github.com/alexmarqs)
