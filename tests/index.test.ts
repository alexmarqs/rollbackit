import { describe, expect, test, vi } from "vitest";
import {
	createRollback,
	RolledBackError,
	TimeoutError,
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

describe("createRollback.step", () => {
	test("returns run's result and registers undo only after run resolves", async () => {
		const order: string[] = [];
		const rb = createRollback();

		const value = await rb.step(
			"create thing",
			async () => {
				order.push("run");
				return { id: 42 };
			},
			async (result) => {
				order.push(`undo:${result.id}`);
			},
		);

		expect(value).toEqual({ id: 42 });
		expect(order).toEqual(["run"]); // undo registered, not yet run

		await rb.rollback();
		expect(order).toEqual(["run", "undo:42"]); // undo gets run's result
	});

	test("registers the undo and returns the result when run settles within the timeout", async () => {
		const rb = createRollback();
		let aborted = false;
		const undo = vi.fn(async () => {});

		const value = await rb.step(
			"fast create",
			async (signal) => {
				signal.addEventListener("abort", () => {
					aborted = true;
				});
				return { id: 7 };
			},
			undo,
			{ timeout: 1000 },
		);

		expect(value).toEqual({ id: 7 }); // run's value passes through
		expect(aborted).toBe(false); // settled in time, the signal never fired

		await rb.rollback();
		expect(undo).toHaveBeenCalledOnce(); // the undo was registered
	});

	test("unwinds multiple steps newest-first, each undo receiving its own result", async () => {
		const order: string[] = [];
		const rb = createRollback();

		await rb.step(
			"a",
			async () => ({ id: "a" }),
			async (result) => {
				order.push(`undo:${result.id}`);
			},
		);
		await rb.step(
			"b",
			async () => ({ id: "b" }),
			async (result) => {
				order.push(`undo:${result.id}`);
			},
		);

		await rb.rollback();
		expect(order).toEqual(["undo:b", "undo:a"]); // LIFO, results not crossed
	});

	test("does not register undo when run throws, and propagates", async () => {
		const undo = vi.fn(async () => {});
		const rb = createRollback();
		const boom = new Error("run failed");

		await expect(
			rb.step(
				"create thing",
				async () => {
					throw boom;
				},
				undo,
			),
		).rejects.toBe(boom);

		const { failures } = await rb.rollback();
		expect(undo).not.toHaveBeenCalled();
		expect(failures).toEqual([]);
	});

	test("times out run, aborts its signal, and registers no undo", async () => {
		const undo = vi.fn(async () => {});
		const rb = createRollback();
		let aborted = false;

		await expect(
			rb.step(
				"slow create",
				(signal) => {
					signal.addEventListener("abort", () => {
						aborted = true;
					});
					return new Promise(() => {}); // never settles
				},
				undo,
				{ timeout: 10 },
			),
		).rejects.toBeInstanceOf(TimeoutError);

		expect(aborted).toBe(true);
		expect(undo).not.toHaveBeenCalled();
	});

	test("a run that rejects synchronously on abort surfaces its own error, not TimeoutError", async () => {
		// the timeout aborts the signal, then throws TimeoutError; whichever
		// settles first wins. A synchronous reject in the abort listener settles
		// the run before TimeoutError is thrown, so the run's error propagates.
		const undo = vi.fn(async () => {});
		const rb = createRollback();
		const abortError = new Error("client aborted");

		await expect(
			rb.step(
				"sync-aborting create",
				(signal) =>
					new Promise<never>((_, reject) => {
						signal.addEventListener("abort", () => reject(abortError));
					}),
				undo,
				{ timeout: 10 },
			),
		).rejects.toBe(abortError); // NOT a TimeoutError

		// the distinction is cosmetic: either way nothing was registered
		expect(undo).not.toHaveBeenCalled();
	});

	test("a run that rejects asynchronously on abort still surfaces TimeoutError", async () => {
		// an async reject (fetch, DB drivers) lands after TimeoutError is already
		// thrown, so the timeout wins the race — the common, reliable case.
		const undo = vi.fn(async () => {});
		const rb = createRollback();

		await expect(
			rb.step(
				"async-aborting create",
				(signal) =>
					new Promise<never>((_, reject) => {
						signal.addEventListener("abort", () => {
							Promise.resolve().then(() => reject(new Error("client aborted")));
						});
					}),
				undo,
				{ timeout: 10 },
			),
		).rejects.toBeInstanceOf(TimeoutError);

		expect(undo).not.toHaveBeenCalled();
	});

	test("forwards description and stopOnFailure to the registered op", async () => {
		const rb = createRollback();
		const boom = new Error("undo failed");

		// older step first, so it remains pending when the newer one halts
		await rb.step(
			"older",
			async () => "older",
			async () => {},
		);
		await rb.step(
			"create thing",
			async () => "ok",
			async () => {
				throw boom;
			},
			{ stopOnFailure: true },
		);

		const { failures, pending } = await rb.rollback();
		expect(failures).toEqual([{ description: "create thing", error: boom }]);
		// per-op stopOnFailure halted before the older step's undo ran
		expect(pending.map((op) => op.description)).toEqual(["older"]);
	});

	test("throws when the instance is already rolled back", async () => {
		const rb = createRollback();
		await rb.rollback();

		await expect(
			rb.step(
				"late",
				async () => "x",
				async () => {},
			),
		).rejects.toBeInstanceOf(RolledBackError);
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

	test("timeout rolls back what was registered and throws TimeoutError", async () => {
		const undo = vi.fn(async () => {});

		await expect(
			withRollback(
				async (rb) => {
					rb.add("undo", undo);
					await new Promise(() => {}); // hang past the budget
				},
				{ timeout: 10 },
			),
		).rejects.toBeInstanceOf(TimeoutError);

		expect(undo).toHaveBeenCalledOnce(); // the prior step was unwound
	});

	test("passes an abort signal that fires on timeout", async () => {
		let aborted = false;

		await expect(
			withRollback(
				async (_rb, signal) => {
					signal.addEventListener("abort", () => {
						aborted = true;
					});
					await new Promise(() => {});
				},
				{ timeout: 10 },
			),
		).rejects.toBeInstanceOf(TimeoutError);

		expect(aborted).toBe(true);
	});

	test("does not time out when fn settles in time", async () => {
		const result = await withRollback(
			async () => {
				await new Promise((resolve) => setTimeout(resolve, 1));
				return "ok";
			},
			{ timeout: 100 },
		);

		expect(result).toBe("ok");
	});

	test("an inline step timeout rolls back the prior steps' undos and throws TimeoutError", async () => {
		const undoFirst = vi.fn(async () => {});
		const undoSecond = vi.fn(async () => {});

		await expect(
			withRollback(async (rb) => {
				await rb.step("first", async () => "first", undoFirst);
				await rb.step("second", async () => "second", undoSecond);
				// this step's own timeout fires; nothing for it is registered
				await rb.step(
					"slow",
					() => new Promise<string>(() => {}), // never settles
					async () => {},
					{ timeout: 10 },
				);
			}),
		).rejects.toBeInstanceOf(TimeoutError);

		// the timeout propagated into the rollback path, unwinding what was
		// registered before the slow step, newest-first
		expect(undoSecond).toHaveBeenCalledOnce();
		expect(undoFirst).toHaveBeenCalledOnce();
	});

	test("onFailures observes a failing undo after a timeout rollback", async () => {
		const undoError = new Error("undo failed");
		const onFailures = vi.fn();

		await expect(
			withRollback(
				async (rb) => {
					rb.add("undo", async () => {
						throw undoError;
					});
					await new Promise(() => {}); // hang past the budget
				},
				{ timeout: 10, onFailures },
			),
		).rejects.toBeInstanceOf(TimeoutError);

		expect(onFailures).toHaveBeenCalledWith({
			failures: [{ description: "undo", error: undoError }],
			pending: [],
		});
	});

	test("a step still running when the outer timeout fires refuses to register its undo", async () => {
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const undo = vi.fn(async () => {});
		let stepPromise: Promise<unknown> | undefined;

		await expect(
			withRollback(
				async (rb) => {
					// run is still in flight when the outer budget elapses
					stepPromise = rb.step(
						"slow create",
						() => gate.then(() => "done"),
						undo,
					);
					await new Promise(() => {}); // hang so the outer timeout triggers
				},
				{ timeout: 10 },
			),
		).rejects.toBeInstanceOf(TimeoutError);

		// let the in-flight run resolve now; the post-run guard sees the
		// rolled-back instance and surfaces it like any post-rollback add
		release?.();
		await expect(stepPromise).rejects.toBeInstanceOf(RolledBackError);
		expect(undo).not.toHaveBeenCalled(); // never registered, never unwound
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
