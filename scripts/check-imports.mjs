import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

// Runtime allowlist for the packaged plugin. GitHub/npm installs never run
// install scripts, so anything imported here must either be a Node builtin, a
// declared host peer resolved by the host at runtime (source only:
// compile.mjs rewrites these to opentui:runtime-module:* in dist), a relative
// file shipped via package.json `files` (dist) or present in the repo (src),
// or a host virtual module (dist only). See docs/plugin-distribution.md.
const SRC_ENTRIES = ["tui.tsx", "model.ts"];
const SRC_ALLOW = [
	/^\.\.?\//,
	/^node:/,
	/^solid-js$/,
	/^@opentui\//,
	/^@opencode\/plugin\//,
];
const DIST_ALLOW = [/^\.\.?\//, /^node:/, /^opentui:runtime-module:/];

const SPECIFIER =
	/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|\brequire\s*\(\s*)["'`]([^"'`]+)["'`]/g;

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const shipped = new Set(pkg.files ?? []);

function resolveRelative(fromFile, specifier) {
	const base = join(dirname(fromFile), specifier);
	for (const candidate of [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		`${base}.js`,
		join(base, "index.ts"),
	]) {
		if (existsSync(candidate)) {
			return normalize(candidate);
		}
	}
	return null;
}

function collectTargets() {
	const targets = [];
	const seen = new Set();
	const queue = SRC_ENTRIES.map((file) => ({ file, dist: false }));
	while (queue.length > 0) {
		const { file, dist } = queue.pop();
		if (seen.has(file)) {
			continue;
		}
		seen.add(file);
		targets.push({ file, dist });
		let source;
		try {
			source = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		for (const match of source.matchAll(SPECIFIER)) {
			const specifier = match[1];
			if (!specifier.startsWith(".")) {
				continue;
			}
			const resolved = resolveRelative(file, specifier);
			if (resolved && !seen.has(resolved)) {
				queue.push({ file: resolved, dist });
			}
		}
	}
	if (existsSync("dist")) {
		for (const entry of readdirSync("dist")) {
			if (entry.endsWith(".js")) {
				targets.push({ file: join("dist", entry), dist: true });
			}
		}
	}
	return targets;
}

const targets = collectTargets();
let failed = false;
for (const { file, dist } of targets) {
	let source;
	try {
		source = readFileSync(file, "utf8");
	} catch {
		console.error(`${file}: cannot read scan target`);
		failed = true;
		continue;
	}
	const allowed = dist ? DIST_ALLOW : SRC_ALLOW;
	for (const match of source.matchAll(SPECIFIER)) {
		const specifier = match[1];
		if (!allowed.some((pattern) => pattern.test(specifier))) {
			console.error(`${file}: disallowed import ${JSON.stringify(specifier)}`);
			failed = true;
			continue;
		}
		if (specifier.startsWith(".")) {
			const resolved = resolveRelative(file, specifier);
			if (resolved === null) {
				console.error(
					`${file}: unresolved relative import ${JSON.stringify(specifier)}`,
				);
				failed = true;
			} else if (dist && !shipped.has(resolved)) {
				console.error(
					`${file}: ${JSON.stringify(specifier)} resolves to ${resolved}, which is not in package.json files`,
				);
				failed = true;
			}
		}
	}
}

if (failed) {
	console.error(
		"check-imports failed: source imports must be node:*, solid-js, @opentui/*, @opencode/plugin/*, or repo-relative paths; dist imports must be node:*, opentui:runtime-module:*, or paths shipped via package.json files",
	);
	process.exit(1);
}
console.log(`check-imports ok (${targets.map(({ file }) => file).join(", ")})`);
