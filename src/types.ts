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
	 * permanent, so its undo operations are dropped. The instance stays open —
	 * register the next batch and `commit` or `rollback` it independently. A
	 * later `rollback` only unwinds what was added since the most recent
	 * `commit`.
	 *
	 * Safe to call multiple times.
	 */
	commit: () => void;
};

/**
 * Options for {@link withRollback}.
 */
export type WithRollbackOptions = RollbackOptions & {
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
