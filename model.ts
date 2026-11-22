import { execFile } from "node:child_process";

export type CheckEntry = {
	__typename?: string;
	name?: string;
	context?: string;
	state?: string | null;
	status?: string | null;
	conclusion?: string | null;
};

// gh enum fields, with the fallbacks parsePRView normalizes unknowns to.
const REVIEW_DECISIONS = ["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED", ""] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

const MERGE_STATE_STATUSES = [
	"BEHIND",
	"BLOCKED",
	"CLEAN",
	"DIRTY",
	"DRAFT",
	"HAS_HOOKS",
	"UNKNOWN",
	"UNSTABLE",
] as const;
export type MergeStateStatus = (typeof MERGE_STATE_STATUSES)[number];

const MERGEABLE_STATES = ["MERGEABLE", "CONFLICTING", "UNKNOWN"] as const;
export type Mergeable = (typeof MERGEABLE_STATES)[number];

export type PullRequest = {
	number: number;
	url: string;
	title: string;
	state: "OPEN" | "CLOSED" | "MERGED";
	isDraft: boolean;
	headRefName: string;
	baseRefName: string;
	additions: number;
	deletions: number;
	changedFiles: number;
	updatedAt: string;
	mergeStateStatus: MergeStateStatus;
	mergeable: Mergeable;
	reviewDecision: ReviewDecision;
	statusCheckRollup: CheckEntry[];
	unresolvedThreads: number;
	totalComments: number;
};

export type FetchErrorKind = "absent" | "cli-missing" | "auth" | "rate-limit" | "refresh-failed";

export const PR_VIEW_FIELDS = [
	"url",
	"number",
	"title",
	"state",
	"isDraft",
	"additions",
	"deletions",
	"changedFiles",
	"headRefName",
	"baseRefName",
	"mergeable",
	"mergeStateStatus",
	"reviewDecision",
	"statusCheckRollup",
	"updatedAt",
].join(",");

// --- subprocess execution ---

const REPO_ENV_KEYS = [
	"GH_REPO",
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_COMMON_DIR",
	"GIT_INDEX_FILE",
] as const;

export type RunOptions = {
	cwd: string;
	signal: AbortSignal;
	input?: string;
	timeoutMs?: number;
};

export function run(
	file: string,
	args: string[],
	{ cwd, signal, input, timeoutMs = 15_000 }: RunOptions,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const env: NodeJS.ProcessEnv = {
			...process.env,
			GH_PROMPT_DISABLED: "1",
			GIT_TERMINAL_PROMPT: "0",
			NO_COLOR: "1",
		};
		// A launching shell's overrides must not select another worktree or repository.
		for (const key of REPO_ENV_KEYS) {
			delete env[key];
		}
		const child = execFile(
			file,
			args,
			{ cwd, env, signal, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error) {
					reject(Object.assign(error, { stderr }));
				} else {
					resolve(stdout);
				}
			},
		);
		child.stdin?.on("error", () => {});
		child.stdin?.end(input);
	});
}

export type Execute = typeof run;

export type Repo = {
	root: string;
	branch: string;
};

export async function detectRepo(
	directory: string,
	signal: AbortSignal,
	execute: Execute = run,
): Promise<Repo | null> {
	try {
		const out = await execute("git", ["rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"], {
			cwd: directory,
			signal,
		});
		const [root, branch] = out.trim().split("\n");
		if (!root || !branch) {
			return null;
		}
		return { root, branch };
	} catch {
		return null;
	}
}

export async function fetchPRView(
	directory: string,
	signal: AbortSignal,
	execute: Execute = run,
): Promise<string> {
	return execute("gh", ["pr", "view", "--json", PR_VIEW_FIELDS], { cwd: directory, signal });
}

export function countsQuery(ref: PRRef): string {
	if (!Number.isInteger(ref.number) || ref.number < 1) {
		throw new Error("Invalid PR number");
	}
	return `query {
		repository(owner: ${JSON.stringify(ref.owner)}, name: ${JSON.stringify(ref.repo)}) {
			pullRequest(number: ${ref.number}) {
				comments(first: 1) { totalCount }
				reviews(first: 1) { totalCount }
				reviewThreads(first: 100) { totalCount nodes { isResolved } }
			}
		}
	}`;
}

export async function fetchCounts(
	ref: PRRef,
	directory: string,
	signal: AbortSignal,
	execute: Execute = run,
): Promise<string> {
	return execute("gh", ["api", "graphql", "-f", `query=${countsQuery(ref)}`], {
		cwd: directory,
		signal,
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error(label);
	}
	return value;
}

function asString(data: Record<string, unknown>, key: string): string {
	const value = data[key];
	if (typeof value !== "string") {
		throw new Error(`Invalid PR response: ${key}`);
	}
	return value;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return allowed.includes(value as T) ? (value as T) : fallback;
}

export function clean(value: unknown): string {
	return (
		String(value ?? "")
			// biome-ignore lint/suspicious/noControlCharactersInRegex: strip terminal controls and bidi overrides from host-provided text.
			.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ")
			.replace(/\s+/g, " ")
			.trim()
	);
}

export type PRRef = {
	owner: string;
	repo: string;
	number: number;
};

export function splitPRUrl(url: string): PRRef {
	const parsed = new URL(url);
	if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
		throw new Error("Invalid PR URL");
	}
	const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)$/.exec(parsed.pathname);
	if (!match) {
		throw new Error("Invalid PR URL");
	}
	const [, owner, repo, num] = match;
	if (!owner || !repo || !num) {
		throw new Error("Invalid PR URL");
	}
	return { owner, repo, number: Number(num) };
}

function asNonNegativeInt(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		throw new Error(`Invalid PR response: ${label}`);
	}
	return value;
}

function asPositiveInt(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throw new Error(`Invalid PR response: ${label}`);
	}
	return value;
}

export function parsePRView(
	text: string,
): Omit<PullRequest, "unresolvedThreads" | "totalComments"> {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error("Invalid PR response: not JSON");
	}
	if (!isRecord(data)) {
		throw new Error("Invalid PR response");
	}
	const number = asPositiveInt(data.number, "number");
	if (data.state !== "OPEN" && data.state !== "CLOSED" && data.state !== "MERGED") {
		throw new Error("Invalid PR response: state");
	}
	const url = asString(data, "url");
	const parts = splitPRUrl(url);
	if (parts.number !== number) {
		throw new Error("Invalid PR response: url number mismatch");
	}
	if (typeof data.isDraft !== "boolean") {
		throw new Error("Invalid PR response: isDraft");
	}
	if (!Array.isArray(data.statusCheckRollup)) {
		throw new Error("Invalid PR response: statusCheckRollup");
	}
	const rollup: CheckEntry[] = [];
	for (const entry of data.statusCheckRollup) {
		if (isRecord(entry)) {
			rollup.push({
				__typename: optionalString(entry.__typename),
				name: optionalString(entry.name),
				context: optionalString(entry.context),
				state: optionalString(entry.state),
				status: optionalString(entry.status),
				conclusion: optionalString(entry.conclusion),
			});
		}
	}
	return {
		number,
		url,
		title: asString(data, "title"),
		state: data.state,
		isDraft: data.isDraft,
		headRefName: asString(data, "headRefName"),
		baseRefName: asString(data, "baseRefName"),
		additions: asNonNegativeInt(data.additions, "additions"),
		deletions: asNonNegativeInt(data.deletions, "deletions"),
		changedFiles: asNonNegativeInt(data.changedFiles, "changedFiles"),
		updatedAt: asString(data, "updatedAt"),
		mergeStateStatus: oneOf(data.mergeStateStatus, MERGE_STATE_STATUSES, "UNKNOWN"),
		mergeable: oneOf(data.mergeable, MERGEABLE_STATES, "UNKNOWN"),
		reviewDecision: oneOf(data.reviewDecision, REVIEW_DECISIONS, ""),
		statusCheckRollup: rollup,
	};
}

export function parseCounts(text: string): {
	unresolvedThreads: number;
	totalComments: number;
} {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error("Invalid counts response: not JSON");
	}
	const root = asRecord(data, "Invalid counts response");
	const payload = asRecord(root.data, "Invalid counts response: data");
	const repository = asRecord(payload.repository, "Invalid counts response: repository");
	const pr = asRecord(repository.pullRequest, "Invalid counts response: pullRequest");
	const totalOf = (key: string): number => {
		const section = asRecord(pr[key], `Invalid counts response: ${key}`);
		return asNonNegativeInt(section.totalCount, key);
	};
	const comments = totalOf("comments");
	const reviews = totalOf("reviews");
	const threadsSection = asRecord(pr.reviewThreads, "Invalid counts response: reviewThreads");
	const threads = asNonNegativeInt(threadsSection.totalCount, "reviewThreads");
	if (!Array.isArray(threadsSection.nodes)) {
		throw new Error("Invalid counts response: reviewThreads nodes");
	}
	// Lower bound over the first page when totalCount exceeds the fetched nodes.
	let unresolved = 0;
	for (const node of threadsSection.nodes) {
		if (isRecord(node) && node.isResolved === false) {
			unresolved++;
		}
	}
	return {
		unresolvedThreads: unresolved,
		totalComments: comments + reviews + threads,
	};
}

export function errorKind(error: unknown): FetchErrorKind {
	const detail =
		error && typeof error === "object"
			? (error as { stderr?: unknown; message?: unknown; code?: unknown })
			: {};
	const text = String(detail.stderr ?? detail.message ?? "");
	if (/no pull requests? found|no GitHub remotes|none of the git remotes.*GitHub/i.test(text)) {
		return "absent";
	}
	if (detail.code === "ENOENT") {
		return "cli-missing";
	}
	if (/auth login|authentication|HTTP 401|Bad credentials|not logged/i.test(text)) {
		return "auth";
	}
	if (/rate limit/i.test(text)) {
		return "rate-limit";
	}
	return "refresh-failed";
}

export type CheckCounts = {
	passed: number;
	failed: number;
	pending: number;
	skipped: number;
};

const FAILED_CONCLUSIONS = new Set([
	"FAILURE",
	"CANCELLED",
	"TIMED_OUT",
	"ACTION_REQUIRED",
	"STARTUP_FAILURE",
	"STALE",
]);

function classifyStatusContext(check: CheckEntry): keyof CheckCounts {
	if (check.state === "SUCCESS") {
		return "passed";
	}
	if (check.state === "FAILURE" || check.state === "ERROR") {
		return "failed";
	}
	if (check.state === "SKIPPED") {
		return "skipped";
	}
	return "pending";
}

function classifyCheckRun(check: CheckEntry): keyof CheckCounts {
	if (check.status !== "COMPLETED") {
		return "pending";
	}
	if (check.conclusion === "SUCCESS") {
		return "passed";
	}
	if (check.conclusion === "SKIPPED" || check.conclusion === "NEUTRAL") {
		return "skipped";
	}
	if (check.conclusion != null && FAILED_CONCLUSIONS.has(check.conclusion)) {
		return "failed";
	}
	// Unknown or missing conclusion: never invent a pass or a failure.
	return "pending";
}

function classifyCheck(check: CheckEntry): keyof CheckCounts {
	return check.__typename === "StatusContext"
		? classifyStatusContext(check)
		: classifyCheckRun(check);
}

export function summarizeChecks(rollup: CheckEntry[]): CheckCounts {
	const counts: CheckCounts = { passed: 0, failed: 0, pending: 0, skipped: 0 };
	for (const check of rollup) {
		counts[classifyCheck(check)]++;
	}
	return counts;
}

export function checksLineOf(counts: CheckCounts): string {
	if (counts.passed + counts.failed + counts.pending + counts.skipped === 0) {
		return "No checks reported";
	}
	let line = `Checks: ${counts.passed} passed / ${counts.failed} failed / ${counts.pending} pending`;
	if (counts.skipped > 0) {
		line += ` / ${counts.skipped} skipped`;
	}
	return line;
}

export const summarizeReview: Record<ReviewDecision, string> = {
	APPROVED: "Approved",
	CHANGES_REQUESTED: "Changes requested",
	REVIEW_REQUIRED: "Review required",
	"": "No review decision",
};

export function lifecycleOf(pr: Pick<PullRequest, "state" | "isDraft">): string {
	if (pr.state === "MERGED") {
		return "Merged";
	}
	if (pr.state === "CLOSED") {
		return "Closed";
	}
	return pr.isDraft ? "Draft" : "Open";
}

const MERGE_LINES = [
	"Merged",
	"Closed without merging",
	"Blocked: draft",
	"Blocked: merge conflicts",
	"Changes requested",
	"Blocked by repository rules",
	"Behind base branch",
	"Checks not passing",
	"Merge hooks must pass",
	"Awaiting required review",
	"Ready to merge",
	"Merge status unknown",
] as const;
export type MergeLine = (typeof MERGE_LINES)[number];

export function mergeLineOf(
	pr: Pick<PullRequest, "state" | "isDraft" | "mergeStateStatus" | "mergeable" | "reviewDecision">,
): MergeLine {
	// Order matters: the first matching blocker wins.
	if (pr.state === "MERGED") {
		return "Merged";
	}
	if (pr.state === "CLOSED") {
		return "Closed without merging";
	}
	if (pr.isDraft || pr.mergeStateStatus === "DRAFT") {
		return "Blocked: draft";
	}
	if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY") {
		return "Blocked: merge conflicts";
	}
	if (pr.reviewDecision === "CHANGES_REQUESTED") {
		return "Changes requested";
	}
	if (pr.mergeStateStatus === "BLOCKED") {
		return "Blocked by repository rules";
	}
	if (pr.mergeStateStatus === "BEHIND") {
		return "Behind base branch";
	}
	if (pr.mergeStateStatus === "UNSTABLE") {
		return "Checks not passing";
	}
	if (pr.mergeStateStatus === "HAS_HOOKS") {
		return "Merge hooks must pass";
	}
	if (pr.reviewDecision === "REVIEW_REQUIRED") {
		return "Awaiting required review";
	}
	if (pr.mergeStateStatus === "CLEAN" && pr.mergeable === "MERGEABLE") {
		return "Ready to merge";
	}
	return "Merge status unknown";
}

export type Tone = "success" | "warning" | "error" | "muted" | "base";

// The record must cover every MergeLine, so adding a merge line forces a choice of tone.
export const MERGE_TONE: Record<MergeLine, Tone> = {
	Merged: "success",
	"Closed without merging": "muted",
	"Blocked: draft": "warning",
	"Blocked: merge conflicts": "warning",
	"Changes requested": "warning",
	"Blocked by repository rules": "warning",
	"Behind base branch": "warning",
	"Checks not passing": "warning",
	"Merge hooks must pass": "warning",
	"Awaiting required review": "warning",
	"Ready to merge": "success",
	"Merge status unknown": "muted",
};

export function ageOf(time: string | number | undefined, now: number = Date.now()): string {
	const timestamp = new Date(time ?? Number.NaN).getTime();
	const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
	if (!Number.isFinite(seconds)) {
		return "unknown";
	}
	if (seconds < 60) {
		return "just now";
	}
	if (seconds < 3600) {
		return `${Math.floor(seconds / 60)}m ago`;
	}
	if (seconds < 86_400) {
		return `${Math.floor(seconds / 3600)}h ago`;
	}
	return `${Math.floor(seconds / 86_400)}d ago`;
}

export type Summary = {
	lifecycle: string;
	review: string;
	checks: CheckCounts;
	merge: MergeLine;
};

export function summarize(pr: PullRequest): Summary {
	return {
		lifecycle: lifecycleOf(pr),
		review: summarizeReview[pr.reviewDecision],
		checks: summarizeChecks(pr.statusCheckRollup),
		merge: mergeLineOf(pr),
	};
}

export type Snapshot = {
	pr: PullRequest | null;
	error: string;
	fetchedAt: number;
	now: number;
	loading: boolean;
	directory?: string;
	branch?: string;
};

const GITHUB_THROTTLE_MS = 60_000;
const GITHUB_ACTIVITY_THROTTLE_MS = 10_000;

export const displayError: Record<FetchErrorKind, string> = {
	absent: "PR refresh failed",
	"cli-missing": "GitHub CLI unavailable",
	auth: "GitHub authentication required",
	"rate-limit": "GitHub rate limit reached",
	"refresh-failed": "PR refresh failed",
};

export type Monitor = {
	tick(force?: boolean, activity?: boolean): void;
	stop(): void;
};

export function createMonitor({
	directory,
	publish,
	execute = run,
	now = Date.now,
}: {
	directory: () => string;
	publish: (value: Snapshot) => void;
	execute?: Execute;
	now?: () => number;
}): Monitor {
	let current: Snapshot = {
		pr: null,
		error: "",
		fetchedAt: 0,
		now: now(),
		loading: false,
	};
	let key = "";
	let version = 0;
	let stopped = false;
	let lastFetchAt = 0;
	let request: AbortController | undefined;
	let detection: AbortController | undefined;
	// Serialize cycles so overlapping ticks cannot interleave fetches.
	let tail: Promise<void> = Promise.resolve();

	const emit = (patch: Partial<Snapshot>) => {
		current = { ...current, ...patch, now: now() };
		publish(current);
	};

	const reset = (next: string) => {
		key = next;
		version++;
		request?.abort();
		request = undefined;
		detection?.abort();
		detection = undefined;
		lastFetchAt = 0;
		emit({ pr: null, error: "", fetchedAt: 0, loading: false });
	};

	const isStale = (expected: number, cwd: string, signal: AbortSignal): boolean =>
		stopped || expected !== version || directory() !== cwd || signal.aborted;

	// The context (empty cwd, non-repo) yields nothing: drop whatever an older context left.
	const resetIfKey = (): void => {
		if (key) {
			reset("");
		}
	};

	// Empty or changed directory: clear anything an older context published.
	const currentDirectory = (): string => {
		const cwd = directory();
		if (!cwd) {
			resetIfKey();
			return "";
		}
		if (current.directory !== cwd) {
			reset("");
			emit({ directory: cwd });
		}
		return cwd;
	};

	// The detection AbortController is tracked so a reset or stop can cancel it.
	const detect = async (cwd: string): Promise<Repo | null> => {
		const detectController = new AbortController();
		detection = detectController;
		try {
			return await detectRepo(cwd, detectController.signal, execute);
		} catch {
			return null;
		} finally {
			if (detection === detectController) {
				detection = undefined;
			}
		}
	};

	// Re-key the snapshot when the repo or branch changed, then publish the branch.
	const syncRepo = (cwd: string, repo: Repo): void => {
		const next = JSON.stringify([cwd, repo.root, repo.branch]);
		if (next !== key) {
			reset(next);
		}
		if (current.branch !== repo.branch) {
			emit({ branch: repo.branch });
		}
	};

	// One GitHub request at a time; forced ticks cancel the in-flight one, others wait.
	const shouldFetch = (force: boolean, activity: boolean): boolean => {
		if (request) {
			if (!force) {
				return false;
			}
			request.abort();
			request = undefined;
		} else if (
			!force &&
			lastFetchAt > 0 &&
			now() - lastFetchAt < (activity ? GITHUB_ACTIVITY_THROTTLE_MS : GITHUB_THROTTLE_MS)
		) {
			return false;
		}
		return true;
	};

	const publishError = (
		expected: number,
		cwd: string,
		signal: AbortSignal,
		error: unknown,
	): void => {
		if (isStale(expected, cwd, signal)) {
			return;
		}
		const kind = errorKind(error);
		if (kind === "absent") {
			emit({ pr: null, error: "", fetchedAt: now() });
		} else {
			emit({ error: displayError[kind] });
		}
	};

	const fetchAndPublish = async (cwd: string, repo: Repo): Promise<void> => {
		const expected = version;
		const abort = new AbortController();
		request = abort;
		lastFetchAt = now();
		emit({ loading: true });
		try {
			const viewText = await fetchPRView(cwd, abort.signal, execute);
			if (isStale(expected, cwd, abort.signal)) {
				return;
			}
			const parsed = parsePRView(viewText);
			if (parsed.headRefName !== repo.branch) {
				emit({ pr: null, error: "", fetchedAt: now() });
				return;
			}
			const countsText = await fetchCounts(splitPRUrl(parsed.url), cwd, abort.signal, execute);
			if (isStale(expected, cwd, abort.signal)) {
				return;
			}
			const counts = parseCounts(countsText);
			emit({ pr: { ...parsed, ...counts }, error: "", fetchedAt: now() });
		} catch (error) {
			publishError(expected, cwd, abort.signal, error);
		} finally {
			if (request === abort) {
				request = undefined;
			}
			if (expected === version && !stopped) {
				emit({ loading: false });
			}
		}
	};

	async function cycle(force: boolean, activity: boolean): Promise<void> {
		if (stopped) {
			return;
		}
		const cwd = currentDirectory();
		if (!cwd) {
			return;
		}
		const repo = await detect(cwd);
		if (stopped || directory() !== cwd) {
			return;
		}
		if (!repo) {
			resetIfKey();
			return;
		}
		syncRepo(cwd, repo);
		if (repo.branch === "HEAD") {
			return;
		}
		if (!shouldFetch(force, activity)) {
			return;
		}
		await fetchAndPublish(cwd, repo);
	}

	return {
		tick(force = false, activity = false): void {
			if (stopped) {
				return;
			}
			tail = tail.then(() => cycle(force, activity)).catch(() => {});
		},
		stop() {
			stopped = true;
			version++;
			request?.abort();
			request = undefined;
			detection?.abort();
			detection = undefined;
		},
	};
}

export type PlatformDeps = {
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	execute?: Execute;
};

const LAUNCHERS: Partial<Record<NodeJS.Platform, string>> = {
	darwin: "open",
	linux: "xdg-open",
};

export async function openBrowser(
	url: string,
	cwd: string,
	signal: AbortSignal,
	{ env = process.env, platform = process.platform, execute = run }: PlatformDeps = {},
): Promise<string | undefined> {
	if (signal.aborted) {
		return;
	}
	if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) {
		return "SSH session detected. Open the URL below in your local browser.";
	}
	if (platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
		return "No graphical display detected. Open the URL below in your browser.";
	}
	const launcher = LAUNCHERS[platform];
	if (!launcher) {
		return "Browser opening is unavailable here. Open the URL below in your browser.";
	}
	try {
		await execute(launcher, [url], { cwd, signal });
	} catch {
		if (!signal.aborted) {
			return "Could not launch a browser. Open the URL below in your browser.";
		}
	}
	return undefined;
}

function clipboardCommand(
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
): { file: string; args: string[] } {
	if (platform === "darwin") {
		return { file: "pbcopy", args: [] };
	}
	if (platform === "win32") {
		return { file: "clip", args: [] };
	}
	if (env.WAYLAND_DISPLAY) {
		return { file: "wl-copy", args: [] };
	}
	return { file: "xclip", args: ["-selection", "clipboard"] };
}

export async function copyToClipboard(
	text: string,
	cwd: string,
	signal: AbortSignal,
	{ env = process.env, platform = process.platform, execute = run }: PlatformDeps = {},
): Promise<boolean> {
	if (signal.aborted) {
		return false;
	}
	const command = clipboardCommand(platform, env);
	try {
		await execute(command.file, command.args, { cwd, signal, input: text });
		return !signal.aborted;
	} catch {
		return false;
	}
}
