# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**rollbackit** is a tiny, zero-dependency, type-safe library that makes multi-step operations all-or-nothing. You register an *undo* next to each step; if a later step throws, the undos run in reverse order (LIFO) automatically. It's the saga / compensating-transaction pattern as a single in-memory helper — not a workflow engine. Ships both ESM and CJS, targets Node 18+, and runs in the browser.

Keep the API minimal — cut features before adding them, and benchmark proposed additions against the platform's `AsyncDisposableStack` to justify their existence.

## Commands

- `pnpm test` — run tests once (Vitest). `pnpm test:watch` for watch mode.
- A single test: `pnpm exec vitest run -t "<test name>"` (or pass a file path). There is no Vitest config file; defaults apply.
- `pnpm typecheck` — `tsc --noEmit` (the source of truth for types; the build delegates `.d.ts` generation to tsdown).
- `pnpm check` — Biome lint + format with `--write` (autofix). `pnpm check:ci` for the read-only CI variant.
- `pnpm build` — bundle with tsdown to `dist/` (ESM + CJS + types, `publint`-validated). `pnpm dev` for watch.
- Releases use Changesets: `pnpm release` (version) and `pnpm release:publish`.

Use **pnpm** (declared `packageManager`). A Lefthook `pre-commit` hook runs `biome check --write` on staged files. Biome uses **tabs** and **double quotes** — match that.

## Architecture

The entire library is a handful of small files — `src/lib/` (`operations.ts`, `helpers.ts`, `errors.ts`) plus `src/types.ts` — re-exported through `src/index.ts`. There are two public entry points built on one core:

- **`createRollback()`** (`operations.ts`) is the engine. It closes over a single mutable `ops: RollbackOperation[]` array plus a `rolledBack` boolean flag. Everything else is a thin wrapper around it.
- **`withRollback(fn, options?)`** (`helpers.ts`) is the scoped, recommended API. It creates an instance, runs `fn(rb)`, calls `commit()` on success, and on throw calls `rollback()` then **re-throws the original error**. Because the original error always propagates, rollback failures are observed via the `onFailures` hook, never returned.

### Three invariants that drive the design

1. **`commit()` seals a *batch*, it does not finalize the instance.** It just clears the ops array (`ops.length = 0`) and leaves the instance open. Registering after a commit is *allowed* and starts a fresh batch — a later `rollback()` only unwinds operations added since the most recent commit. This is the "progressive commit" feature; don't regress it into a one-shot finalize.
2. **`rollback()` finalizes** by setting `rolledBack = true`. After that, `add()` throws `RolledBackError`, and repeat `rollback()`/`commit()` calls are safe no-ops. Only `add`-after-`rollback` throws.
3. **Rollback runs newest-first and is failure-tolerant by default.** `runRollback` iterates the ops array in reverse, collecting throwing operations into `result.failures` and continuing. A run-level `stopOnFailure: true` halts at the first failure and returns the older, un-run operations in `result.pending` (in registration order). There is also a *per-operation* `stopOnFailure`, set via the third arg to `add` (`OperationOptions`): the unwind halts only if *that* operation's rollback throws — `runRollback` stops on `stopOnFailure || op.stopOnFailure`, so the per-operation flag only matters when the run-level flag is `false`. Rollbacks always run sequentially — never parallelize the loop; concurrency is the caller's job inside a single `add`.

### Errors

`RollbackError` (base) prefixes all messages with `[rollbackit]` and sets `name` to the concrete subclass via `new.target` so `instanceof` and stack traces report correctly. `RolledBackError` is the only subclass. Add new error types as `RollbackError` subclasses, not bare `Error`s.

### Types

`types.ts` holds all public types and the canonical JSDoc — `Rollback`, `RollbackResult`, `RollbackOptions`, `WithRollbackOptions`, etc. The JSDoc here is user-facing documentation; keep it in sync with `README.md` behavior notes when you change semantics.

## Conventions

- `verbatimModuleSyntax` is on — use `import type` for type-only imports.
- `strict` and `noUnusedLocals` are enabled.
- The README is the detailed spec (problem framing, usage patterns, API tables, behavior notes, FAQ). When changing observable behavior, update both the JSDoc in `types.ts` and the README.
