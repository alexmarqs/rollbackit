import { RollbackCommittedError } from "./errors";
import type { FailedRollback, Rollback, RollbackOperation } from "./types";

/**
 * Runs the rollback operations in reverse order.
 *
 * Failures are collected and the sequence continues, so a single failing
 * operation does not prevent the rest from running.
 *
 * @param ops - The rollback operations to run.
 * @returns The failed rollback operations.
 */
const runRollback = async (
	ops: RollbackOperation[],
): Promise<FailedRollback[]> => {
	const failures: FailedRollback[] = [];

	// run the rollback operations in reverse order
	for (let i = ops.length - 1; i >= 0; i--) {
		const op = ops[i];
		try {
			await op.rollback();
		} catch (error) {
			failures.push({ description: op.description, error });
			// continue to the next operation, failures are being collected
		}
	}

	return failures;
};

/**
 * Creates a new rollback instance.
 *
 * @returns The rollback instance.
 */
export const createRollback = (): Rollback => {
	let committed = false;
	const ops: RollbackOperation[] = [];

	return {
		add: (description, rollback) => {
			if (committed) {
				throw new RollbackCommittedError();
			}

			ops.push({ description, rollback });
		},
		commit: () => {
			committed = true;
			ops.length = 0;
		},
		rollback: async () => {
			if (committed) {
				return [];
			}

			committed = true;

			const failures = await runRollback(ops);

			ops.length = 0;

			return failures;
		},
		get operations() {
			return [...ops];
		},
		get size() {
			return ops.length;
		},
	};
};
