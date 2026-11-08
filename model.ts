import { execFile } from "node:child_process";

export type CheckEntry = {
	__typename?: string;
	name?: string;
	context?: string;
	state?: string | null;
	status?: string | null;
	conclusion?: string | null;
};

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
	mergeStateStatus: string;
	mergeable: string;
	reviewDecision: string;
	statusCheckRollup: CheckEntry[];
	unresolvedThreads: number;
	totalComments: number;
};

export type FetchErrorKind =
	| "absent"
	| "cli-missing"
	| "auth"
	| "rate-limit"
	| "refresh-failed";

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

export type Execute = typeof run;

export function run(
	file: string,
	args: string[],
	cwd: string,
	signal: AbortSignal,
	input?: string,
	timeoutMs = 15000,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const env: NodeJS.ProcessEnv = {
			...process.env,
			GH_PROMPT_DISABLED: "1",
			GIT_TERMINAL_PROMPT: "0",
			NO_COLOR: "1",
		};
		// A launching shell's overrides must not select another worktree or repository.
		for (const key of [
			"GH_REPO",
			"GIT_DIR",
			"GIT_WORK_TREE",
			"GIT_COMMON_DIR",
			"GIT_INDEX_FILE",
		]) {
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

export async function detectRepo(
	directory: string,
	signal: AbortSignal,
	execute: Execute = run,
): Promise<{ root: string; branch: string } | null> {
	try {
		const out = await execute(
			"git",
			["rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"],
			directory,
			signal,
		);
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
	return execute(
		"gh",
		["pr", "view", "--json", PR_VIEW_FIELDS],
		directory,
		signal,
	);
}

export function countsQuery(
	owner: string,
	repo: string,
	number: number,
): string {
	if (!Number.isInteger(number) || number < 1) {
		throw new Error("Invalid PR number");
	}
	return `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) { pullRequest(number: ${number}) { comments(first: 1) { totalCount } reviews(first: 1) { totalCount } reviewThreads(first: 100) { totalCount nodes { isResolved } } } } }`;
}

export async function fetchCounts(
	owner: string,
	repo: string,
	number: number,
	directory: string,
	signal: AbortSignal,
	execute: Execute = run,
): Promise<string> {
	return execute(
		"gh",
		["api", "graphql", "-f", `query=${countsQuery(owner, repo, number)}`],
		directory,
		signal,
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
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

export function splitPRUrl(url: string): {
	owner: string;
	repo: string;
	number: number;
} {
	const parsed = new URL(url);
	if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
		throw new Error("Invalid PR URL");
	}
	const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)$/.exec(parsed.pathname);
	if (!match) {
		throw new Error("Invalid PR URL");
	}
	return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

function asNonNegativeInt(value: unknown, label: string): number {
	if (!Number.isInteger(value) || (value as number) < 0) {
		throw new Error(`Invalid PR response: ${label}`);
	}
	return value as number;
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
	if (!Number.isInteger(data.number) || (data.number as number) < 1) {
		throw new Error("Invalid PR response: number");
	}
	if (
		data.state !== "OPEN" &&
		data.state !== "CLOSED" &&
		data.state !== "MERGED"
	) {
		throw new Error("Invalid PR response: state");
	}
	if (typeof data.url !== "string") {
		throw new Error("Invalid PR response: url");
	}
	const parts = splitPRUrl(data.url);
	if (parts.number !== data.number) {
		throw new Error("Invalid PR response: url number mismatch");
	}
	for (const key of ["title", "headRefName", "baseRefName", "updatedAt"]) {
		if (typeof data[key] !== "string") {
			throw new Error(`Invalid PR response: ${key}`);
		}
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
				__typename:
					typeof entry.__typename === "string" ? entry.__typename : undefined,
				name: typeof entry.name === "string" ? entry.name : undefined,
				context: typeof entry.context === "string" ? entry.context : undefined,
				state: typeof entry.state === "string" ? entry.state : undefined,
				status: typeof entry.status === "string" ? entry.status : undefined,
				conclusion:
					typeof entry.conclusion === "string" ? entry.conclusion : undefined,
			});
		}
	}
	return {
		number: data.number as number,
		url: data.url,
		title: data.title as string,
		state: data.state,
		isDraft: data.isDraft,
		headRefName: data.headRefName as string,
		baseRefName: data.baseRefName as string,
		additions: asNonNegativeInt(data.additions, "additions"),
		deletions: asNonNegativeInt(data.deletions, "deletions"),
		changedFiles: asNonNegativeInt(data.changedFiles, "changedFiles"),
		updatedAt: data.updatedAt as string,
		mergeStateStatus:
			typeof data.mergeStateStatus === "string"
				? data.mergeStateStatus
				: "UNKNOWN",
		mergeable: typeof data.mergeable === "string" ? data.mergeable : "UNKNOWN",
		reviewDecision:
			typeof data.reviewDecision === "string" ? data.reviewDecision : "",
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
	if (
		!isRecord(data) ||
		!isRecord(data.data) ||
		!isRecord(data.data.repository)
	) {
		throw new Error("Invalid counts response");
	}
	const pr = (data.data.repository as Record<string, unknown>).pullRequest;
	if (!isRecord(pr)) {
		throw new Error("Invalid counts response: pullRequest");
	}
	const totalOf = (key: string): number => {
		const section = pr[key];
		if (!isRecord(section)) {
			throw new Error(`Invalid counts response: ${key}`);
		}
		return asNonNegativeInt(section.totalCount, key);
	};
	const comments = totalOf("comments");
	const reviews = totalOf("reviews");
	const threadsSection = pr.reviewThreads;
	if (!isRecord(threadsSection)) {
		throw new Error("Invalid counts response: reviewThreads");
	}
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
	if (
		/no pull requests? found|no GitHub remotes|none of the git remotes.*GitHub/i.test(
			text,
		)
	) {
		return "absent";
	}
	if (detail.code === "ENOENT") {
		return "cli-missing";
	}
	if (
		/auth login|authentication|HTTP 401|Bad credentials|not logged/i.test(text)
	) {
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

export function summarizeChecks(rollup: CheckEntry[]): CheckCounts {
	const counts: CheckCounts = { passed: 0, failed: 0, pending: 0, skipped: 0 };
	for (const check of rollup) {
		let category: keyof CheckCounts;
		if (check.__typename === "StatusContext") {
			if (check.state === "SUCCESS") {
				category = "passed";
			} else if (check.state === "FAILURE" || check.state === "ERROR") {
				category = "failed";
			} else if (check.state === "SKIPPED") {
				category = "skipped";
			} else {
				category = "pending";
			}
		} else if (check.status !== "COMPLETED") {
			category = "pending";
		} else if (check.conclusion === "SUCCESS") {
			category = "passed";
		} else if (
			check.conclusion === "SKIPPED" ||
			check.conclusion === "NEUTRAL"
		) {
			category = "skipped";
		} else if (
			check.conclusion === "FAILURE" ||
			check.conclusion === "CANCELLED" ||
			check.conclusion === "TIMED_OUT" ||
			check.conclusion === "ACTION_REQUIRED" ||
			check.conclusion === "STARTUP_FAILURE" ||
			check.conclusion === "STALE"
		) {
			category = "failed";
		} else {
			// Unknown or missing conclusion: never invent a pass or a failure.
			category = "pending";
		}
		counts[category]++;
	}
	return counts;
}

export function summarizeReview(decision: string): string {
	if (decision === "APPROVED") {
		return "Approved";
	}
	if (decision === "CHANGES_REQUESTED") {
		return "Changes requested";
	}
	if (decision === "REVIEW_REQUIRED") {
		return "Review required";
	}
	return "No review decision";
}

export function lifecycleOf(
	pr: Pick<PullRequest, "state" | "isDraft">,
): string {
	if (pr.state === "MERGED") {
		return "Merged";
	}
	if (pr.state === "CLOSED") {
		return "Closed";
	}
	return pr.isDraft ? "Draft" : "Open";
}

export function mergeLineOf(
	pr: Pick<
		PullRequest,
		"state" | "isDraft" | "mergeStateStatus" | "mergeable" | "reviewDecision"
	>,
): string {
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

export function ageOf(
	time: string | number | undefined,
	now: number = Date.now(),
): string {
	const seconds = Math.max(
		0,
		Math.floor((now - new Date(time ?? Number.NaN).getTime()) / 1000),
	);
	if (!Number.isFinite(seconds)) {
		return "unknown";
	}
	if (seconds < 60) {
		return "just now";
	}
	if (seconds < 3600) {
		return `${Math.floor(seconds / 60)}m ago`;
	}
	if (seconds < 86400) {
		return `${Math.floor(seconds / 3600)}h ago`;
	}
	return `${Math.floor(seconds / 86400)}d ago`;
}

export type Summary = {
	lifecycle: string;
	review: string;
	checks: CheckCounts;
	merge: string;
};

export function summarize(pr: PullRequest): Summary {
	return {
		lifecycle: lifecycleOf(pr),
		review: summarizeReview(pr.reviewDecision),
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

const GITHUB_THROTTLE_MS = 60000;
const GITHUB_ACTIVITY_THROTTLE_MS = 10000;

export function displayError(kind: FetchErrorKind): string {
	if (kind === "cli-missing") {
		return "GitHub CLI unavailable";
	}
	if (kind === "auth") {
		return "GitHub authentication required";
	}
	if (kind === "rate-limit") {
		return "GitHub rate limit reached";
	}
	return "PR refresh failed";
}

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
}) {
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
	let attempt = 0;
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
		attempt = 0;
		emit({ pr: null, error: "", fetchedAt: 0, loading: false });
	};

	async function cycle(force: boolean, activity: boolean): Promise<void> {
		if (stopped) {
			return;
		}
		const cwd = directory();
		if (!cwd) {
			if (key) {
				reset("");
			}
			return;
		}
		if (current.directory !== cwd) {
			reset("");
			emit({ directory: cwd });
		}
		const detectController = new AbortController();
		detection = detectController;
		let repo: { root: string; branch: string } | null;
		try {
			repo = await detectRepo(cwd, detectController.signal, execute);
		} catch {
			repo = null;
		} finally {
			if (detection === detectController) {
				detection = undefined;
			}
		}
		if (stopped || directory() !== cwd) {
			return;
		}
		if (!repo) {
			if (key) {
				reset("");
			}
			return;
		}
		const next = JSON.stringify([cwd, repo.root, repo.branch]);
		if (next !== key) {
			reset(next);
		}
		if (current.branch !== repo.branch) {
			emit({ branch: repo.branch });
		}
		if (repo.branch === "HEAD") {
			return;
		}
		if (request) {
			if (!force) {
				return;
			}
			request.abort();
			request = undefined;
		} else if (
			!force &&
			attempt > 0 &&
			now() - attempt <
				(activity ? GITHUB_ACTIVITY_THROTTLE_MS : GITHUB_THROTTLE_MS)
		) {
			return;
		}
		const expected = version;
		const abort = new AbortController();
		request = abort;
		attempt = now();
		emit({ loading: true });
		try {
			const viewText = await fetchPRView(cwd, abort.signal, execute);
			if (
				stopped ||
				expected !== version ||
				directory() !== cwd ||
				abort.signal.aborted
			) {
				return;
			}
			const parsed = parsePRView(viewText);
			if (parsed.headRefName !== repo.branch) {
				emit({ pr: null, error: "", fetchedAt: now() });
				return;
			}
			const parts = splitPRUrl(parsed.url);
			const countsText = await fetchCounts(
				parts.owner,
				parts.repo,
				parsed.number,
				cwd,
				abort.signal,
				execute,
			);
			if (
				stopped ||
				expected !== version ||
				directory() !== cwd ||
				abort.signal.aborted
			) {
				return;
			}
			const counts = parseCounts(countsText);
			emit({ pr: { ...parsed, ...counts }, error: "", fetchedAt: now() });
		} catch (error) {
			if (
				stopped ||
				expected !== version ||
				directory() !== cwd ||
				abort.signal.aborted
			) {
				return;
			}
			const kind = errorKind(error);
			if (kind === "absent") {
				emit({ pr: null, error: "", fetchedAt: now() });
			} else {
				emit({ error: displayError(kind) });
			}
		} finally {
			if (request === abort) {
				request = undefined;
			}
			if (expected === version && !stopped) {
				emit({ loading: false });
			}
		}
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

export async function openBrowser(
	url: string,
	cwd: string,
	signal: AbortSignal,
	{
		env = process.env,
		platform = process.platform,
		execute = run,
	}: {
		env?: NodeJS.ProcessEnv;
		platform?: NodeJS.Platform;
		execute?: Execute;
	} = {},
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
	const launcher =
		platform === "darwin"
			? "open"
			: platform === "linux"
				? "xdg-open"
				: undefined;
	if (!launcher) {
		return "Browser opening is unavailable here. Open the URL below in your browser.";
	}
	try {
		await execute(launcher, [url], cwd, signal);
	} catch {
		if (!signal.aborted) {
			return "Could not launch a browser. Open the URL below in your browser.";
		}
	}
	return undefined;
}

export async function copyToClipboard(
	text: string,
	cwd: string,
	signal: AbortSignal,
	{
		env = process.env,
		platform = process.platform,
		execute = run,
	}: {
		env?: NodeJS.ProcessEnv;
		platform?: NodeJS.Platform;
		execute?: Execute;
	} = {},
): Promise<boolean> {
	if (signal.aborted) {
		return false;
	}
	const command =
		platform === "darwin"
			? { file: "pbcopy", args: [] }
			: platform === "win32"
				? { file: "clip", args: [] }
				: env.WAYLAND_DISPLAY
					? { file: "wl-copy", args: [] }
					: { file: "xclip", args: ["-selection", "clipboard"] };
	try {
		await execute(command.file, command.args, cwd, signal, text);
		return !signal.aborted;
	} catch {
		return false;
	}
}
