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
	 * Safe to call multiple times; subsequent calls are no-ops.
	 */
	rollback: () => Promise<readonly FailedRollback[]>;
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

// /**
//  * Options for creating a rollback instance.
//  */
// export type RollbackOptions = {
// 	/**
// 	 * The logger to use.
// 	 */
// 	logger?: Logger;
// };

// /**
//  * A logger.
//  */
// export type Logger = {
// 	debug: (message: string, ...args: unknown[]) => void;
// 	error: (message: string, ...args: unknown[]) => void;
// 	warn: (message: string, ...args: unknown[]) => void;
// };
