import { describe, expect, test, vi } from "vitest";
import {
	createRollback,
	RollbackCommittedError,
	withRollback,
} from "../src";

describe("createRollback", () => {
	test("runs rollback operations in reverse (LIFO) order", async () => {
		const order: number[] = [];
		const rb = createRollback();
		rb.add("first", async () => {
			order.push(1);
		});
		rb.add("second", async () => {
			order.push(2);
		});

		const { failures, pending } = await rb.rollback();

		expect(order).toEqual([2, 1]);
		expect(failures).toEqual([]);
		expect(pending).toEqual([]);
	});

	test("commit prevents rollback from executing", async () => {
		const undo = vi.fn(async () => {});
		const rb = createRollback();
		rb.add("undo", undo);

		rb.commit();
		const { failures } = await rb.rollback();

		expect(undo).not.toHaveBeenCalled();
		expect(failures).toEqual([]);
	});

	test("collects failures and keeps unwinding by default", async () => {
		const order: string[] = [];
		const boom = new Error("boom");
		const rb = createRollback();
		rb.add("first", async () => {
			order.push("first");
		});
		rb.add("second", async () => {
			order.push("second");
			throw boom;
		});

		const { failures, pending } = await rb.rollback();

		expect(order).toEqual(["second", "first"]); // first still ran
		expect(failures).toEqual([{ description: "second", error: boom }]);
		expect(pending).toEqual([]); // nothing left un-run
	});

	test("stopOnRollbackError halts and reports pending operations", async () => {
		const order: string[] = [];
		const boom = new Error("boom");
		const rb = createRollback();
		rb.add("first", async () => {
			order.push("first");
		});
		rb.add("second", async () => {
			throw boom;
		});

		const { failures, pending } = await rb.rollback({
			stopOnRollbackError: true,
		});

		expect(order).toEqual([]); // "first" never ran
		expect(failures).toEqual([{ description: "second", error: boom }]);
		expect(pending.map((op) => op.description)).toEqual(["first"]);
	});

	test("rollback is idempotent; add after finalize throws", async () => {
		const rb = createRollback();
		rb.add("undo", async () => {});

		await rb.rollback();
		expect(await rb.rollback()).toEqual({ failures: [], pending: [] }); // no-op

		expect(() => rb.add("late", async () => {})).toThrow(
			RollbackCommittedError,
		);
	});

	test("size and operations reflect registered operations", () => {
		const rb = createRollback();
		expect(rb.size).toBe(0);
		rb.add("a", async () => {});
		expect(rb.size).toBe(1);
		expect(rb.operations).toHaveLength(1);
		expect(rb.operations[0]?.description).toBe("a");
	});
});

describe("withRollback", () => {
	test("returns the result and does not roll back on success", async () => {
		const undo = vi.fn(async () => {});

		const result = await withRollback(async (rb) => {
			rb.add("undo", undo);
			return "ok";
		});

		expect(result).toBe("ok");
		expect(undo).not.toHaveBeenCalled();
	});

	test("rolls back in reverse order and re-throws the original error", async () => {
		const order: number[] = [];
		const original = new Error("fn failed");

		await expect(
			withRollback(async (rb) => {
				rb.add("first", async () => {
					order.push(1);
				});
				rb.add("second", async () => {
					order.push(2);
				});
				throw original;
			}),
		).rejects.toBe(original);

		expect(order).toEqual([2, 1]);
	});

	test("onRollbackError receives the result when an undo throws", async () => {
		const original = new Error("fn failed");
		const undoError = new Error("undo failed");
		const onRollbackError = vi.fn();

		await expect(
			withRollback(
				async (rb) => {
					rb.add("undo", async () => {
						throw undoError;
					});
					throw original;
				},
				{ onRollbackError },
			),
		).rejects.toBe(original);

		expect(onRollbackError).toHaveBeenCalledWith({
			failures: [{ description: "undo", error: undoError }],
			pending: [],
		});
	});

	test("a throwing onRollbackError does not mask the original error", async () => {
		const original = new Error("fn failed");

		await expect(
			withRollback(
				async (rb) => {
					rb.add("undo", async () => {
						throw new Error("undo failed");
					});
					throw original;
				},
				{
					onRollbackError: () => {
						throw new Error("callback boom");
					},
				},
			),
		).rejects.toBe(original);
	});

	test("onRollbackError is not called when rollbacks succeed", async () => {
		const onRollbackError = vi.fn();

		await expect(
			withRollback(
				async (rb) => {
					rb.add("undo", async () => {});
					throw new Error("fn failed");
				},
				{ onRollbackError },
			),
		).rejects.toThrow("fn failed");

		expect(onRollbackError).not.toHaveBeenCalled();
	});
});
