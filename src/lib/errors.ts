/**
 * The prefix for all rollbackit related messages.
 */
const PREFIX = "[rollbackit]";

export const createMessage = (message: string) => `${PREFIX} ${message}`;

/**
 * Base class for all errors thrown by rollbackit.
 *
 * Messages are prefixed with `[rollbackit]` for easy identification in logs,
 * and `name` reflects the concrete subclass so `instanceof` and stack traces
 * report the right type.
 */
class RollbackError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(createMessage(message), options);
		this.name = new.target.name;
		Error.captureStackTrace?.(this, new.target);
	}
}

/**
 * Thrown when a rollback operation is registered after the instance has
 * already been rolled back. (Committing does not finalize the instance — it
 * seals the current batch and leaves it open for more, so registering after
 * a `commit` is allowed.)
 */
export class RolledBackError extends RollbackError {
	constructor(options?: ErrorOptions) {
		super("cannot register rollback operations after rollback", options);
	}
}

/**
 * Thrown when an operation does not settle within its configured `timeout`.
 */
export class TimeoutError extends RollbackError {
	constructor(timeout: number, options?: ErrorOptions) {
		super(`operation timed out after ${timeout}ms`, options);
	}
}
