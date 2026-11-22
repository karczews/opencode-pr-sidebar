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
const SRC_ALLOW = [/^\.\.?\//, /^node:/, /^solid-js$/, /^@opentui\//, /^@opencode\/plugin\//];
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
// `of` is included because the scanner only marks it as a keyword inside a
// `for(...of...)` head, where it is the separator.
const REGEX_PRECEDING_KEYWORDS = new Set([
	"await",
	"case",
	"delete",
	"do",
	"else",
	"in",
	"instanceof",
	"new",
	"of",
	"return",
	"throw",
	"typeof",
	"void",
	"yield",
]);

// Words that, immediately after `export`, begin a declaration body instead
// of a module specifier. Applied to the first token only: `export * as
// default from "m"` uses `default` as a name, and `import async from "m"`
// uses `async` as one.
const EXPORT_STOP_WORDS = new Set(["async", "class", "const", "default", "function", "let", "var"]);

// A `)` closing the parenthesized head of one of these is followed by a
// statement, where a `/` starts a regex: `if (x) /re/.test(s)`. A `)` in
// expression position keeps division: `(total) / divisor`.
const CONTROL_HEAD_KEYWORDS = new Set(["if", "while", "for", "switch", "catch", "with"]);

// JavaScript line terminators. `//` comments end at any of these, and the
// statement lookahead treats all of them as line bounds.
const LINE_TERMINATORS = new Set(["\n", "\r", "\u2028", "\u2029"]);

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
// - every call-shaped `import(...)` is recorded regardless of syntactic
//   position — an `import()` query in a type annotation is a rare false
//   positive, but suppressing any position would also suppress real runtime
//   imports (`typeof import(name)`, ternary arms), the worse direction for
//   a guard;
// - the import/export lookahead never consumes past a line terminator at
//   brace depth 0 (continuing only when the next line starts the specifier),
//   so semicolon-less files do not hide later statements;
// - only the first argument of `import(...)`/`require(...)` is read, and a
//   quoted first argument counts only when the argument ends there —
//   computed specifiers (`"./a" + suffix`) report as non-literal, while
//   paren groups around a literal are transparent, as in the AST
//   (`import(("x"))`);
// - `.`-qualified `import`/`require` and `function require(` declarations are
//   not calls, and zero-argument calls record nothing;
// - template-literal specifiers report as non-literal, matching the previous
//   AST behavior (only quoted strings counted).
//
// Known simplifications (none occur in this repo's sources): a class method
// named `require` is read as a call; a regex literal immediately after a
// binary `+`/`-` is read as division.
export function runtimeSpecifiers(source) {
	const specifiers = [];
	const n = source.length;
	let i = 0;
	// Last significant atom: null | "ident" | "num" | "str" | "regex" |
	// "postfix" | "ctrl" | `kw:<word>` | `punct:<char>`. Drives
	// regex-vs-division and the property-access exclusion.
	let prev = null;
	// Brace depth of each open `${` interpolation, innermost last.
	const interp = [];
	// Token that preceded each open `(`, innermost last. Closing a
	// control-head paren yields "ctrl" so a following `/` is a regex.
	const parens = [];

	const isWordChar = (c) => {
		const cp = c.codePointAt(0);
		if (cp < 128) {
			return (
				(c >= "a" && c <= "z") ||
				(c >= "A" && c <= "Z") ||
				(c >= "0" && c <= "9") ||
				c === "_" ||
				c === "$"
			);
		}
		// Non-ASCII letters stay inside one word (so `prérequire` does not
		// split into a bare `require`), but Unicode whitespace and line
		// terminators separate tokens just like their ASCII counterparts.
		if (
			LINE_TERMINATORS.has(c) ||
			c === "\ufeff" ||
			c === "\u00a0" ||
			c === "\u1680" ||
			(cp >= 0x20_00 && cp <= 0x20_0a) ||
			c === "\u202f" ||
			c === "\u205f" ||
			c === "\u3000"
		) {
			return false;
		}
		return true;
	};

	// ECMAScript whitespace beyond the ASCII set, shared by every trivia
	// reader so `require\u1680("x")` separates tokens the same way a space
	// would.
	const isSpaceChar = (c) => {
		const cp = c.codePointAt(0);
		return (
			c === " " ||
			c === "\t" ||
			c === "\f" ||
			c === "\v" ||
			c === "\u00a0" ||
			c === "\ufeff" ||
			c === "\u1680" ||
			(cp >= 0x20_00 && cp <= 0x20_0a) ||
			c === "\u202f" ||
			c === "\u205f" ||
			c === "\u3000"
		);
	};

	function skipTrivia() {
		while (i < n) {
			const c = source[i];
			// All four line terminators are trivia here; the statement
			// lookahead bounds them separately. U+2028/U+2029 matter as much
			// as LF/CR: `import\u2028("x")` is a valid dynamic import.
			if (isSpaceChar(c) || LINE_TERMINATORS.has(c)) {
				i++;
			} else if (c === "/" && source[i + 1] === "/") {
				while (i < n && !LINE_TERMINATORS.has(source[i])) {
					i++;
				}
			} else if (c === "/" && source[i + 1] === "*") {
				i += 2;
				while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
					i++;
				}
				i += 2;
			} else {
				break;
			}
		}
	}

	function readWord() {
		skipTrivia();
		const start = i;
		while (i < n && isWordChar(source[i])) {
			i++;
		}
		return source.slice(start, i);
	}

	function peekWord() {
		const save = i;
		const word = readWord();
		i = save;
		return word;
	}

	// Reads a quoted string at `source[i]` (`'` or `"`), returning the decoded
	// runtime value. A backslash before a line terminator is a continuation:
	// it is consumed without contributing to the value. U+2028/U+2029 are
	// legal string characters (ES2019), so they do not end the string.
	function readQuoted() {
		const quote = source[i];
		i++;
		let raw = "";
		while (i < n) {
			const c = source[i];
			if (c === "\\") {
				const d = source[i + 1];
				if (d === "\r" && source[i + 2] === "\n") {
					i += 3;
					continue;
				}
				if (LINE_TERMINATORS.has(d)) {
					i += 2;
					continue;
				}
				raw += c + (d ?? "");
				i += 2;
				continue;
			}
			if (c === quote) {
				i++;
				return { ok: true, value: decodeEscapes(raw) };
			}
			if (c === "\n" || c === "\r") {
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
			if (LINE_TERMINATORS.has(c)) {
				break;
			}
			if (inClass) {
				if (c === "]") {
					inClass = false;
				}
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
			while (i < n && /[0-9a-fA-F_]/.test(source[i])) {
				i++;
			}
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
		if (prev === null || prev === "ctrl") {
			return true;
		}
		if (
			prev === "num" ||
			prev === "str" ||
			prev === "regex" ||
			prev === "ident" ||
			prev === "postfix"
		) {
			return false;
		}
		if (prev.startsWith("kw:")) {
			return REGEX_PRECEDING_KEYWORDS.has(prev.slice(3));
		}
		if (prev.startsWith("punct:")) {
			return prev !== "punct:)" && prev !== "punct:]";
		}
		return true;
	}

	// Reads just the first argument of `import(...)` / `require(...)` from the
	// opening parenthesis. Returns the decoded specifier for a complete
	// quoted argument (paren groups around it are transparent, as in the
	// AST-based version: `import(("x"))`), null for a non-literal one
	// (computed or template), and undefined when the call has no arguments
	// (nothing to record, matching the AST-based version).
	function readFirstArgument() {
		// Every consumed `(` counts as an open paren like any other, so each
		// `)` pops its own record instead of stealing the record of an
		// enclosing control head: `if (require("x")) /re/.test(s)`.
		parens.push("call");
		i++;
		skipTrivia();
		let inner = 0;
		while (source[i] === "(") {
			parens.push("call");
			inner++;
			i++;
			skipTrivia();
		}
		const c = source[i];
		if (c === ")") {
			return inner === 0 ? undefined : null;
		}
		if (c !== "'" && c !== '"') {
			return null;
		}
		const lit = readQuoted();
		if (!lit.ok) {
			return null;
		}
		// A leading quoted token is only the whole argument when the
		// argument ends there: inner groups must close immediately and be
		// followed by `,` or `)`. `import("./a" + suffix)` and
		// `import(("a") + suffix)` are computed.
		skipTrivia();
		for (let k = 0; k < inner; k++) {
			if (source[i] !== ")") {
				return null;
			}
			parens.pop();
			i++;
			skipTrivia();
		}
		const next = source[i];
		if (next !== ")" && next !== ",") {
			return null;
		}
		return lit.value;
	}

	function recordCall() {
		const arg = readFirstArgument();
		if (arg !== undefined) {
			specifiers.push(arg);
		}
		prev = "ident";
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
	// ordinary code (nested dynamic imports stay visible). The scan stops at
	// `;`, at declaration tokens right after `export`, at a line terminator
	// unless the next line starts the specifier (`from` or the quote), and
	// never at declaration names inside the clause.
	function specifierAfter(keyword) {
		const save = i;
		let depth = 0;
		let sawFrom = false;
		let first = true;
		while (i < n) {
			const c = source[i];
			if (LINE_TERMINATORS.has(c)) {
				if (depth === 0) {
					// A clause may continue on the next line with its
					// specifier. Probe past the full terminator sequence
					// (CRLF is one), spaces, and block comments; anything
					// else ends the statement.
					const at = i;
					if (c === "\r" && source[i + 1] === "\n") {
						i += 2;
					} else {
						i++;
					}
					let next;
					for (;;) {
						while (i < n && isSpaceChar(source[i])) {
							i++;
						}
						next = source[i];
						if (next === "/" && source[i + 1] === "*") {
							i += 2;
							while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
								i++;
							}
							i += 2;
							continue;
						}
						break;
					}
					const nextWord = next !== undefined && isWordChar(next) ? peekWord() : "";
					i = at;
					if (nextWord === "from" || next === "'" || next === '"') {
						i++;
						continue;
					}
					break;
				}
				i++;
				continue;
			}
			if (isSpaceChar(c)) {
				i++;
				continue;
			}
			if (c === "/" && source[i + 1] === "/") {
				while (i < n && !LINE_TERMINATORS.has(source[i])) {
					i++;
				}
				continue;
			}
			if (c === "/" && source[i + 1] === "*") {
				i += 2;
				while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
					i++;
				}
				i += 2;
				continue;
			}
			if (c === ";") {
				break;
			}
			if (c === "'" || c === '"') {
				if (depth > 0) {
					// Quoted binding name inside the clause: `import { "a-b" as a }`.
					readQuoted();
					first = false;
					continue;
				}
				const sideEffect = first && keyword === "import" && !sawFrom && depth === 0;
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
				if (first && keyword === "export" && EXPORT_STOP_WORDS.has(word)) {
					break;
				}
				first = false;
				continue;
			}
			if (depth === 0 && (c === "=" || c === "(")) {
				break;
			}
			if (c === "(" || c === "[" || c === "{") {
				depth++;
				i++;
				first = false;
				continue;
			}
			if (c === ")" || c === "]" || c === "}") {
				depth--;
				if (depth < 0) {
					break;
				}
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

	// `import type` is type-only when `type` is the modifier (followed by a
	// clause or a different binding name), but `import type from "m"` binds
	// `type` as a value and must still be checked.
	function importIsTypeOnly() {
		const save = i;
		readWord(); // consume `type`
		skipTrivia();
		const c = source[i];
		let typeOnly = false;
		if (c === "{" || c === "*") {
			typeOnly = true;
		} else if (c !== undefined && isWordChar(c)) {
			const word = peekWord();
			typeOnly = word !== "from" && word !== "as";
		}
		i = save;
		return typeOnly;
	}

	while (i < n) {
		const c = source[i];
		if (isSpaceChar(c) || c === "\r" || c === "\n" || c === "\u2028" || c === "\u2029") {
			i++;
			continue;
		}
		if (c === "/" && source[i + 1] === "/") {
			while (i < n && !LINE_TERMINATORS.has(source[i])) {
				i++;
			}
			continue;
		}
		if (c === "/" && source[i + 1] === "*") {
			i += 2;
			while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
				i++;
			}
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
				// An interpolation is an expression start: a `/` there is a
				// regex, whatever the tag before the template was.
				prev = "punct:(";
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
					prev = "punct:(";
				} else {
					prev = "str";
				}
				continue;
			}
			interp[interp.length - 1]--;
			i++;
			continue;
		}
		if (c === "(") {
			// Record the token before the paren so the matching `)` knows
			// whether it closed a control head (regex follows) or an
			// expression (division follows).
			parens.push(prev);
			i++;
			prev = "punct:(";
			continue;
		}
		if (c === ")") {
			// A file can open with `(`, so the record may be null (prev at
			// file start); a control head is a recorded `kw:` token.
			const record = parens.pop();
			const closesControlHead =
				typeof record === "string" &&
				record.startsWith("kw:") &&
				CONTROL_HEAD_KEYWORDS.has(record.slice(3));
			prev = closesControlHead ? "ctrl" : "punct:)";
			i++;
			continue;
		}
		if (c === "+") {
			if (source[i + 1] === "+") {
				i += 2;
				// Postfix ends an operand: a following `/` is division.
				prev = "postfix";
				continue;
			}
			i++;
			prev = "punct:+";
			continue;
		}
		if (c === "-") {
			if (source[i + 1] === "-") {
				i += 2;
				prev = "postfix";
				continue;
			}
			i++;
			prev = "punct:-";
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
		if ((c >= "0" && c <= "9") || (c === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
			skipNumberAtom();
			prev = "num";
			continue;
		}
		if (c === "." && source[i + 1] === "." && source[i + 2] === ".") {
			// Spread is not property access: `[...require("x")]` must keep
			// scanning as a call.
			i += 3;
			prev = "punct:...";
			continue;
		}
		if (c === "?" && source[i + 1] === ".") {
			i += 2;
			prev = "punct:.";
			continue;
		}
		if (isWordChar(c)) {
			const word = readWord();
			// A word after `.`/`?.` is a property name: `settings.return`
			// stays an operand, not the `return` keyword, and a property
			// named `import`/`require` is never a call.
			const isProperty = prev === "punct:.";
			if (word === "await" && prev === "kw:for") {
				// `for await (` opens one loop head: keep the `for` marker so
				// the following paren records it, instead of a standalone
				// `await` expression whose `of` would read as division.
				continue;
			}
			if (word === "of" && !isProperty) {
				// `of` is the for-of separator — after which a `/` starts a
				// regex — only inside a `for` head and only when it
				// directly follows a binding (identifier or pattern close):
				// `for (const m of /re/...)`. After `=`, `;`, `(`, or a
				// comma it is an ordinary identifier in a classic head,
				// keeping division: `for (let n = of / 2;;)`.
				const innermost = parens[parens.length - 1];
				const inForOfHead =
					typeof innermost === "string" &&
					innermost === "kw:for" &&
					(prev === "ident" || prev === "punct:]" || prev === "punct:}");
				prev = inForOfHead ? "kw:of" : "ident";
				continue;
			}
			if (word === "import" && !isProperty) {
				skipTrivia();
				if (source[i] === "(") {
					recordCall();
					continue;
				}
				if (peekWord() === "type" && importIsTypeOnly()) {
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
			if (word === "export" && !isProperty) {
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
			if (word === "require" && !isProperty && prev !== "kw:function") {
				const at = i;
				skipTrivia();
				if (source[i] === "(") {
					recordCall();
					continue;
				}
				i = at;
			}
			prev = !isProperty && KEYWORDS.has(word) ? `kw:${word}` : "ident";
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
	const distFiles = new Set([...shipped].filter((f) => f.startsWith("dist/") && f.endsWith(".js")));
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
				console.error(`${file}: disallowed import ${JSON.stringify(specifier)}`);
				failed = true;
				continue;
			}
			if (specifier.startsWith(".")) {
				const resolved = resolveRelative(file, specifier);
				if (resolved === null) {
					console.error(`${file}: unresolved relative import ${JSON.stringify(specifier)}`);
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
}

// import.meta.main is symlink-safe; the argv comparison covers runtimes
// where it is not yet defined. Either way, importing the scanner from the
// test suite leaves main() idle.
const isMain = import.meta.main ?? import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
	main();
}
