import { readFileSync } from "node:fs";

// Runtime allowlist for the packaged plugin. GitHub/npm installs never run
// install scripts, so anything imported here must either be a Node builtin, a
// declared host peer resolved by the host at runtime, a relative file packed
// via `files`, or a host virtual module (dist only). See
// docs/plugin-distribution.md.
const TARGETS = ["tui.tsx", "model.ts", "dist/tui.js", "dist/model.js"];

const ALLOWED = [
	/^\.\.?\//,
	/^node:/,
	/^solid-js$/,
	/^@opentui\//,
	/^@opencode\/plugin\//,
	/^opentui:runtime-module:/,
];

const SPECIFIER =
	/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;

let failed = false;
for (const file of TARGETS) {
	const source = readFileSync(file, "utf8");
	for (const match of source.matchAll(SPECIFIER)) {
		const specifier = match[1];
		if (!ALLOWED.some((pattern) => pattern.test(specifier))) {
			console.error(`${file}: disallowed import ${JSON.stringify(specifier)}`);
			failed = true;
		}
	}
}

if (failed) {
	console.error(
		"check-imports failed: runtime imports must be node:*, solid-js, @opentui/*, @opencode/plugin/*, relative paths, or opentui:runtime-module:*",
	);
	process.exit(1);
}
console.log(`check-imports ok (${TARGETS.join(", ")})`);
