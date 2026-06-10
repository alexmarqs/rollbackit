import { describe, expect, test, vi } from "vitest";
import { createRollback, RolledBackError, withRollback } from "../src";

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

	test("stopOnFailure halts and reports pending operations", async () => {
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
			stopOnFailure: true,
		});

		expect(order).toEqual([]); // "first" never ran
		expect(failures).toEqual([{ description: "second", error: boom }]);
		expect(pending.map((op) => op.description)).toEqual(["first"]);
	});

	test("pending operations carry callable rollbacks the caller can retry", async () => {
		const retried = vi.fn(async () => {});
		const rb = createRollback();
		rb.add("retryable", retried);
		rb.add("boom", async () => {
			throw new Error("boom");
		});

		const { pending } = await rb.rollback({ stopOnFailure: true });

		// the early stop left "retryable" un-run; the caller hands it off / retries
		expect(retried).not.toHaveBeenCalled();
		expect(pending).toHaveLength(1);
		await pending[0]?.rollback();
		expect(retried).toHaveBeenCalledOnce();
	});

	test("a per-operation stopOnFailure halts when that op's rollback throws", async () => {
		const order: string[] = [];
		const boom = new Error("boom");
		const rb = createRollback();
		rb.add("first", async () => {
			order.push("first");
		});
		rb.add(
			"second",
			async () => {
				throw boom;
			},
			{ stopOnFailure: true },
		);

		// no run-level flag — the halt comes from the op's own option
		const { failures, pending } = await rb.rollback();

		expect(order).toEqual([]); // "first" never ran
		expect(failures).toEqual([{ description: "second", error: boom }]);
		expect(pending.map((op) => op.description)).toEqual(["first"]);
	});

	test("a per-operation stopOnFailure does not halt when that op succeeds", async () => {
		const order: string[] = [];
		const rb = createRollback();
		rb.add("first", async () => {
			order.push("first");
		});
		rb.add(
			"second",
			async () => {
				order.push("second");
			},
			{ stopOnFailure: true },
		);

		const { failures, pending } = await rb.rollback();

		expect(order).toEqual(["second", "first"]); // both ran, newest-first
		expect(failures).toEqual([]);
		expect(pending).toEqual([]);
	});

	test("rollback is idempotent; add after finalize throws", async () => {
		const rb = createRollback();
		rb.add("undo", async () => {});

		await rb.rollback();
		expect(await rb.rollback()).toEqual({ failures: [], pending: [] }); // no-op

		expect(() => rb.add("late", async () => {})).toThrow(RolledBackError);
	});

	test("commit seals a batch; rollback only unwinds the current batch", async () => {
		const undoOne = vi.fn(async () => {});
		const undoTwo = vi.fn(async () => {});
		const rb = createRollback();

		rb.add("batch one", undoOne);
		rb.commit(); // seal batch one — its undo is dropped

		rb.add("batch two", undoTwo);
		const { failures } = await rb.rollback();

		expect(undoOne).not.toHaveBeenCalled(); // committed, left permanent
		expect(undoTwo).toHaveBeenCalledOnce(); // only the current batch unwinds
		expect(failures).toEqual([]);
	});

	test("add is allowed after commit; the instance stays open", async () => {
		const undoA = vi.fn(async () => {});
		const undoB = vi.fn(async () => {});
		const rb = createRollback();
		rb.add("a", undoA);
		rb.commit();

		expect(() => rb.add("b", undoB)).not.toThrow();

		await rb.rollback();
		expect(undoA).not.toHaveBeenCalled(); // batch one was committed
		expect(undoB).toHaveBeenCalledOnce(); // "b" is the fresh, current batch
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

	test("onFailures receives the result when an undo throws", async () => {
		const original = new Error("fn failed");
		const undoError = new Error("undo failed");
		const onFailures = vi.fn();

		await expect(
			withRollback(
				async (rb) => {
					rb.add("undo", async () => {
						throw undoError;
					});
					throw original;
				},
				{ onFailures },
			),
		).rejects.toBe(original);

		expect(onFailures).toHaveBeenCalledWith({
			failures: [{ description: "undo", error: undoError }],
			pending: [],
		});
	});

	test("a throwing onFailures does not mask the original error", async () => {
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
					onFailures: () => {
						throw new Error("callback boom");
					},
				},
			),
		).rejects.toBe(original);
	});

	test("onFailures is not called when rollbacks succeed", async () => {
		const onFailures = vi.fn();

		await expect(
			withRollback(
				async (rb) => {
					rb.add("undo", async () => {});
					throw new Error("fn failed");
				},
				{ onFailures },
			),
		).rejects.toThrow("fn failed");

		expect(onFailures).not.toHaveBeenCalled();
	});
});
