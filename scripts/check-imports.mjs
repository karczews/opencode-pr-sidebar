import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

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

// Value-level module specifiers only: skips `import type`, `export type`,
// comments, and string contents by scanning instead of depending on the
// TypeScript compiler API (removed in TS 7 / tsgo). Only the `typescript`
// CLI (`tsc`) is used elsewhere, so this script stays version-agnostic.
function runtimeSpecifiers(_file, source) {
	const specifiers = [];
	const n = source.length;
	let i = 0;

	const isWord = (c) =>
		(c >= "a" && c <= "z") ||
		(c >= "A" && c <= "Z") ||
		(c >= "0" && c <= "9") ||
		c === "_" ||
		c === "$";

	function skipTrivia() {
		while (i < n) {
			const c = source[i];
			if (
				c === " " ||
				c === "\t" ||
				c === "\n" ||
				c === "\r" ||
				c === "\f" ||
				c === "\v" ||
				c === "\u00a0" ||
				c === "\ufeff"
			) {
				i++;
			} else if (c === "/" && source[i + 1] === "/") {
				while (i < n && source[i] !== "\n") i++;
			} else if (c === "/" && source[i + 1] === "*") {
				i += 2;
				while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++;
				i += 2;
			} else {
				break;
			}
		}
	}

	function peekWord() {
		skipTrivia();
		const start = i;
		while (i < n && isWord(source[i])) i++;
		const word = source.slice(start, i);
		i = start;
		return word;
	}

	function readWord() {
		skipTrivia();
		const start = i;
		while (i < n && isWord(source[i])) i++;
		return source.slice(start, i);
	}

	// Reads a string literal at the current position (after trivia).
	// Returns { value, isString } — template literals count as non-literal
	// unless they are plain (no ${}).
	function readStringLiteral() {
		skipTrivia();
		if (i >= n) return null;
		const q = source[i];
		if (q !== "'" && q !== '"' && q !== "`") return null;
		i++;
		let value = "";
		while (i < n) {
			const c = source[i];
			if (c === "\\") {
				value += c + (source[i + 1] ?? "");
				i += 2;
				continue;
			}
			if (q !== "`" && c === q) {
				i++;
				return { value, isString: true };
			}
			if (q === "`") {
				if (c === "`") {
					i++;
					return { value, isString: true };
				}
				if (c === "$" && source[i + 1] === "{") {
					return { value, isString: false };
				}
			}
			if (q !== "`" && c === "\n") break;
			value += c;
			i++;
		}
		return { value, isString: false };
	}

	function skipString() {
		const r = readStringLiteral();
		return r !== null;
	}

	// Skip one balanced (...) group starting at the current `(`.
	// Returns the raw inner text (for dynamic import/require arg sniffing).
	function readParenInner() {
		// caller guarantees source[i] === "("
		i++;
		let depth = 1;
		let inner = "";
		let strQ = null;
		let esc = false;
		while (i < n && depth > 0) {
			const c = source[i];
			if (strQ) {
				inner += c;
				if (esc) {
					esc = false;
				} else if (c === "\\") {
					esc = true;
				} else if (c === strQ) {
					strQ = null;
				}
				i++;
				continue;
			}
			if (c === "'" || c === '"' || c === "`") {
				strQ = c;
				inner += c;
				i++;
				continue;
			}
			if (c === "/" && source[i + 1] === "/") {
				while (i < n && source[i] !== "\n") {
					inner += source[i];
					i++;
				}
				continue;
			}
			if (c === "/" && source[i + 1] === "*") {
				inner += "/*";
				i += 2;
				while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
					inner += source[i];
					i++;
				}
				inner += "*/";
				i += 2;
				continue;
			}
			if (c === "(") depth++;
			if (c === ")") {
				depth--;
				if (depth === 0) {
					i++;
					break;
				}
			}
			inner += c;
			i++;
		}
		return inner;
	}

	function parseStaticFromStatement() {
		// Scan forward to `;` (or end) for `from "spec"` or bare `"spec"`.
		// Caller is positioned right after `import`/`export` (+ optional type check done).
		let found = null;
		let sawFrom = false;
		const save = i;
		while (i < n) {
			skipTrivia();
			if (i >= n || source[i] === ";") {
				break;
			}
			const c = source[i];
			if (c === "'" || c === '"' || c === "`") {
				const before = source.slice(save, i);
				const lit = readStringLiteral();
				if (lit?.isString) {
					if (
						sawFrom ||
						/^\s*import\s*["']/.test(before) ||
						/from\s*$/.test(before)
					) {
						found = lit.value;
						break;
					}
					// side-effect import: import "spec" (no from)
					if (before.trim() === "" || /import\s*$/.test(before)) {
						found = lit.value;
						break;
					}
				}
				continue;
			}
			if (c === "/" && (source[i + 1] === "/" || source[i + 1] === "*")) {
				skipTrivia();
				continue;
			}
			const w = peekWord();
			if (w) {
				if (w === "from") {
					sawFrom = true;
					readWord();
					continue;
				}
				// Stop at start of next statement to avoid跨语句匹配.
				readWord();
				continue;
			}
			if (source[i] === ";") break;
			i++;
			if (i - save > 2000) break;
		}
		// Advance to end of statement so the outer loop continues after `;`.
		while (i < n && source[i] !== ";") {
			if (source[i] === "'" || source[i] === '"' || source[i] === "`") {
				if (!skipString()) i++;
			} else {
				i++;
			}
		}
		if (source[i] === ";") i++;
		return found;
	}

	while (i < n) {
		skipTrivia();
		if (i >= n) break;
		const c = source[i];
		// Skip string literals (their contents are not code).
		if (c === "'" || c === '"' || c === "`") {
			skipString();
			continue;
		}
		if (isWord(c)) {
			const start = i;
			const word = readWord();
			if (word === "import") {
				skipTrivia();
				if (source[i] === "(") {
					const inner = readParenInner().trim();
					const m = inner.match(/^(['"])((?:(?!\1)[\s\S])*)?\1$/);
					if (m) {
						specifiers.push(m[2]);
					} else {
						specifiers.push(null);
					}
					continue;
				}
				// `import type ...` is type-only: skip the statement.
				const next = peekWord();
				if (next === "type") {
					// `import type` always type-only (even `import type "x"`).
					readWord(); // consume `type`
					// Skip to end of statement.
					while (i < n && source[i] !== ";") {
						if (source[i] === "'" || source[i] === '"' || source[i] === "`") {
							if (!skipString()) i++;
						} else {
							i++;
						}
					}
					if (source[i] === ";") i++;
					continue;
				}
				i = start + "import".length;
				const found = parseStaticFromStatement();
				if (found !== null) specifiers.push(found);
				continue;
			}
			if (word === "export") {
				const next = peekWord();
				if (next === "type") {
					readWord();
					while (i < n && source[i] !== ";") {
						if (source[i] === "'" || source[i] === '"' || source[i] === "`") {
							if (!skipString()) i++;
						} else {
							i++;
						}
					}
					if (source[i] === ";") i++;
					continue;
				}
				i = start + "export".length;
				const found = parseStaticFromStatement();
				if (found !== null) specifiers.push(found);
				continue;
			}
			if (word === "require") {
				skipTrivia();
				if (source[i] === "(") {
					const inner = readParenInner().trim();
					const m = inner.match(/^(['"])((?:(?!\1)[\s\S])*)?\1$/);
					if (m) {
						specifiers.push(m[2]);
					} else {
						specifiers.push(null);
					}
				}
				continue;
			}
			continue;
		}
		i++;
	}
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
