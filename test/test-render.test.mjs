import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const PR_VIEW = {
	url: "https://github.com/owner/repo/pull/42",
	number: 42,
	title: "Example smoke PR",
	state: "OPEN",
	isDraft: false,
	additions: 20,
	deletions: 3,
	changedFiles: 2,
	headRefName: "feature",
	baseRefName: "main",
	mergeable: "MERGEABLE",
	mergeStateStatus: "CLEAN",
	reviewDecision: "APPROVED",
	statusCheckRollup: [
		{
			__typename: "CheckRun",
			name: "build",
			status: "COMPLETED",
			conclusion: "SUCCESS",
		},
		{
			__typename: "CheckRun",
			name: "lint",
			status: "COMPLETED",
			conclusion: "FAILURE",
		},
	],
	updatedAt: "2026-11-08T12:00:00Z",
};

const COUNTS = {
	data: {
		repository: {
			pullRequest: {
				comments: { totalCount: 1 },
				reviews: { totalCount: 2 },
				reviewThreads: { totalCount: 1, nodes: [{ isResolved: false }] },
			},
		},
	},
};

function setupWorktree({ repo = "git", branch = "feature", gh = "ok" } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "pr-sidebar-"));
	const bin = join(dir, "bin");
	const repoDir = join(dir, "repo");
	mkdirSync(bin, { recursive: true });
	if (repo === "git") {
		execFileSync("git", [
			"init",
			"-q",
			"-b",
			branch === "detached" ? "feature" : branch,
			repoDir,
		]);
		execFileSync("git", ["-C", repoDir, "config", "user.email", "t@t"]);
		execFileSync("git", ["-C", repoDir, "config", "user.name", "t"]);
		writeFileSync(join(repoDir, "f.txt"), "hi\n");
		execFileSync("git", ["-C", repoDir, "add", "."]);
		execFileSync("git", ["-C", repoDir, "commit", "-qm", "init"]);
		if (branch === "detached") {
			execFileSync("git", [
				"-C",
				repoDir,
				"checkout",
				"-q",
				"--detach",
				"HEAD",
			]);
		}
	} else {
		mkdirSync(repoDir, { recursive: true });
	}
	if (gh === "missing") {
		const gitPath = spawnSync("sh", ["-c", "command -v git"], {
			encoding: "utf8",
		}).stdout.trim();
		execFileSync("ln", ["-s", gitPath, join(bin, "git")]);
	} else {
		const script = [
			"#!/bin/sh",
			`echo "gh-called $*" >> ${join(dir, "calls.log")}`,
			`if [ -f ${join(dir, "fail-now")} ]; then echo "network down" >&2; exit 1; fi`,
			'case "$GH_MODE" in',
			'  absent) echo "no pull requests found for branch" >&2; exit 1;;',
			'  auth) echo "HTTP 401 Bad credentials" >&2; exit 1;;',
			'  ratelimit) echo "API rate limit exceeded" >&2; exit 1;;',
			'  *) if [ "$1" = "pr" ]; then',
			`       cat ${join(dir, "pr.json")}; exit 0`,
			"     fi",
			`     cat ${join(dir, "counts.json")}; exit 0;;`,
			"esac",
		].join("\n");
		writeFileSync(join(bin, "gh"), `${script}\n`, { mode: 0o775 });

		writeFileSync(join(dir, "pr.json"), JSON.stringify(PR_VIEW));
		writeFileSync(join(dir, "counts.json"), JSON.stringify(COUNTS));
	}
	return { dir, repoDir, bin };
}

function ghCalls(dir) {
	try {
		return readFileSync(join(dir, "calls.log"), "utf8")
			.split("\n")
			.filter((line) => line.length > 0);
	} catch {
		return [];
	}
}

async function compilePlugin(outDir) {
	mkdirSync(outDir, { recursive: true });
	const { transformSolidSource } = await import(
		"../node_modules/@opentui/solid/scripts/solid-transform.js"
	);
	const { readFileSync } = await import("node:fs");
	const transformed = await transformSolidSource(
		readFileSync(join(root, "tui.tsx"), "utf8"),
		{
			filename: "tui.tsx",
		},
	);
	writeFileSync(
		join(outDir, "tui.js"),
		transformed.replaceAll('"./model.ts"', '"./model.js"'),
	);
	const compiled = spawnSync(
		process.execPath,
		[
			join(root, "node_modules", "typescript", "bin", "tsc"),
			"model.ts",
			"--outDir",
			outDir,
			"--module",
			"nodenext",
			"--target",
			"es2022",
			"--moduleResolution",
			"nodenext",
			"--strict",
			"--skipLibCheck",
		],
		{ cwd: root },
	);
	assert.equal(
		compiled.status,
		0,
		compiled.stderr.toString() || compiled.stdout.toString(),
	);
}

function makeTheme(RGBA) {
	const c = () => RGBA.fromInts(255, 255, 255, 255);
	const stateful = () => ({
		base: c(),
		hover: c(),
		active: c(),
		disabled: c(),
		state: () => c(),
	});
	const feedback = () => ({
		error: { base: c(), muted: c() },
		warning: { base: c(), muted: c() },
		success: { base: c(), muted: c() },
		info: { base: c(), muted: c() },
	});
	const markdown = {
		text: c(),
		heading: c(),
		link: c(),
		linkText: c(),
		code: c(),
		blockQuote: c(),
		emphasis: c(),
		strong: c(),
		horizontalRule: c(),
		listItem: c(),
		listEnumeration: c(),
		image: c(),
		imageText: c(),
		codeBlock: c(),
	};
	return {
		text: {
			base: c(),
			muted: c(),
			faint: c(),
			action: {
				primary: stateful(),
				secondary: stateful(),
				destructive: stateful(),
			},
			formfield: stateful(),
			feedback: feedback(),
		},
		background: {
			base: c(),
			raised: { base: c(), high: c(), max: c() },
			action: {
				primary: stateful(),
				secondary: stateful(),
				destructive: stateful(),
			},
			formfield: stateful(),
			feedback: {
				error: { base: c() },
				warning: { base: c() },
				success: { base: c() },
				info: { base: c() },
			},
		},
		border: { base: c() },
		scrollbar: { base: c() },
		diff: {
			text: { added: c(), removed: c(), context: c(), hunkHeader: c() },
			background: { added: c(), removed: c(), context: c() },
			highlight: { added: c(), removed: c() },
			lineNumber: {
				text: c(),
				background: { added: c(), removed: c() },
			},
		},
		markdown,
		syntax: {},
		hue: {},
		categorical: [],
		source: () => undefined,
		increase: c,
		decrease: c,
		surface: () => makeTheme(RGBA),
	};
}

async function setupPlugin(directory, toasts = []) {
	const { RGBA } = await import("@opentui/core");
	const outDir = join(root, ".tmp-render");
	const plugin = (
		await import(
			`${pathToFileURL(join(outDir, "tui.js")).href}?x=${Date.now()}`
		)
	).default;
	const slots = [];
	const layers = [];
	const events = [];
	const context = {
		options: {},
		location: { directory },
		app: { version: "0.0.0", channel: "test" },
		renderer: {},
		client: {},
		data: {
			on: (type, handler) => {
				events.push({ type, handler });
				return () => {};
			},
			location: { default: () => ({ directory }) },
		},
		attention: { notify: async () => ({ ok: true }) },
		theme: makeTheme(RGBA),
		themeMode: "dark",
		markdown: { registerCodeBlockRenderer: () => () => {} },
		keymap: {
			layer: (factory) => {
				layers.push(factory());
			},
		},
		storage: {},
		ui: {
			slot: (claim) => {
				slots.push(claim);
				return () => {};
			},
			toast: {
				show: (options) => toasts.push(options),
			},
		},
	};
	const cleanup = await plugin.setup(context);
	assert.equal(slots.length, 1, "one sidebar claim must be registered");
	assert.equal(slots[0].append, "sidebar.content");
	return {
		render: (input = { sessionID: "ses-test" }) => slots[0].render(input),
		cleanup,
		layers,
		events,
	};
}

async function renderCard(directory) {
	const { testRender } = await import("@opentui/solid");
	const harness = await setupPlugin(directory);
	const setup = await testRender(harness.render, { width: 100, height: 40 });
	setup.__harness = harness;
	return setup;
}

async function capture(setup) {
	// The native session can hold the output buffer mid-frame; retry briefly.
	for (let attempt = 0; ; attempt++) {
		try {
			return setup.captureCharFrame();
		} catch (error) {
			if (attempt >= 20 || !String(error).includes("OutputBusy")) {
				throw error;
			}
			await setup.flush();
			await sleep(50);
		}
	}
}

async function pollFor(
	setup,
	predicate,
	{ timeoutMs = 15000, intervalMs = 250 } = {},
) {
	const start = Date.now();
	let frame = await capture(setup);
	while (!predicate(frame)) {
		if (Date.now() - start > timeoutMs) {
			return frame;
		}
		await setup.flush();
		await sleep(intervalMs);
		frame = await capture(setup);
	}
	return frame;
}

async function settle(setup, ms = 5000) {
	const start = Date.now();
	while (Date.now() - start < ms) {
		await setup.flush();
		await sleep(250);
	}
	return capture(setup);
}

function findText(spans, needle) {
	for (let y = 0; y < spans.lines.length; y++) {
		let x = 0;
		for (const span of spans.lines[y].spans) {
			if (typeof span.text === "string" && span.text.includes(needle)) {
				return { x: x + 1, y };
			}
			x += span.width || span.text.length;
		}
	}
	return null;
}

function findTextOnRow(spans, needle, y) {
	let x = 0;
	for (const span of spans.lines[y].spans) {
		if (typeof span.text === "string" && span.text.includes(needle)) {
			return { x: x + 1, y };
		}
		x += span.width || span.text.length;
	}
	return null;
}

function findButton(spans, label) {
	// Buttons share the footer row with "Copy URL"; avoid matching body words.
	const anchor = findText(spans, "Copy URL");
	assert.ok(anchor, "actions row must be visible");
	return findTextOnRow(spans, label, anchor.y);
}

async function runCase(options, fn) {
	const previousPath = process.env.PATH ?? "";
	const previousGhMode = process.env.GH_MODE;
	const { dir, repoDir, bin } = setupWorktree(options);
	try {
		await compilePlugin(join(root, ".tmp-render"));
		if (options.gh === "missing") {
			process.env.PATH = bin;
		} else {
			process.env.PATH = `${bin}${previousPath ? `:${previousPath}` : ""}`;
		}
		if (options.gh && options.gh !== "missing") {
			process.env.GH_MODE = options.gh;
		} else {
			delete process.env.GH_MODE;
		}
		const setup = await renderCard(repoDir);
		try {
			await fn(setup, { dir, repoDir });
		} finally {
			await setup.dispose();
		}
	} finally {
		process.env.PATH = previousPath;
		if (previousGhMode === undefined) {
			delete process.env.GH_MODE;
		} else {
			process.env.GH_MODE = previousGhMode;
		}
		rmSync(dir, { recursive: true, force: true });
	}
}

test("sidebar card renders every P0 field for the current-branch PR", async () => {
	await runCase({}, async (setup) => {
		const frame = await pollFor(
			setup,
			(text) =>
				text.includes("Example smoke PR") && text.includes("Ready to merge"),
		);
		for (const expected of [
			"Pull Request",
			"#42",
			"Example smoke PR",
			"feature",
			"main",
			"Open",
			"Review: Approved",
			"Ready to merge",
			"Checks: 1 passed / 1 failed / 0 pending",
			"+20",
			"-3",
			"2 files",
			"1 unresolved / 4 total",
			"Updated",
			"Checked",
			"Refresh",
		]) {
			assert.ok(
				frame.includes(expected),
				`missing ${JSON.stringify(expected)}`,
			);
		}
		assert.ok(!frame.includes("STALE"), "must not show stale state on success");
	});
});

test("sidebar card hides when the branch has no PR", async () => {
	await runCase({ gh: "absent" }, async (setup, { dir }) => {
		const frame = await settle(setup);
		assert.ok(!frame.includes("Pull Request"), "card must stay hidden");
		assert.ok(!frame.includes("#42"), "must not show another PR");
		assert.ok(!frame.includes("STALE"), "absent PR is not stale data");
		assert.ok(
			!frame.includes("unavailable") && !frame.includes("failed"),
			"absence is not an error",
		);
		assert.ok(ghCalls(dir).length >= 1, "lookup must have been attempted");
	});
});

test("sidebar card hides in non-git directories without querying GitHub", async () => {
	await runCase({ repo: "plain" }, async (setup, { dir }) => {
		const frame = await settle(setup);
		assert.ok(!frame.includes("Pull Request"), "card must stay hidden");
		assert.deepEqual(
			ghCalls(dir),
			[],
			"must not query GitHub outside repositories",
		);
	});
});

test("sidebar card hides on detached HEAD without querying GitHub", async () => {
	await runCase({ branch: "detached" }, async (setup, { dir }) => {
		const frame = await settle(setup);
		assert.ok(!frame.includes("Pull Request"), "card must stay hidden");
		assert.deepEqual(
			ghCalls(dir),
			[],
			"must not query GitHub on detached HEAD",
		);
	});
});

test("sidebar card hides on branch/PR head mismatch without extra queries", async () => {
	await runCase({ branch: "other" }, async (setup, { dir }) => {
		const frame = await settle(setup);
		assert.ok(!frame.includes("Pull Request"), "card must stay hidden");
		assert.ok(!frame.includes("#42"), "must never show a mismatched PR");
		const calls = ghCalls(dir);
		assert.ok(calls.length >= 1, "lookup must have been attempted");
		assert.ok(
			!calls.some((line) => line.includes("graphql")),
			"must not fetch counts for a mismatched PR",
		);
	});
});

test("sidebar card shows authentication errors without PR data", async () => {
	await runCase({ gh: "auth" }, async (setup) => {
		const frame = await pollFor(setup, (text) =>
			text.includes("GitHub authentication required"),
		);
		assert.ok(frame.includes("GitHub authentication required"));
		assert.ok(!frame.includes("#42"), "must not invent PR data");
		assert.ok(!frame.includes("STALE"), "initial failure is not stale data");
	});
});

test("sidebar card shows rate-limit errors without PR data", async () => {
	await runCase({ gh: "ratelimit" }, async (setup) => {
		const frame = await pollFor(setup, (text) =>
			text.includes("GitHub rate limit reached"),
		);
		assert.ok(frame.includes("GitHub rate limit reached"));
		assert.ok(!frame.includes("#42"), "must not invent PR data");
	});
});

test("sidebar card shows CLI-unavailable errors without PR data", async () => {
	await runCase({ gh: "missing" }, async (setup) => {
		const frame = await pollFor(setup, (text) =>
			text.includes("GitHub CLI unavailable"),
		);
		assert.ok(frame.includes("GitHub CLI unavailable"));
		assert.ok(!frame.includes("#42"), "must not invent PR data");
	});
});

test("sidebar card keeps stale data and offers refresh after failures", async () => {
	await runCase({}, async (setup, { dir }) => {
		await pollFor(setup, (text) => text.includes("Example smoke PR"));
		writeFileSync(join(dir, "fail-now"), "1\n");
		const spans = setup.captureSpans();
		const at = findText(spans, "Refresh");
		assert.ok(at, "Refresh button must be visible");
		await setup.mockMouse.click(at.x, at.y, 0);
		const frame = await pollFor(setup, (text) => text.includes("STALE"), {
			timeoutMs: 15000,
		});
		assert.ok(frame.includes("STALE"), "must mark retained data as stale");
		assert.ok(frame.includes("#42"), "must retain the last successful PR");
		assert.ok(
			frame.includes("PR refresh failed"),
			"must name the failure kind",
		);
	});
});

test("open and copy report failures with the URL when launchers are unavailable", async () => {
	const previousPath = process.env.PATH ?? "";
	const previousGhMode = process.env.GH_MODE;
	const previousDisplay = process.env.DISPLAY;
	const { dir, repoDir, bin } = setupWorktree();
	try {
		await compilePlugin(join(root, ".tmp-render"));
		// Shadow the launchers with failing stubs so nothing opens or copies.
		for (const launcher of [
			"open",
			"xdg-open",
			"pbcopy",
			"clip",
			"wl-copy",
			"xclip",
		]) {
			writeFileSync(join(bin, launcher), "#!/bin/sh\nexit 1\n", {
				mode: 0o775,
			});
		}
		process.env.PATH = `${bin}${previousPath ? `:${previousPath}` : ""}`;
		process.env.GH_MODE = "ok";
		// Present a display so openBrowser reaches the stubbed launcher even on headless Linux.
		process.env.DISPLAY = ":99";
		const { testRender } = await import("@opentui/solid");
		const toasts = [];
		const harness = await setupPlugin(repoDir, toasts);
		const setup = await testRender(harness.render, { width: 100, height: 40 });
		try {
			await pollFor(setup, (text) => text.includes("Example smoke PR"));
			for (const [label, expected] of [
				[
					"Open",
					/Could not launch a browser.*https:\/\/github.com\/owner\/repo\/pull\/42/,
				],
				["Copy URL", /Could not copy PR URL/],
			]) {
				toasts.length = 0;
				const at = findButton(setup.captureSpans(), label);
				assert.ok(at, `${label} button must be visible`);
				await setup.mockMouse.click(at.x, at.y, 0);
				const deadline = Date.now() + 15000;
				while (toasts.length === 0 && Date.now() < deadline) {
					await setup.flush();
					await sleep(100);
				}
				assert.equal(toasts.length, 1, `${label} must report an outcome`);
				assert.match(toasts[0].message, expected);
			}
		} finally {
			harness.cleanup?.();
			await setup.dispose();
		}
	} finally {
		process.env.PATH = previousPath;
		if (previousDisplay === undefined) {
			delete process.env.DISPLAY;
		} else {
			process.env.DISPLAY = previousDisplay;
		}
		if (previousGhMode === undefined) {
			delete process.env.GH_MODE;
		} else {
			process.env.GH_MODE = previousGhMode;
		}
		rmSync(dir, { recursive: true, force: true });
	}
});

test("header toggles the card and survives a resize", async () => {
	await runCase({}, async (setup) => {
		await pollFor(setup, (text) => text.includes("Example smoke PR"));
		const spans = setup.captureSpans();
		const at = findText(spans, "Pull Request");
		assert.ok(at, "header must be visible");
		await setup.mockMouse.click(at.x, at.y, 0);
		const collapsed = await pollFor(
			setup,
			(text) => !text.includes("Example smoke PR"),
		);
		assert.ok(
			collapsed.includes("Pull Request"),
			"header stays visible while collapsed",
		);
		assert.ok(
			!collapsed.includes("Ready to merge"),
			"body hides while collapsed",
		);

		await setup.resize(70, 24);
		const resized = await pollFor(setup, (text) =>
			text.includes("Pull Request"),
		);
		assert.ok(
			resized.includes("Pull Request"),
			"card survives resize while collapsed",
		);

		const again = findText(setup.captureSpans(), "Pull Request");
		assert.ok(again, "header must be clickable after resize");
		await setup.mockMouse.click(again.x, again.y, 0);
		const expanded = await pollFor(setup, (text) =>
			text.includes("Ready to merge"),
		);
		assert.ok(expanded.includes("Example smoke PR"), "card expands again");
	});
});
