import type {
	Rollback,
	RollbackFailure,
	RollbackOperation,
	RollbackResult,
} from "../types";
import { RolledBackError, TimeoutError } from "./errors";

/**
 * Runs `fn`, passing it an `AbortSignal`. When `timeout` is set, the signal is
 * aborted and the call rejects with `TimeoutError` if `fn` has not settled in
 * time; a `fn` that honors the signal can cancel its in-flight work.
 *
 * @param fn - The forward action; receives the abort signal.
 * @param timeout - Optional deadline in milliseconds.
 * @returns The resolved value of `fn`.
 */
export const runWithTimeout = async <T>(
	fn: (signal: AbortSignal) => Promise<T>,
	timeout: number | undefined,
): Promise<T> => {
	const controller = new AbortController();

	if (timeout === undefined) {
		return fn(controller.signal);
	}

	let timer: ReturnType<typeof setTimeout> | undefined;

	try {
		return await Promise.race([
			fn(controller.signal),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					controller.abort();
					reject(new TimeoutError(timeout));
				}, timeout);
			}),
		]);
	} finally {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
	}
};

/**
 * Runs the rollback operations in reverse order.
 *
 * By default failures are collected and the sequence continues, so a single
 * failing operation does not prevent the rest from running. When
 * `stopOnFailure` is set, the sequence stops at the first failure and
 * the remaining (older) operations are returned as `pending`, un-run.
 *
 * @param ops - The rollback operations to run.
 * @param stopOnFailure - Stop at the first failing operation.
 * @returns The failures and any operations left un-run.
 */
const runRollback = async (
	ops: RollbackOperation[],
	stopOnFailure: boolean,
): Promise<RollbackResult> => {
	const failures: RollbackFailure[] = [];

	// run the rollback operations in reverse order
	for (let i = ops.length - 1; i >= 0; i--) {
		const op = ops[i];
		try {
			await op.rollback();
		} catch (error) {
			failures.push({ description: op.description, error });

			// stop at the first failure when requested; the older operations
			// (indices 0..i-1) were never attempted, so report them as pending.
			// stop if the run-level flag is set, or if this specific op opted in.
			if (stopOnFailure || op.stopOnFailure) {
				return { failures, pending: ops.slice(0, i) };
			}
		}
	}

	return { failures, pending: [] };
};

const throwIfAlreadyRolledBack = (rolledBack: boolean) => {
	if (rolledBack) {
		throw new RolledBackError();
	}
};

/**
 * Creates a new rollback instance.
 *
 * @returns The rollback instance.
 */
export const createRollback = (): Rollback => {
	let rolledBack = false;
	const ops: RollbackOperation[] = [];

	return {
		add: (description, rollback, options) => {
			throwIfAlreadyRolledBack(rolledBack);

			ops.push({ description, rollback, ...options });
		},
		step: async (description, run, rollback, options) => {
			// entry guard: reject before running any forward work.
			throwIfAlreadyRolledBack(rolledBack);

			const result = await runWithTimeout(run, options?.timeout);

			// run() succeeded — register its compensation. If the instance was
			// rolled back while run() was in flight (e.g. a withRollback timeout),
			// registering is no longer valid: surface it like any post-rollback add.
			throwIfAlreadyRolledBack(rolledBack);

			ops.push({
				description,
				rollback: () => rollback(result),
				stopOnFailure: options?.stopOnFailure,
			});

			return result;
		},
		commit: () => {
			if (rolledBack) {
				// no-op: the instance is already rolled back
				return;
			}

			// Seal the current batch: the work so far is now permanent, so we
			// drop its undo operations. The instance stays open — register the
			// next batch and commit or roll it back independently.
			ops.length = 0;
		},
		rollback: async (options) => {
			if (rolledBack) {
				// no-op: the instance is already rolled back
				return { failures: [], pending: [] };
			}

			rolledBack = true;

			const result = await runRollback(ops, options?.stopOnFailure ?? false);

			ops.length = 0;

			return result;
		},
	};
};
