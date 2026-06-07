import { createRollback } from "./operations";
import type { Rollback } from "./types";

/**
 * Runs `fn` with a scoped rollback instance.
 *
 * On success the scope is committed and the result is returned. If `fn`
 * throws, the registered rollback operations run in reverse order before the
 * error is re-thrown.
 *
 * @param fn - Receives the rollback instance to register operations on.
 * @returns The result of `fn`.
 */
export const withRollback = async <T>(
	fn: (rollback: Rollback) => Promise<T>,
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
		await rollback.rollback();
		throw error;
	}
};
