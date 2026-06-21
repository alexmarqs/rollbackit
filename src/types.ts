/**
 * Per-operation options, set via the third argument to `add`.
 *
 * `stopOnFailure` here is the operation-level counterpart of the run-level
 * {@link RollbackOptions#stopOnFailure}: when *this* operation's rollback
 * throws, the unwind halts and the older operations are returned as `pending`.
 * It only matters when the run-level flag is `false`; a run-level `true` halts
 * on every failure regardless.
 */
export type RollbackOperationOptions = Pick<RollbackOptions, "stopOnFailure">;

/**
 * Per-step options for {@link Rollback#step}.
 *
 * Extends {@link RollbackOperationOptions} (the `stopOnFailure` that governs the
 * registered compensation) with controls for the forward action.
 */
export type StepOptions = RollbackOperationOptions & {
	/**
	 * Abort `run` after this many milliseconds and reject with `TimeoutError`.
	 *
	 * The `AbortSignal` handed to `run` is aborted when the timeout elapses, so a
	 * `run` that honors it can cancel its in-flight work. On timeout the
	 * compensation is never registered and the error propagates, so an outer
	 * {@link withRollback} unwinds the prior steps.
	 *
	 * The signal is aborted just before `TimeoutError` is thrown, and the first
	 * to settle wins the race. A `run` that rejects asynchronously on abort
	 * (`fetch`, DB drivers) yields `TimeoutError`; one that rejects
	 * *synchronously* inside its `abort` listener propagates its own error
	 * instead. Either way nothing is registered — don't branch cleanup on
	 * `instanceof TimeoutError`.
	 */
	timeout?: number;
};

/**
 * A rollback operation.
 */
export type RollbackOperation = {
	/**
	 * The description of the rollback operation.
	 */
	description: string;
	/**
	 * The rollback function.
	 */
	rollback: () => Promise<void>;
} & RollbackOperationOptions;

/**
 * A failure record for a rollback operation that threw while unwinding.
 */
export type RollbackFailure = {
	/**
	 * The description of the failed rollback operation.
	 */
	description: string;
	/**
	 * The error of the failed rollback operation.
	 */
	error: unknown;
};

/**
 * The outcome of running the rollback operations.
 */
export type RollbackResult = {
	/**
	 * Operations that threw while rolling back.
	 */
	failures: readonly RollbackFailure[];
	/**
	 * Operations that were never run because `stopOnFailure` halted the
	 * sequence early. Carries the `rollback` functions, so the caller can log,
	 * hand off, or retry them. Empty unless an early stop occurred.
	 *
	 * In registration order (rollbacks run newest-first).
	 */
	pending: readonly RollbackOperation[];
};

/**
 * Run-level options for executing the rollback operations.
 */
export type RollbackOptions = {
	/**
	 * Stop as soon as a rollback operation throws, instead of running the rest.
	 *
	 * Operations run newest-first, so stopping leaves the older operations
	 * un-run. Use this when compensations are ordered dependencies; leave it
	 * `false` (the default) for independent, best-effort cleanup.
	 */
	stopOnFailure?: boolean;
};

/**
 * A rollback instance.
 */
export type Rollback = {
	/**
	 * Registers a rollback operation. Pass `options` to set
	 * a per-operation `stopOnFailure`.
	 *
	 * Throws `RolledBackError` once the instance has been rolled back.
	 * Registering after a `commit` is allowed — `commit` only seals the
	 * current batch, it does not finalize the instance.
	 */
	add: (
		description: string,
		rollback: () => Promise<void>,
		options?: RollbackOperationOptions,
	) => void;
	/**
	 * Executes the rollback operations registered since the last `commit`, in
	 * reverse order. Finalizes the instance.
	 *
	 * Safe to call multiple times; subsequent calls are no-ops (returning an
	 * empty result).
	 */
	rollback: (options?: RollbackOptions) => Promise<RollbackResult>;
	/**
	 * Seals the current batch: the work registered so far is treated as
	 * permanent, so its rollback operations are dropped. The instance stays open —
	 * register the next batch and `commit` or `rollback` it independently. A
	 * later `rollback` only unwinds what was added since the most recent
	 * `commit`.
	 *
	 * Safe to call multiple times.
	 */
	commit: () => void;
	/**
	 * Runs `run` and, only if it resolves, registers `rollback` (called with
	 * `run`'s result) as a rollback operation, then returns the result. Pairs a
	 * forward action with its compensation in one call.
	 *
	 * `description` names the step by its forward intent, e.g. `"create user"`,
	 * and surfaces in {@link RollbackFailure} if the compensation throws while
	 * unwinding.
	 *
	 * If `run` throws or exceeds `options.timeout`, nothing is registered and the
	 * error propagates. `run` receives an `AbortSignal` that fires on timeout.
	 *
	 * Throws `RolledBackError` if the instance is already rolled back.
	 */
	step: <T>(
		description: string,
		run: (signal: AbortSignal) => Promise<T>,
		rollback: (result: T) => Promise<void>,
		options?: StepOptions,
	) => Promise<T>;
};

/**
 * Options for {@link withRollback}.
 */
export type WithRollbackOptions = RollbackOptions & {
	/**
	 * Whole-operation budget in milliseconds. If `fn` does not settle within it,
	 * `withRollback` rejects with `TimeoutError`, which lands in the rollback
	 * path: the operations registered so far unwind, then the error is thrown.
	 *
	 * `fn` receives an `AbortSignal` that fires when the
	 * timeout elapses, so a `fn` that threads it into its calls can cancel
	 * in-flight work. A `fn` that ignores it keeps running in the background, and
	 * any operation it registers after the timeout throws `RolledBackError`.
	 */
	timeout?: number;
	/**
	 * Called with the rollback result when `fn` throws and one or more rollback
	 * operations also throw while unwinding.
	 *
	 * `withRollback` re-throws the original error and does not return the
	 * result, so this is the way to observe the failures (and any `pending`
	 * operations left by `stopOnFailure`) — log, alert, metrics.
	 *
	 * This is an observation hook and must not throw; any error it throws is
	 * ignored so it cannot mask the original error being re-thrown.
	 */
	onFailures?: (result: RollbackResult) => void;
};
