import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

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

const KEYWORDS = new Set([
	"await",
	"case",
	"const",
	"delete",
	"do",
	"else",
	"export",
	"for",
	"function",
	"if",
	"import",
	"in",
	"instanceof",
	"let",
	"new",
	"return",
	"switch",
	"throw",
	"typeof",
	"var",
	"void",
	"while",
	"yield",
]);

// A `/` directly after one of these starts a regex literal, not a division.
const REGEX_PRECEDING_KEYWORDS = new Set([
	"await",
	"case",
	"delete",
	"do",
	"else",
	"in",
	"instanceof",
	"new",
	"return",
	"throw",
	"typeof",
	"void",
	"yield",
]);

// Words that end the bounded import/export lookahead: past them the statement
// is a declaration whose body the main loop must keep scanning as code.
const STATEMENT_STOP_WORDS = new Set([
	"async",
	"class",
	"const",
	"default",
	"function",
	"let",
	"var",
]);

function decodeEscapes(raw) {
	let out = "";
	for (let k = 0; k < raw.length; k++) {
		const c = raw[k];
		if (c !== "\\") {
			out += c;
			continue;
		}
		const d = raw[++k];
		switch (d) {
			case undefined:
				out += "\\";
				break;
			case "n":
				out += "\n";
				break;
			case "t":
				out += "\t";
				break;
			case "r":
				out += "\r";
				break;
			case "b":
				out += "\b";
				break;
			case "f":
				out += "\f";
				break;
			case "v":
				out += "\v";
				break;
			case "0":
				out += "\0";
				break;
			case "x": {
				const hex = raw.slice(k + 1, k + 3);
				if (/^[0-9a-fA-F]{2}$/.test(hex)) {
					out += String.fromCodePoint(Number.parseInt(hex, 16));
					k += 2;
				} else {
					out += "x";
				}
				break;
			}
			case "u": {
				if (raw[k + 1] === "{") {
					const close = raw.indexOf("}", k + 2);
					const code = raw.slice(k + 2, close);
					if (close > 0 && /^[0-9a-fA-F]{1,6}$/.test(code)) {
						out += String.fromCodePoint(Number.parseInt(code, 16));
						k = close;
					} else {
						out += "u";
					}
				} else {
					const hex = raw.slice(k + 1, k + 5);
					if (/^[0-9a-fA-F]{4}$/.test(hex)) {
						out += String.fromCodePoint(Number.parseInt(hex, 16));
						k += 4;
					} else {
						out += "u";
					}
				}
				break;
			}
			default:
				out += d;
		}
	}
	return out;
}

// Value-level module specifiers only: skips `import type`, `export type`,
// comments, string and regex contents, and records the first argument of
// dynamic `import()` / `require()`. Implemented as a small lexer so it does
// not depend on the TypeScript compiler API, which TS 7 (tsgo) removed; only
// the `tsc` CLI is used elsewhere, so this script stays version-agnostic.
//
// Design invariants:
// - the main loop never skips past a statement body, so `require()` /
//   `import()` inside exported functions are still recorded;
// - statements are never consumed beyond a newline at brace depth 0, so
//   semicolon-less files do not hide later imports;
// - only the first argument of `import(...)`/`require(...)` is read;
//   comments in front of it are trivia, and a second options argument is
//   ignored;
// - `.`-qualified `import`/`require` and `function require(` declarations are
//   not calls;
// - template-literal specifiers report as non-literal, matching the previous
//   AST behavior (only quoted strings counted).
//
// Known simplifications (none occur in this repo's sources): a specifier
// starting on the line after its `from` keyword is not matched, and a class
// method named `require` is read as a call.
export function runtimeSpecifiers(source) {
	const specifiers = [];
	const n = source.length;
	let i = 0;
	// Last significant atom: null | "ident" | "num" | "str" | "regex" |
	// `kw:<word>` | `punct:<char>`. Drives regex-vs-division and the
	// property-access exclusion.
	let prev = null;
	// Brace depth of each open `${` interpolation, innermost last.
	const interp = [];

	const isWordChar = (c) =>
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
				c === "\r" ||
				c === "\n" ||
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

	function readWord() {
		skipTrivia();
		const start = i;
		while (i < n && isWordChar(source[i])) i++;
		return source.slice(start, i);
	}

	function peekWord() {
		const save = i;
		const word = readWord();
		i = save;
		return word;
	}

	// Reads a quoted string at `source[i]` (`'` or `"`), returning the decoded
	// runtime value. Template literals are handled by the main loop.
	function readQuoted() {
		const quote = source[i];
		i++;
		let raw = "";
		while (i < n) {
			const c = source[i];
			if (c === "\\") {
				raw += c + (source[i + 1] ?? "");
				i += 2;
				continue;
			}
			if (c === quote) {
				i++;
				return { ok: true, value: decodeEscapes(raw) };
			}
			if (c === "\n") {
				return { ok: false, value: "" };
			}
			raw += c;
			i++;
		}
		return { ok: false, value: "" };
	}

	// Scans a template segment starting just after an opening backtick or an
	// interpolation's closing `}`. Leaves the cursor after a closing backtick
	// ("done") or after `${` ("interp").
	function readTemplateSegment() {
		while (i < n) {
			const c = source[i];
			if (c === "\\") {
				i += 2;
				continue;
			}
			if (c === "`") {
				i++;
				return "done";
			}
			if (c === "$" && source[i + 1] === "{") {
				i += 2;
				return "interp";
			}
			i++;
		}
		return "done";
	}

	function skipRegexAtom() {
		i++;
		let inClass = false;
		while (i < n) {
			const c = source[i];
			if (c === "\\") {
				i += 2;
				continue;
			}
			if (c === "\n") break;
			if (inClass) {
				if (c === "]") inClass = false;
				i++;
				continue;
			}
			if (c === "[") {
				inClass = true;
				i++;
				continue;
			}
			if (c === "/") {
				i++;
				break;
			}
			i++;
		}
	}

	function skipNumberAtom() {
		if (source[i] === "0" && /[xX]/.test(source[i + 1] ?? "")) {
			i += 2;
			while (i < n && /[0-9a-fA-F_]/.test(source[i])) i++;
			return;
		}
		while (i < n) {
			const c = source[i];
			if (isWordChar(c) || c === ".") {
				i++;
				continue;
			}
			if ((c === "+" || c === "-") && /[eE]/.test(source[i - 1] ?? "")) {
				i++;
				continue;
			}
			break;
		}
	}

	function regexAllowed() {
		if (prev === null) return true;
		if (prev === "num" || prev === "str" || prev === "regex") return false;
		if (prev === "ident") return false;
		if (prev.startsWith("kw:")) {
			return REGEX_PRECEDING_KEYWORDS.has(prev.slice(3));
		}
		if (prev.startsWith("punct:")) {
			return prev !== "punct:)" && prev !== "punct:]";
		}
		return true;
	}

	// Reads just the first argument of `import(...)` / `require(...)` from the
	// opening parenthesis. Returns the decoded specifier for a quoted string,
	// null for anything else (non-literal, matching the AST-based version).
	function readFirstArgument() {
		i++;
		skipTrivia();
		const c = source[i];
		if (c === "'" || c === '"') {
			const lit = readQuoted();
			return lit.ok ? lit.value : null;
		}
		return null;
	}

	function skipTemplateAtom() {
		i++;
		let depth = 0;
		while (i < n) {
			const c = source[i];
			if (c === "\\") {
				i += 2;
				continue;
			}
			if (c === "$" && source[i + 1] === "{") {
				depth++;
				i += 2;
				continue;
			}
			if (c === "}" && depth > 0) {
				depth--;
				i++;
				continue;
			}
			if (c === "`" && depth === 0) {
				i++;
				return;
			}
			i++;
		}
	}

	// Pure lookahead within one import/export statement for its module
	// specifier: `from "spec"` or a bare side-effect `"spec"`. Restores the
	// cursor before returning so the caller keeps scanning the statement as
	// ordinary code (nested dynamic imports stay visible). Never crosses a
	// newline at brace depth 0 and stops at tokens that only appear when the
	// keyword is followed by a declaration body instead of a specifier.
	function specifierAfter(keyword) {
		const save = i;
		let depth = 0;
		let sawFrom = false;
		let first = true;
		while (i < n) {
			const c = source[i];
			if (c === "\n") {
				if (depth === 0) break;
				i++;
				continue;
			}
			if (
				c === " " ||
				c === "\t" ||
				c === "\r" ||
				c === "\f" ||
				c === "\v" ||
				c === "\u00a0"
			) {
				i++;
				continue;
			}
			if (c === "/" && source[i + 1] === "/") {
				while (i < n && source[i] !== "\n") i++;
				continue;
			}
			if (c === "/" && source[i + 1] === "*") {
				i += 2;
				while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++;
				i += 2;
				continue;
			}
			if (c === ";") break;
			if (c === "'" || c === '"') {
				const sideEffect =
					first && keyword === "import" && !sawFrom && depth === 0;
				if (sideEffect || (sawFrom && depth === 0)) {
					const lit = readQuoted();
					const value = lit.ok ? lit.value : null;
					i = save;
					return value;
				}
				break;
			}
			if (c === "`") {
				skipTemplateAtom();
				first = false;
				continue;
			}
			if (c === "/" && regexAllowed()) {
				skipRegexAtom();
				first = false;
				continue;
			}
			if (isWordChar(c)) {
				const word = readWord();
				if (depth === 0 && word === "from") {
					sawFrom = true;
					first = false;
					continue;
				}
				if (depth === 0 && STATEMENT_STOP_WORDS.has(word)) break;
				first = false;
				continue;
			}
			if (depth === 0 && (c === "=" || c === "(")) break;
			if (c === "(" || c === "[" || c === "{") {
				depth++;
				i++;
				first = false;
				continue;
			}
			if (c === ")" || c === "]" || c === "}") {
				depth--;
				if (depth < 0) break;
				i++;
				first = false;
				continue;
			}
			i++;
			first = false;
		}
		i = save;
		return null;
	}

	while (i < n) {
		const c = source[i];
		if (
			c === " " ||
			c === "\t" ||
			c === "\r" ||
			c === "\n" ||
			c === "\f" ||
			c === "\v" ||
			c === "\u00a0" ||
			c === "\ufeff"
		) {
			i++;
			continue;
		}
		if (c === "/" && source[i + 1] === "/") {
			while (i < n && source[i] !== "\n") i++;
			continue;
		}
		if (c === "/" && source[i + 1] === "*") {
			i += 2;
			while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++;
			i += 2;
			continue;
		}
		if (c === "'" || c === '"') {
			readQuoted();
			prev = "str";
			continue;
		}
		if (c === "`") {
			i++;
			const state = readTemplateSegment();
			if (state === "interp") {
				interp.push(0);
			} else {
				prev = "str";
			}
			continue;
		}
		if (c === "{" && interp.length > 0) {
			interp[interp.length - 1]++;
			i++;
			continue;
		}
		if (c === "}" && interp.length > 0) {
			const top = interp[interp.length - 1];
			if (top === 0) {
				interp.pop();
				i++;
				const state = readTemplateSegment();
				if (state === "interp") {
					interp.push(0);
				} else {
					prev = "str";
				}
				continue;
			}
			interp[interp.length - 1]--;
			i++;
			continue;
		}
		if (c === "/") {
			if (regexAllowed()) {
				skipRegexAtom();
				prev = "regex";
			} else {
				i++;
				prev = "punct:/";
			}
			continue;
		}
		if (
			(c >= "0" && c <= "9") ||
			(c === "." && /[0-9]/.test(source[i + 1] ?? ""))
		) {
			skipNumberAtom();
			prev = "num";
			continue;
		}
		if (c === "?" && source[i + 1] === ".") {
			i += 2;
			prev = "punct:.";
			continue;
		}
		if (isWordChar(c)) {
			const word = readWord();
			if (word === "import" && prev !== "punct:.") {
				skipTrivia();
				if (source[i] === "(") {
					specifiers.push(readFirstArgument());
					prev = "ident";
					continue;
				}
				if (peekWord() === "type") {
					prev = "kw:import";
					continue;
				}
				const spec = specifierAfter("import");
				if (spec !== null) {
					specifiers.push(spec);
				}
				prev = "kw:import";
				continue;
			}
			if (word === "export" && prev !== "punct:.") {
				if (peekWord() === "type") {
					prev = "kw:export";
					continue;
				}
				const spec = specifierAfter("export");
				if (spec !== null) {
					specifiers.push(spec);
				}
				prev = "kw:export";
				continue;
			}
			if (word === "require" && prev !== "punct:." && prev !== "kw:function") {
				const at = i;
				skipTrivia();
				if (source[i] === "(") {
					specifiers.push(readFirstArgument());
					prev = "ident";
					continue;
				}
				i = at;
			}
			prev = KEYWORDS.has(word) ? `kw:${word}` : "ident";
			continue;
		}
		i++;
		prev = `punct:${c}`;
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

function collectTargets(shipped) {
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
		for (const specifier of runtimeSpecifiers(source)) {
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

function main() {
	const pkg = JSON.parse(readFileSync("package.json", "utf8"));
	const shipped = new Set(pkg.files ?? []);

	const targets = collectTargets(shipped);
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
		for (const specifier of runtimeSpecifiers(source)) {
			if (specifier === null) {
				console.error(`${file}: dynamic import with non-literal specifier`);
				failed = true;
				continue;
			}
			if (!allowed.some((pattern) => pattern.test(specifier))) {
				console.error(
					`${file}: disallowed import ${JSON.stringify(specifier)}`,
				);
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
	console.log(
		`check-imports ok (${targets.map(({ file }) => file).join(", ")})`,
	);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	main();
}
