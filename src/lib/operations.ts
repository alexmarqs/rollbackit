import type {
	Rollback,
	RollbackFailure,
	RollbackOperation,
	RollbackResult,
} from "../types";
import { RolledBackError } from "./errors";

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
			if (rolledBack) {
				throw new RolledBackError();
			}

			ops.push({ description, rollback, ...options });
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
