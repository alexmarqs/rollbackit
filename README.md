<div align="center">

<img src="https://raw.githubusercontent.com/alexmarqs/rollbackit/main/.github/assets/rollbackit.png" width="220px" align="center" alt="rollbackit logo" />

<h1 align="center">rollbackit</h1>

<p align="center">Type-safe, zero-dependency, framework-agnostic rollback for multi-step operations in TypeScript & JavaScript.<br/>Register an undo for each step; if anything fails, they run in reverse — automatically.</p>

<p align="center">
  <a href="https://github.com/alexmarqs/rollbackit/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/alexmarqs/rollbackit/ci.yml?branch=main&label=CI" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT" target="_blank"><img height=20 src="https://img.shields.io/badge/License-MIT-yellow.svg" /></a>
  <a href="https://www.npmjs.com/package/rollbackit"><img src="https://img.shields.io/npm/v/rollbackit.svg" alt="npm version" /></a>
</p>

</div>

## Features

- 🪶 **Lightweight** — tiny footprint, **zero dependencies**.
- 🔒 **Type safe** — written in TypeScript, ships with full types.
- ↩️ **Reverse-order undo** — compensating operations run newest-first (LIFO), the right order to unwind dependent steps.
- 🧩 **Two ergonomic APIs** — a `withRollback` scope that cleans up for you, or a `createRollback` instance you drive by hand.
- 🛟 **Failure-aware** — collect every rollback failure, or stop at the first; left-over operations are handed back so you can log or retry.
- 🪢 **Progressive commit** — `commit()` seals the current batch and stays open, so independent units of work can share one flow without sharing fate.
- 🌐 **Framework agnostic** — plain functions, no runtime lock-in. Works with any stack: Express, Fastify, Next.js, NestJS, serverless, or no framework at all.
- 📦 **ESM & CJS** — works in both module systems, Node 18+, and the browser.

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

## Contents

- [Features](#features)
- [Install](#install)
- [Quick start](#quick-start)
- [When to use it](#when-to-use-it)
- [Usage](#usage)
  - [`withRollback` (recommended)](#withrollback-recommended)
  - [`createRollback` (manual control)](#createrollback-manual-control)
  - [Committing early (point of no return)](#committing-early-point-of-no-return)
  - [Batches in one flow (progressive commit)](#batches-in-one-flow-progressive-commit)
- [API](#api)
- [Behavior notes](#behavior-notes)
- [FAQ](#faq-for-humans-and-ai-agents)
- [Contributing](#contributing)
- [License](#license)


## Quick start

```ts
import { withRollback } from "rollbackit";

const result = await withRollback(async (rb) => {
  const user = await db.createUser(data);
  rb.add("delete user", () => db.deleteUser(user.id)); // undo for the step above

  await sendWelcomeEmail(user); // if this throws, "delete user" runs, then the error re-throws

  return user; // success → nothing is rolled back
});
```

That's the whole idea: **register an undo right after each step**. On success, undos are discarded; on failure, they run newest-first and the original error propagates.

## When to use it

**Use rollbackit when:**

- A sequence of side effects must be all-or-nothing, but they span systems a single database transaction can't cover (DB + object storage + search index + third-party APIs).
- You're implementing the **saga pattern** / **compensating transactions** in application code and don't want a full workflow engine.
- You want cleanup logic to live *next to* the step it reverses, instead of in a far-away `catch`.

**Reach for something else when:**

- Everything happens in **one database** — use a native DB transaction; it's atomic, this isn't.
- You only need to release local resources (file handles, sockets) — `try/finally` or `using` / `AsyncDisposableStack` may be enough.
- You need durable, crash-surviving orchestration with retries across restarts — use a real saga/workflow engine (Temporal, AWS Step Functions, etc.). rollbackit is in-memory and lives for the duration of one process.



## Usage

### `withRollback` (recommended)

Wraps your steps in a scope (see [Quick start](#quick-start) above). If the
callback succeeds, the scope is committed and nothing is rolled back. If it
throws, the registered operations run automatically in reverse order before the
**original error is re-thrown**. Steps with no side effect to undo simply don't
register an `add`.

Because the original error propagates, `withRollback` does not return the
rollback failures. Pass `onFailures` to observe them (log, alert, metrics):

```ts
await withRollback(
  async (rb) => {
    /* ... */
  },
  {
    onFailures: ({ failures, pending }) =>
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

`commit()` seals everything registered *so far* and drops those undos. Work you
register *after* it starts a fresh batch that's still reversible — see
[Batches in one flow](#batches-in-one-flow-progressive-commit) below.

### Batches in one flow (progressive commit)

`commit()` doesn't finalize the instance — it **seals the current batch** and
stays open. Each commit draws a line: a later `rollback()` only unwinds the
operations registered *since the last commit*. This lets independent units of
work share one flow without sharing fate — no nesting required.

```ts
const rb = createRollback();

// stage one — two side effects, undone together if this batch fails
async function stageOne() {
  const user = await db.createUser(data);
  rb.add("delete user", () => db.deleteUser(user.id));

  const bucket = await storage.createBucket(user.id);
  rb.add("delete bucket", () => storage.deleteBucket(bucket.id));
}

// stage two — an independent batch
async function stageTwo() {
  const sub = await billing.subscribe(plan);
  rb.add("cancel subscription", () => billing.cancel(sub.id));
}

try {
  await stageOne();
  rb.commit(); // stage one succeeded — seal it; its undos are dropped

  await stageTwo(); // throws here? only stage two rolls back — stage one stays
  rb.commit();
} catch (error) {
  await rb.rollback(); // unwinds only the batch in progress
  throw error;
}
```

This works inside `withRollback` too — the `rb` it hands your callback is the
same instance, so committing mid-callback seals a batch and a later throw
unwinds only what came after it (on success `withRollback` commits the final
batch for you):

```ts
await withRollback(async (rb) => {
  await stageOne(rb);
  rb.commit(); // seal stage one — survives even if stage two throws

  await stageTwo(rb); // throws? only stage two rolls back, then re-throws
});
```

Reach for the manual `createRollback` form over nesting `withRollback` when the
batches are **sequential or data-driven** (a loop, a pipeline, N stages decided
at runtime): it keeps the flow flat and lets your control flow set the
boundaries. The trade-off is the point: once a batch is committed it's
permanent — `rollback()` never reaches past a `commit` line.

## API

### `createRollback(): Rollback`

Creates a rollback instance.

| Member | Type | Description |
| --- | --- | --- |
| `add(description, rollback, options?)` | `(string, () => Promise<void>, options?: { stopOnFailure?: boolean }) => void` | Register a rollback operation. Pass `{ stopOnFailure: true }` to halt the unwind if *this* operation's rollback throws (see below). Throws `RolledBackError` if called after `rollback` (after `commit` is fine — see below). |
| `commit()` | `() => void` | Seal the current batch: treat the work so far as permanent and drop its undos. The instance stays open for the next batch. Safe to call multiple times. |
| `rollback(options?)` | `(options?: RollbackOptions) => Promise<RollbackResult>` | Run the operations registered since the last `commit`, in reverse order, and finalize the instance. Returns the failures and any `pending` (un-run) operations. Safe to call multiple times; subsequent calls are no-ops. |
| `size` | `number` | Number of registered operations (read-only). |
| `operations` | `readonly RollbackOperation[]` | Snapshot of currently registered operations (read-only). |

`RollbackOptions`:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `stopOnFailure` | `boolean` | `false` | Stop at the first rollback operation that throws instead of unwinding the rest. |

`RollbackResult`:

| Field | Type | Description |
| --- | --- | --- |
| `failures` | `readonly FailedRollback[]` | Operations that threw while rolling back (`{ description, error }`). |
| `pending` | `readonly RollbackOperation[]` | Operations never run because `stopOnFailure` halted early (carries the `rollback` fns, so you can log or retry them). Empty unless an early stop occurred. |

### `withRollback<T>(fn, options?): Promise<T>`

Runs `fn(rollback)` within a scope: commits on success, rolls back in reverse
order on failure (then re-throws the original error). `WithRollbackOptions`
extends `RollbackOptions` with:

| Option | Type | Description |
| --- | --- | --- |
| `onFailures` | `(result: RollbackResult) => void` | Called with the `RollbackResult` when `fn` throws and one or more rollback operations also throw while unwinding. Observation hook — it must not throw; any error it throws is ignored so it can't mask the original error. |

## Behavior notes

- **Reverse order** — rollbacks run newest-first (LIFO), the correct order to unwind dependent steps.
- **Failures don't stop the sequence** — by default a throwing rollback operation is collected into `result.failures` and the remaining operations still run. Set `stopOnFailure: true` to halt at the first failure; the older, un-run operations are returned in `result.pending` (use this only when compensations are ordered dependencies). You can also set it per operation via `add(description, rollback, { stopOnFailure: true })` to halt only if that specific operation's rollback throws; the run-level flag, when `true`, halts on every failure regardless.
- **Commit seals, rollback finalizes** — `commit()` seals the current batch and keeps the instance open, so you can register a new batch after it (see [Batches in one flow](#batches-in-one-flow-progressive-commit)). Only `rollback()` finalizes the instance; `add` after a rollback throws `RolledBackError`. Repeat `commit`/`rollback` calls are safe no-ops.
- **The original error always wins** — `withRollback` re-throws whatever `fn` threw, never a rollback error. Observe rollback failures via `onFailures` (or the returned `RollbackResult` with `createRollback`).

## FAQ (For humans and AI agents)

**When should I use `withRollback` vs `createRollback`?**
Prefer `withRollback` — it scopes the lifecycle for you (commit on success, roll back on throw) and is the right fit for ~90% of cases. Drop to `createRollback` when you need manual control over *when* to commit or roll back, or to inspect the `RollbackResult` directly.

**What happens if a rollback operation itself throws?**
It's recorded in `result.failures` and the remaining operations still run, so one bad undo doesn't strand the rest. Set `stopOnFailure: true` to halt instead; whatever was left un-run comes back in `result.pending`.

**Is this a replacement for database transactions?**
No. If all your work is in one database, use a native transaction — it's truly atomic. rollbackit is for *distributed* side effects across systems that have no shared transaction (DB + storage + search + external APIs), where the only way to "undo" is to run a compensating action.

**Does rollback run in parallel?**
No — operations roll back sequentially, newest-first, which is the safe default for dependent steps. If you have independent cleanups you want concurrent, compose them inside a single rollback function: `rb.add("cleanup", () => Promise.allSettled([a(), b()]))`.

**What if a step has nothing to undo?**
Don't call `add`. Only register a rollback for steps that created a side effect worth reversing (pure reads, validation, etc. register nothing).

**Does it work with CommonJS / ESM / the browser?**
Yes to all — it ships both ESM and CJS builds with full type declarations, targets Node 18+, and has no Node-specific dependencies, so it runs in the browser too.

**Is it safe to call `rollback()` or `commit()` more than once?**
Yes. `commit()` is repeatable — each call seals the current batch and leaves the instance open for more (see [Batches in one flow](#batches-in-one-flow-progressive-commit)). `rollback()` finalizes the instance and subsequent calls are no-ops (returning an empty result). Only `add()` after a `rollback()` throws — `RolledBackError`.

## Tech Stack

Built with tech/tools that I love:
- [TypeScript](https://www.typescriptlang.org/) - for type safety and developer experience.
- [Vitest](https://vitest.dev/) - for testing.
- [Biome](https://biomejs.dev/) - for linting and formatting.
- [Changesets](https://changesets.io/) - for versioning and publishing.
- [pnpm](https://pnpm.io/) - for package management.
- [GitHub Actions](https://github.com/features/actions) - for CI/CD.
- [Tsdown](https://tsdown.dev/) -  library bundler powered by Rolldown.
- [Lefthook](https://github.com/Arkweid/lefthook) - for pre-commit hooks.

## Contributing

Contributions are welcome! Please open an issue or pull request.

## License

[MIT](./LICENSE) © [Alexandre Marques](https://github.com/alexmarqs)
