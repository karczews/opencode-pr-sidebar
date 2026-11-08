import assert from "node:assert/strict";
import { test } from "node:test";
import {
	ageOf,
	clean,
	copyToClipboard,
	countsQuery,
	createMonitor,
	detectRepo,
	errorKind,
	fetchCounts,
	fetchPRView,
	lifecycleOf,
	mergeLineOf,
	openBrowser,
	parseCounts,
	parsePRView,
	run,
	splitPRUrl,
	summarize,
	summarizeChecks,
	summarizeReview,
	type Execute,
	type Snapshot,
} from "../model.ts";

test("run resolves with stdout", async () => {
	const out = await run(
		process.execPath,
		["-e", "process.stdout.write('hi')"],
		process.cwd(),
		new AbortController().signal,
	);
	assert.equal(out, "hi");
});

test("run scrubs repository-selecting env vars", async () => {
	process.env.GH_REPO = "owner/repo";
	try {
		const out = await run(
			process.execPath,
			["-e", "process.stdout.write(process.env.GH_REPO ?? 'unset')"],
			process.cwd(),
			new AbortController().signal,
		);
		assert.equal(out, "unset");
	} finally {
		delete process.env.GH_REPO;
	}
});

test("run rejects on timeout", async () => {
	await assert.rejects(
		run(
			process.execPath,
			["-e", "setTimeout(() => {}, 5000)"],
			process.cwd(),
			new AbortController().signal,
			undefined,
			100,
		),
	);
});

test("run rejects on missing binary", async () => {
	await assert.rejects(
		run(
			"pr-sidebar-definitely-missing-binary",
			[],
			process.cwd(),
			new AbortController().signal,
		),
	);
});

const prViewBase = {
	number: 42,
	url: "https://github.com/owner/repo/pull/42",
	title: "Example",
	state: "OPEN",
	isDraft: false,
	headRefName: "feature",
	baseRefName: "main",
	additions: 20,
	deletions: 3,
	changedFiles: 2,
	updatedAt: "2026-09-10T12:00:00Z",
	mergeStateStatus: "CLEAN",
	mergeable: "MERGEABLE",
	reviewDecision: "APPROVED",
	statusCheckRollup: [],
};

test("parsePRView accepts a valid payload and normalizes lenient fields", () => {
	const pr = parsePRView(
		JSON.stringify({ ...prViewBase, reviewDecision: null }),
	);
	assert.equal(pr.number, 42);
	assert.equal(pr.state, "OPEN");
	assert.equal(pr.reviewDecision, "");
	assert.deepEqual(pr.statusCheckRollup, []);
});

test("parsePRView rejects malformed payloads", () => {
	assert.throws(() => parsePRView("not json"));
	assert.throws(() => parsePRView(JSON.stringify(null)));
	assert.throws(() =>
		parsePRView(JSON.stringify({ ...prViewBase, number: 0 })),
	);
	assert.throws(() =>
		parsePRView(JSON.stringify({ ...prViewBase, state: "DRAFT" })),
	);
	assert.throws(() =>
		parsePRView(JSON.stringify({ ...prViewBase, isDraft: "no" })),
	);
	assert.throws(() =>
		parsePRView(JSON.stringify({ ...prViewBase, additions: -1 })),
	);
	assert.throws(() =>
		parsePRView(JSON.stringify({ ...prViewBase, statusCheckRollup: null })),
	);
	assert.throws(() =>
		parsePRView(
			JSON.stringify({
				...prViewBase,
				url: "https://github.com/owner/repo/pull/43",
			}),
		),
	);
});

test("splitPRUrl rejects non-PR URLs", () => {
	assert.throws(() => splitPRUrl("javascript:alert(1)"));
	assert.throws(() =>
		splitPRUrl("https://user:pass@github.com/owner/repo/pull/1"),
	);
	assert.throws(() => splitPRUrl("https://github.com/owner/repo/issues/1"));
	assert.throws(() => splitPRUrl("https://github.com/owner/repo/pull/abc"));
	assert.deepEqual(splitPRUrl("https://github.com/owner/repo/pull/42"), {
		owner: "owner",
		repo: "repo",
		number: 42,
	});
});

test("clean strips controls and collapses whitespace", () => {
	assert.equal(clean("a\nb\tc"), "a b c");
	assert.equal(clean("a‮b"), "a b");
	assert.equal(clean(undefined), "");
});

test("parseCounts sums totals and counts unresolved threads", () => {
	const counts = parseCounts(
		JSON.stringify({
			data: {
				repository: {
					pullRequest: {
						comments: { totalCount: 2 },
						reviews: { totalCount: 3 },
						reviewThreads: {
							totalCount: 4,
							nodes: [
								{ isResolved: false },
								{ isResolved: true },
								{ isResolved: false },
								{},
							],
						},
					},
				},
			},
		}),
	);
	assert.deepEqual(counts, { unresolvedThreads: 2, totalComments: 9 });
});

test("parseCounts rejects malformed payloads", () => {
	assert.throws(() => parseCounts("not json"));
	assert.throws(() => parseCounts(JSON.stringify({})));
	assert.throws(() =>
		parseCounts(
			JSON.stringify({ data: { repository: { pullRequest: null } } }),
		),
	);
	assert.throws(() =>
		parseCounts(
			JSON.stringify({
				data: {
					repository: {
						pullRequest: {
							comments: { totalCount: -1 },
							reviews: { totalCount: 0 },
							reviewThreads: { totalCount: 0, nodes: [] },
						},
					},
				},
			}),
		),
	);
});

test("countsQuery validates the PR number", () => {
	assert.throws(() => countsQuery("o", "r", 0));
	const query = countsQuery("o", "r", 42);
	assert.match(query, /pullRequest\(number: 42\)/);
});

test("fetch helpers use the locked argv shapes", async () => {
	const calls: { file: string; args: string[] }[] = [];
	const execute: Execute = async (file, args) => {
		calls.push({ file, args });
		return "{}";
	};
	const signal = new AbortController().signal;
	await fetchPRView("/repo", signal, execute);
	await fetchCounts("o", "r", 7, "/repo", signal, execute);
	assert.deepEqual(calls[0], {
		file: "gh",
		args: ["pr", "view", "--json", calls[0].args[3]],
	});
	assert.ok(calls[0].args[3].includes("statusCheckRollup"));
	assert.deepEqual(calls[1].file, "gh");
	assert.ok(calls[1].args.includes("graphql"));
	assert.match(
		calls[1].args[calls[1].args.length - 1],
		/^query=query \{ repository\(owner: "o", name: "r"\)/,
	);
});

test("detectRepo resolves this repository and rejects non-repositories", async () => {
	const signal = new AbortController().signal;
	const here = await detectRepo(process.cwd(), signal);
	assert.ok(here?.root);
	assert.ok(here?.branch);
	const missing = await detectRepo("/tmp", signal);
	assert.equal(missing, null);
});

test("errorKind classifies lookup failures", () => {
	assert.equal(
		errorKind({ stderr: "no pull requests found for branch" }),
		"absent",
	);
	assert.equal(
		errorKind({ stderr: "none of the git remotes is a GitHub remote" }),
		"absent",
	);
	assert.equal(errorKind({ code: "ENOENT" }), "cli-missing");
	assert.equal(errorKind({ stderr: "HTTP 401 Bad credentials" }), "auth");
	assert.equal(errorKind({ stderr: "API rate limit exceeded" }), "rate-limit");
	assert.equal(errorKind(new Error("boom")), "refresh-failed");
});

const summaryBase = {
	number: 1,
	url: "https://github.com/owner/repo/pull/1",
	title: "T",
	state: "OPEN",
	isDraft: false,
	headRefName: "f",
	baseRefName: "main",
	additions: 1,
	deletions: 0,
	changedFiles: 1,
	updatedAt: "2026-09-10T12:00:00Z",
	mergeStateStatus: "CLEAN",
	mergeable: "MERGEABLE",
	reviewDecision: "APPROVED",
	statusCheckRollup: [],
	unresolvedThreads: 0,
	totalComments: 0,
} as const;

function summaryPR(patch: Record<string, unknown>) {
	return { ...summaryBase, ...patch } as unknown as Parameters<
		typeof summarize
	>[0];
}

test("summarizers map lifecycle and review decisions", () => {
	assert.equal(lifecycleOf(summaryPR({ state: "MERGED" })), "Merged");
	assert.equal(lifecycleOf(summaryPR({ state: "CLOSED" })), "Closed");
	assert.equal(lifecycleOf(summaryPR({ isDraft: true })), "Draft");
	assert.equal(lifecycleOf(summaryPR({})), "Open");
	assert.equal(summarizeReview("APPROVED"), "Approved");
	assert.equal(summarizeReview("CHANGES_REQUESTED"), "Changes requested");
	assert.equal(summarizeReview("REVIEW_REQUIRED"), "Review required");
	assert.equal(summarizeReview(""), "No review decision");
	assert.equal(summarizeReview("COMMENTED"), "No review decision");
});

test("mergeLineOf follows combined state, not conflicts alone", () => {
	const cases: [Record<string, unknown>, string][] = [
		[{}, "Ready to merge"],
		[{ isDraft: true }, "Blocked: draft"],
		[{ mergeStateStatus: "DRAFT" }, "Blocked: draft"],
		[{ mergeable: "CONFLICTING" }, "Blocked: merge conflicts"],
		[{ mergeStateStatus: "DIRTY" }, "Blocked: merge conflicts"],
		[{ reviewDecision: "CHANGES_REQUESTED" }, "Changes requested"],
		[{ mergeStateStatus: "BLOCKED" }, "Blocked by repository rules"],
		[{ mergeStateStatus: "BEHIND" }, "Behind base branch"],
		[{ mergeStateStatus: "UNSTABLE" }, "Checks not passing"],
		[{ mergeStateStatus: "HAS_HOOKS" }, "Merge hooks must pass"],
		[
			{ reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "CLEAN" },
			"Awaiting required review",
		],
		[{ mergeStateStatus: "UNKNOWN" }, "Merge status unknown"],
		[{ mergeable: "UNKNOWN" }, "Merge status unknown"],
		[{ state: "MERGED" }, "Merged"],
		[{ state: "CLOSED" }, "Closed without merging"],
	];
	for (const [patch, expected] of cases) {
		assert.equal(
			mergeLineOf(summaryPR(patch)),
			expected,
			JSON.stringify(patch),
		);
	}
});

test("summarizeChecks aggregates without inventing results", () => {
	assert.deepEqual(summarizeChecks([]), {
		passed: 0,
		failed: 0,
		pending: 0,
		skipped: 0,
	});
	const counts = summarizeChecks([
		{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
		{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SKIPPED" },
		{ __typename: "CheckRun", status: "COMPLETED", conclusion: "NEUTRAL" },
		{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" },
		{ __typename: "CheckRun", status: "COMPLETED", conclusion: "CANCELLED" },
		{ __typename: "CheckRun", status: "COMPLETED", conclusion: "TIMED_OUT" },
		{
			__typename: "CheckRun",
			status: "COMPLETED",
			conclusion: "ACTION_REQUIRED",
		},
		{
			__typename: "CheckRun",
			status: "COMPLETED",
			conclusion: "STARTUP_FAILURE",
		},
		{ __typename: "CheckRun", status: "COMPLETED", conclusion: "STALE" },
		{ __typename: "CheckRun", status: "IN_PROGRESS", conclusion: "" },
		{
			__typename: "CheckRun",
			status: "COMPLETED",
			conclusion: "WEIRD_NEW_STATE",
		},
		{ __typename: "StatusContext", state: "SUCCESS" },
		{ __typename: "StatusContext", state: "FAILURE" },
		{ __typename: "StatusContext", state: "ERROR" },
		{ __typename: "StatusContext", state: "EXPECTED" },
		{ __typename: "StatusContext", state: "SKIPPED" },
	]);
	assert.deepEqual(counts, { passed: 2, failed: 8, pending: 3, skipped: 3 });
});

test("summarize composes the card lines", () => {
	const summary = summarize(summaryPR({}));
	assert.deepEqual(summary, {
		lifecycle: "Open",
		review: "Approved",
		checks: { passed: 0, failed: 0, pending: 0, skipped: 0 },
		merge: "Ready to merge",
	});
});

test("ageOf formats relative ages", () => {
	const now = Date.parse("2026-09-10T13:00:00Z");
	assert.equal(ageOf("2026-09-10T12:59:30Z", now), "just now");
	assert.equal(ageOf("2026-09-10T12:00:00Z", now), "1h ago");
	assert.equal(ageOf("2026-09-09T13:00:00Z", now), "1d ago");
	assert.equal(ageOf(undefined, now), "unknown");
	assert.equal(ageOf("not a date", now), "unknown");
});

const monitorBase = {
	number: 42,
	url: "https://github.com/owner/repo/pull/42",
	title: "Example",
	state: "OPEN",
	isDraft: false,
	headRefName: "feature",
	baseRefName: "main",
	additions: 20,
	deletions: 3,
	changedFiles: 2,
	updatedAt: "2026-09-10T12:00:00Z",
	mergeStateStatus: "CLEAN",
	mergeable: "MERGEABLE",
	reviewDecision: "",
	statusCheckRollup: [],
};

function monitorCounts() {
	return JSON.stringify({
		data: {
			repository: {
				pullRequest: {
					comments: { totalCount: 1 },
					reviews: { totalCount: 2 },
					reviewThreads: { totalCount: 1, nodes: [{ isResolved: false }] },
				},
			},
		},
	});
}

type MonitorHarness = {
	monitor: ReturnType<typeof createMonitor>;
	states: Snapshot[];
	ghCalls: number;
	setBranch: (branch: string) => void;
	setFailure: (failure: unknown) => void;
	setClock: (value: number) => void;
	flush: () => Promise<void>;
};

function setupMonitor(): MonitorHarness {
	let clock = 100000;
	let branch = "feature";
	let failure: unknown;
	let ghCalls = 0;
	const states: Snapshot[] = [];
	const pending: {
		resolve: (value: string) => void;
		reject: (reason: unknown) => void;
	}[] = [];
	const monitor = createMonitor({
		directory: () => "/repo",
		publish: (value) => {
			states.push(value);
		},
		now: () => clock,
		execute: (async (file: string, args: string[]) => {
			if (file === "git") {
				return "/repo\nfeature\n".replace("feature", branch);
			}
			ghCalls++;
			if (failure) {
				throw failure;
			}
			if (args.includes("graphql")) {
				return monitorCounts();
			}
			if (pending.length > 0) {
				return new Promise<string>((resolve, reject) => {
					pending.push({ resolve, reject });
				});
			}
			return JSON.stringify(monitorBase);
		}) as Execute,
	});
	const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
	return {
		monitor,
		states,
		get ghCalls() {
			return ghCalls;
		},
		setBranch: (value: string) => {
			branch = value;
		},
		setFailure: (value: unknown) => {
			failure = value;
		},
		setClock: (value: number) => {
			clock = value;
		},
		flush,
	};
}

const state = (harness: MonitorHarness): Snapshot =>
	harness.states[harness.states.length - 1];

test("monitor throttles GitHub, bypasses on force and activity", async () => {
	const harness = setupMonitor();
	harness.monitor.tick();
	await harness.flush();
	await harness.flush();
	assert.equal(harness.ghCalls, 2);
	assert.equal(state(harness).pr?.number, 42);
	harness.monitor.tick();
	await harness.flush();
	assert.equal(harness.ghCalls, 2);
	harness.setClock(100000 + 10000);
	harness.monitor.tick(false, true);
	await harness.flush();
	await harness.flush();
	assert.equal(harness.ghCalls, 4);
	harness.monitor.tick(true);
	await harness.flush();
	await harness.flush();
	assert.equal(harness.ghCalls, 6);
	harness.monitor.stop();
});

test("monitor retains stale data on errors and clears absent PRs", async () => {
	const harness = setupMonitor();
	harness.monitor.tick();
	await harness.flush();
	await harness.flush();
	assert.equal(state(harness).pr?.number, 42);
	harness.setFailure(new Error("network down"));
	harness.monitor.tick(true);
	await harness.flush();
	await harness.flush();
	assert.equal(state(harness).pr?.number, 42);
	assert.equal(state(harness).error, "PR refresh failed");
	harness.setFailure({ stderr: "no pull requests found for branch" });
	harness.monitor.tick(true);
	await harness.flush();
	await harness.flush();
	assert.equal(state(harness).pr, null);
	assert.equal(state(harness).error, "");
	harness.monitor.stop();
});

test("monitor maps error kinds to display strings", async () => {
	const harness = setupMonitor();
	for (const [failure, expected] of [
		[{ code: "ENOENT" }, "GitHub CLI unavailable"],
		[{ stderr: "HTTP 401 Bad credentials" }, "GitHub authentication required"],
		[{ stderr: "API rate limit exceeded" }, "GitHub rate limit reached"],
	] as const) {
		harness.setFailure(failure);
		harness.monitor.tick(true);
		await harness.flush();
		await harness.flush();
		assert.equal(state(harness).error, expected);
	}
	harness.monitor.stop();
});

test("monitor hides mismatched heads and detached HEAD without GitHub calls", async () => {
	const harness = setupMonitor();
	harness.setBranch("other");
	harness.monitor.tick();
	await harness.flush();
	await harness.flush();
	// PR head (feature) does not match the local branch (other): hidden, no error.
	assert.equal(state(harness).pr, null);
	assert.equal(state(harness).error, "");
	const before = harness.ghCalls;
	harness.setBranch("HEAD");
	harness.monitor.tick();
	await harness.flush();
	assert.equal(state(harness).pr, null);
	assert.equal(harness.ghCalls, before);
	harness.monitor.stop();
});

test("monitor discards in-flight responses on branch change and stop", async () => {
	for (const stop of [false, true]) {
		let cwd = "/repo-a";
		let branch = "feature";
		const states: Snapshot[] = [];
		const waiting: { resolve: (value: string) => void }[] = [];
		const monitor = createMonitor({
			directory: () => cwd,
			publish: (value) => {
				states.push(value);
			},
			execute: (async (file: string, args: string[], _cwd: string) => {
				if (args.includes("graphql")) {
					return monitorCounts();
				}
				if (file === "git") {
					return `${_cwd}\n${branch}\n`;
				}
				return new Promise<string>((resolve) => {
					waiting.push({ resolve });
				});
			}) as Execute,
		});
		monitor.tick();
		await new Promise<void>((resolve) => setImmediate(resolve));
		if (stop) {
			monitor.stop();
		} else {
			branch = "next";
			cwd = "/repo-b";
			monitor.tick();
		}
		waiting[0].resolve(JSON.stringify(monitorBase));
		await new Promise<void>((resolve) => setImmediate(resolve));
		await new Promise<void>((resolve) => setImmediate(resolve));
		const last = states[states.length - 1];
		assert.equal(last.pr, null);
		monitor.stop();
	}
});

test("non-repositories publish no PR and query no GitHub", async () => {
	const states: Snapshot[] = [];
	const files: string[] = [];
	const monitor = createMonitor({
		directory: () => "/tmp",
		publish: (value) => {
			states.push(value);
		},
		execute: (async (file: string) => {
			files.push(file);
			throw new Error("not a repository");
		}) as Execute,
	});
	monitor.tick();
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.deepEqual(files, ["git"]);
	assert.equal(states[states.length - 1].pr, null);
	monitor.stop();
});

test("openBrowser falls back instead of launching in SSH, headless, and unsupported sessions", async () => {
	const cases: [NodeJS.Platform, NodeJS.ProcessEnv, RegExp][] = [
		["darwin", { SSH_CONNECTION: "client server" }, /SSH session/],
		["linux", { SSH_CLIENT: "client", DISPLAY: ":0" }, /SSH session/],
		["darwin", { SSH_TTY: "/dev/pts/0" }, /SSH session/],
		["linux", {}, /No graphical display/],
		["win32", {}, /unavailable/],
	];
	for (const [platform, env, expected] of cases) {
		const message = await openBrowser(
			"https://github.com/o/r/pull/1",
			"/repo",
			new AbortController().signal,
			{
				platform,
				env,
				execute: async () => assert.fail("must not launch a browser"),
			},
		);
		assert.match(message ?? "", expected);
	}
});

test("openBrowser launches the platform launcher with the full URL", async () => {
	const cases: [NodeJS.Platform, NodeJS.ProcessEnv, string][] = [
		["darwin", {}, "open"],
		["linux", { DISPLAY: ":0" }, "xdg-open"],
		["linux", { WAYLAND_DISPLAY: "wayland-0" }, "xdg-open"],
	];
	for (const [platform, env, launcher] of cases) {
		const signal = new AbortController().signal;
		let calls = 0;
		const message = await openBrowser(
			"https://github.com/o/r/pull/1",
			"/repo",
			signal,
			{
				platform,
				env,
				execute: async (...args) => {
					calls++;
					assert.deepEqual(args, [
						launcher,
						["https://github.com/o/r/pull/1"],
						"/repo",
						signal,
					]);
					return "";
				},
			},
		);
		assert.equal(calls, 1);
		assert.equal(message, undefined);
	}
});

test("openBrowser reports launcher failures and stays silent after disposal", async () => {
	for (const failure of [{ code: "ENOENT" }, { code: 1 }, { killed: true }]) {
		const message = await openBrowser(
			"https://github.com/o/r/pull/1",
			"/repo",
			new AbortController().signal,
			{
				platform: "darwin",
				env: {},
				execute: async () => {
					throw failure;
				},
			},
		);
		assert.match(message ?? "", /Could not launch a browser.*URL below/);
	}
	const controller = new AbortController();
	assert.equal(
		await openBrowser(
			"https://github.com/o/r/pull/1",
			"/repo",
			controller.signal,
			{
				platform: "darwin",
				env: {},
				execute: async () => {
					controller.abort();
					throw new Error("aborted");
				},
			},
		),
		undefined,
	);
	assert.equal(
		await openBrowser(
			"https://github.com/o/r/pull/1",
			"/repo",
			controller.signal,
			{
				execute: async () => assert.fail("must not launch after disposal"),
			},
		),
		undefined,
	);
});

test("copyToClipboard uses the platform clipboard and reports failure", async () => {
	const cases: [NodeJS.Platform, NodeJS.ProcessEnv, string, string[]][] = [
		["darwin", {}, "pbcopy", []],
		["win32", {}, "clip", []],
		["linux", { WAYLAND_DISPLAY: "w" }, "wl-copy", []],
		["linux", { DISPLAY: ":0" }, "xclip", ["-selection", "clipboard"]],
	];
	for (const [platform, env, file, args] of cases) {
		const signal = new AbortController().signal;
		let seen = false;
		const ok = await copyToClipboard(
			"https://github.com/o/r/pull/1",
			"/repo",
			signal,
			{
				platform,
				env,
				execute: async (f, a, cwd, sig, input) => {
					seen = true;
					assert.equal(f, file);
					assert.deepEqual(a, args);
					assert.equal(cwd, "/repo");
					assert.equal(sig, signal);
					assert.equal(input, "https://github.com/o/r/pull/1");
					return "";
				},
			},
		);
		assert.equal(seen, true);
		assert.equal(ok, true);
	}
	assert.equal(
		await copyToClipboard("x", "/repo", new AbortController().signal, {
			platform: "darwin",
			env: {},
			execute: async () => {
				throw new Error("no clipboard");
			},
		}),
		false,
	);
	const aborted = new AbortController();
	aborted.abort();
	assert.equal(
		await copyToClipboard("x", "/repo", aborted.signal, {
			execute: async () => assert.fail("must not run after disposal"),
		}),
		false,
	);
});

test("disposing the monitor stops all polling work", async () => {
	let clock = 100000;
	let ghCalls = 0;
	const states: Snapshot[] = [];
	const monitor = createMonitor({
		directory: () => "/repo",
		publish: (value) => {
			states.push(value);
		},
		now: () => clock,
		execute: (async (file: string, args: string[]) => {
			if (file === "git") {
				return "/repo\nfeature\n";
			}
			ghCalls++;
			if (args.includes("graphql")) {
				return monitorCounts();
			}
			return JSON.stringify(monitorBase);
		}) as Execute,
	});
	monitor.tick();
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));
	const afterFirst = ghCalls;
	assert.ok(afterFirst > 0);
	monitor.stop();
	clock += 10 * 60 * 1000;
	monitor.tick(true);
	monitor.tick(true, true);
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(ghCalls, afterFirst, "no work may run after stop()");
	assert.ok(states.length > 0);
});
