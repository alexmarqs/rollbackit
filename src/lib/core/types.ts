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
};

/**
 * A failed rollback operation.
 */
export type FailedRollback = {
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
	failures: readonly FailedRollback[];
	/**
	 * Operations that were never run because `stopOnRollbackError` halted the
	 * sequence early. Carries the `rollback` functions, so the caller can log,
	 * hand off, or retry them. Empty unless an early stop occurred.
	 *
	 * In registration order (rollbacks run newest-first).
	 */
	pending: readonly RollbackOperation[];
};

/**
 * Options for running the rollback operations.
 */
export type RollbackOptions = {
	/**
	 * Stop as soon as a rollback operation throws, instead of running the rest.
	 *
	 * Operations run newest-first, so stopping leaves the older operations
	 * un-run. Use this when compensations are ordered dependencies; leave it
	 * `false` (the default) for independent, best-effort cleanup.
	 */
	stopOnRollbackError?: boolean;
};

/**
 * A rollback instance.
 */
export type Rollback = {
	/**
	 * Registers a rollback operation.
	 */
	add: (description: string, rollback: () => Promise<void>) => void;
	/**
	 * Executes rollback operations in reverse order.
	 *
	 * Safe to call multiple times; subsequent calls are no-ops (returning an
	 * empty result).
	 */
	rollback: (options?: RollbackOptions) => Promise<RollbackResult>;
	/**
	 * Prevents rollback from executing and releases internal state.
	 *
	 * Safe to call multiple times.
	 */
	commit: () => void;
	/**
	 * Number of registered rollback operations.
	 */
	readonly size: number;
	/**
	 * Snapshot of currently registered operations.
	 */
	readonly operations: readonly RollbackOperation[];
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
	 * operations left by `stopOnRollbackError`) — log, alert, metrics.
	 *
	 * This is an observation hook and must not throw; any error it throws is
	 * ignored so it cannot mask the original error being re-thrown.
	 */
	onRollbackError?: (result: RollbackResult) => void;
};
