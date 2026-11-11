import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import {
	ScriptKind,
	ScriptTarget,
	SyntaxKind,
	createSourceFile,
	isExportDeclaration,
	isImportDeclaration,
} from "typescript";

// Runtime allowlist for the packaged plugin. GitHub/npm installs never run
// install scripts, so anything imported at runtime here must either be a Node
// builtin, a declared host peer resolved by the host at runtime (source
// only: compile.mjs rewrites these to opentui:runtime-module:* in dist), a
// relative file shipped via package.json `files` (dist) or present in the
// repo (src), or a host virtual module (dist only). Type-only imports and
// re-exports are erased at compile time and need no runtime package, so they
// are skipped. See docs/plugin-distribution.md.
const SRC_ENTRIES = ["tui.tsx", "model.ts"];
const SRC_ALLOW = [
	/^\.\.?\//,
	/^node:/,
	/^solid-js$/,
	/^@opentui\//,
	/^@opencode\/plugin\//,
];
const DIST_ALLOW = [/^\.\.?\//, /^node:/, /^opentui:runtime-module:/];

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const shipped = new Set(pkg.files ?? []);

function scriptKindFor(file) {
	if (file.endsWith(".tsx")) {
		return ScriptKind.TSX;
	}
	if (file.endsWith(".ts")) {
		return ScriptKind.TS;
	}
	return ScriptKind.JS;
}

// Value-level module specifiers only: skips `import type`, `export type`,
// comments, and string contents by parsing instead of regex matching.
function runtimeSpecifiers(file, source) {
	const ast = createSourceFile(
		file,
		source,
		ScriptTarget.Latest,
		true,
		scriptKindFor(file),
	);
	const specifiers = [];
	const visit = (node) => {
		if (isImportDeclaration(node)) {
			if (!node.importClause?.isTypeOnly && node.moduleSpecifier) {
				specifiers.push(node.moduleSpecifier.getText(ast).slice(1, -1));
			}
		} else if (
			isExportDeclaration(node) &&
			!node.isTypeOnly &&
			node.moduleSpecifier
		) {
			specifiers.push(node.moduleSpecifier.getText(ast).slice(1, -1));
		} else if (node.kind === SyntaxKind.CallExpression) {
			const callee = node.expression;
			const isDynamicImport = callee.kind === SyntaxKind.ImportKeyword;
			const isRequire =
				callee.kind === SyntaxKind.Identifier && callee.text === "require";
			if ((isDynamicImport || isRequire) && node.arguments.length >= 1) {
				const argument = node.arguments[0];
				if (argument.kind === SyntaxKind.StringLiteral) {
					specifiers.push(argument.text);
				} else {
					specifiers.push(null);
				}
			}
		}
		node.forEachChild(visit);
	};
	visit(ast);
	return specifiers;
}

function isFile(path) {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function resolveRelative(fromFile, specifier) {
	const base = join(dirname(fromFile), specifier);
	for (const candidate of [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		`${base}.js`,
		join(base, "index.ts"),
	]) {
		if (isFile(candidate)) {
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
		for (const specifier of runtimeSpecifiers(file, source)) {
			if (typeof specifier !== "string" || !specifier.startsWith(".")) {
				continue;
			}
			const resolved = resolveRelative(file, specifier);
			if (resolved && !seen.has(resolved)) {
				queue.push({ file: resolved, dist });
			}
		}
	}
	// dist targets come from package.json `files`, not just the directory
	// listing, so a missing or renamed build output fails instead of
	// passing silently. Extra .js files on disk are scanned too.
	const distFiles = new Set(
		[...shipped].filter((f) => f.startsWith("dist/") && f.endsWith(".js")),
	);
	if (existsSync("dist")) {
		for (const entry of readdirSync("dist")) {
			if (entry.endsWith(".js")) {
				distFiles.add(join("dist", entry));
			}
		}
	}
	for (const file of distFiles) {
		targets.push({ file, dist: true });
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
	for (const specifier of runtimeSpecifiers(file, source)) {
		if (specifier === null) {
			console.error(`${file}: dynamic import with non-literal specifier`);
			failed = true;
			continue;
		}
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
