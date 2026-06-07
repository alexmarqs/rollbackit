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
export class RollbackError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(createMessage(message), options);
		this.name = new.target.name;
		// Strip the constructor frame from the stack so traces point at the
		// throw site (V8 only; no-op elsewhere).
		Error.captureStackTrace?.(this, new.target);
	}
}

/**
 * Thrown when a rollback operation is registered after the instance has
 * already been committed or rolled back.
 */
export class RollbackCommittedError extends RollbackError {
	constructor(options?: ErrorOptions) {
		super(
			"cannot register rollback operations after commit or rollback",
			options,
		);
	}
}
