import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("setup() claims the sidebar slot, palette commands, and lifecycle events", async () => {
	const outDir = join(root, ".tmp-tui");
	mkdirSync(outDir, { recursive: true });
	try {
		const { transformSolidSource } = await import(
			"../node_modules/@opentui/solid/scripts/solid-transform.js"
		);
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
		const { spawnSync } = await import("node:child_process");
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
		assert.equal(compiled.status, 0, compiled.stderr.toString());

		const plugin = (await import(pathToFileURL(join(outDir, "tui.js")).href))
			.default;
		const { RGBA } = await import("@opentui/core");
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
		const theme = {
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
				lineNumber: { text: c(), background: { added: c(), removed: c() } },
			},
			markdown,
			syntax: {},
			hue: {},
			categorical: [],
			source: () => undefined,
			increase: c,
			decrease: c,
			surface: () => theme,
		};

		const slots = [];
		const layers = [];
		const events = [];
		const context = {
			options: {},
			location: { directory: "/tmp" },
			app: { version: "0.0.0", channel: "test" },
			renderer: {},
			client: {},
			data: {
				on: (type, handler) => {
					events.push({ type, handler });
					return () => {};
				},
				location: { default: () => ({ directory: "/tmp" }) },
			},
			attention: { notify: async () => ({ ok: true }) },
			theme,
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
				toast: { show: () => {} },
			},
		};
		const cleanup = await plugin.setup(context);

		assert.equal(slots.length, 1, "one sidebar claim must be registered");
		assert.equal(slots[0].append, "sidebar.content");
		assert.equal(typeof slots[0].render, "function");

		assert.equal(layers.length, 1, "one keymap layer must be registered");
		assert.equal(layers[0].mode, "global");
		assert.deepEqual(
			layers[0].commands.map((command) => command.id),
			["pr-sidebar.open", "pr-sidebar.copy", "pr-sidebar.refresh"],
		);
		assert.ok(
			layers[0].commands.every((command) => command.palette === true),
			"every command must opt into the palette",
		);
		assert.deepEqual(
			events.map((event) => event.type),
			["session.execution.succeeded", "vcs.branch.updated"],
		);
		assert.equal(typeof cleanup, "function");
		assert.doesNotThrow(() => cleanup());
	} finally {
		rmSync(outDir, { recursive: true, force: true });
	}
});
