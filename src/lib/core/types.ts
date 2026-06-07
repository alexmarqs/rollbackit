export type RollbackOperation = {
	description: string;
	rollback: () => Promise<void>;
};

export type FailedRollback = {
	description: string;
	error: unknown;
};

export type Rollback = {
	add: (description: string, rollback: () => Promise<void>) => void;
	commit: () => void;
	apply: () => Promise<FailedRollback[]>;
	readonly size: number;
};
