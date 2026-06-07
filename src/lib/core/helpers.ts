import { createRollback } from "./operations";
import type { Rollback, WithRollbackOptions } from "./types";

/**
 * Runs `fn` with a scoped rollback instance.
 *
 * On success the scope is committed and the result is returned. If `fn`
 * throws, the registered rollback operations run in reverse order, then the
 * original error is re-thrown. Because the original error propagates, the
 * rollback failures are not returned — pass `onRollbackError` to observe them.
 *
 * @param fn - Receives the rollback instance to register operations on.
 * @param options - Rollback behavior and the `onRollbackError` callback.
 * @returns The result of `fn`.
 */
export const withRollback = async <T>(
	fn: (rollback: Rollback) => Promise<T>,
	options?: WithRollbackOptions,
): Promise<T> => {
	const rollback = createRollback();

	try {
		const result = await fn(rollback);

		// if the function succeeds,
		// commit the rollback, even if it was already committed,
		// it's just a no-op
		rollback.commit();

		return result;
	} catch (error) {
		const result = await rollback.rollback({
			stopOnRollbackError: options?.stopOnRollbackError,
		});

		// surface the rollback result (the original error is re-thrown, so it
		// is otherwise lost). onRollbackError is an observation hook, so guard
		// it: a throw from it must never mask the original error.
		if (result.failures.length > 0 && options?.onRollbackError) {
			try {
				options.onRollbackError(result);
			} catch {
				// intentionally ignored — see onRollbackError docs
			}
		}

		throw error;
	}
};
