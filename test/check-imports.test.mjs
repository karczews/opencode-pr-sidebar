import assert from "node:assert/strict";
import { test } from "node:test";
import { runtimeSpecifiers } from "../scripts/check-imports.mjs";

// Each case pins one lexing behavior of the import scanner. The cases named
// after review findings (exported bodies, regex literals, comment placement,
// semicolon-less statements, property calls, escapes) guard regressions of
// the fixes in scripts/check-imports.mjs.
const CASES = [
	[
		"value import",
		'import { Plugin } from "@opencode/plugin/tui";',
		["@opencode/plugin/tui"],
	],
	[
		"multiline import with inline type members",
		'import {\n\ttype CheckCounts,\n\tclean,\n} from "./model.ts";',
		["./model.ts"],
	],
	["side-effect import", 'import "polyfill.ts";', ["polyfill.ts"]],
	[
		"comment between import and side-effect specifier",
		'import /* side */ "polyfill.ts";',
		["polyfill.ts"],
	],
	["import type is skipped", 'import type { X } from "y";', []],
	[
		"import type without semicolon hides nothing",
		'import type { X } from "y"\nimport { A } from "node:fs";',
		["node:fs"],
	],
	[
		"value import without semicolon hides nothing",
		'import { A } from "node:fs"\nimport { B } from "node:path"',
		["node:fs", "node:path"],
	],
	["export type from is skipped", 'export type { X } from "y";', []],
	["export star from", 'export * from "./other.ts";', ["./other.ts"]],
	["export list from", 'export { a, b } from "./other.ts";', ["./other.ts"]],
	[
		"exported function body is still scanned",
		'export async function load() {\n\treturn import("missing-package");\n}',
		["missing-package"],
	],
	[
		"exported const initializer is still scanned",
		'export const loader = require("node:path");',
		["node:path"],
	],
	["dynamic import literal", 'await import("node:fs");', ["node:fs"]],
	[
		"dynamic import with comment before argument",
		'await import(/* lazy */ "node:fs");',
		["node:fs"],
	],
	[
		"dynamic import with options second argument",
		'await import("node:fs", { with: { type: "json" } });',
		["node:fs"],
	],
	["dynamic import non-literal fails closed", "await import(name);", [null]],
	["require literal", 'const x = require("node:path");', ["node:path"]],
	["require non-literal fails closed", "const x = require(name);", [null]],
	["property require is not a call", 'const x = loader.require("pkg");', []],
	["require declaration is not a call", "function require(name) {}", []],
	["import.meta is not a specifier", "const d = import.meta.dirname;", []],
	[
		"regex containing quotes hides nothing",
		'const quote = /"/; import "missing-package";',
		["missing-package"],
	],
	[
		"division is not a regex",
		'const half = total / require("node:os").cpus().length;',
		["node:os"],
	],
	[
		"template interpolation is scanned as code",
		'const cmd = `run ${require("node:child_process")}`;',
		["node:child_process"],
	],
	[
		"escaped specifier is decoded",
		String.raw`await import("./a\tb");`,
		["./a\tb"],
	],
	[
		"string contents are not code",
		'const s = \'import x from "evil"\';\nimport { A } from "node:fs";',
		["node:fs"],
	],
	[
		"comments hide nothing",
		'// import { X } from "evil";\n/* import "evil" */\nimport { A } from "node:fs";',
		["node:fs"],
	],
	[
		"computed dynamic import is non-literal",
		'await import("./model.js" + suffix);',
		[null],
	],
	[
		"computed specifier prefix is non-literal",
		'await import("node:" + name);',
		[null],
	],
	[
		"default import named async",
		'import async from "missing-package";',
		["missing-package"],
	],
	[
		"namespace re-export named default",
		'export * as default from "./adapter.js";',
		["./adapter.js"],
	],
	[
		"quoted binding name in import clause",
		'import { "adapter-v2" as adapter } from "./adapter.js";',
		["./adapter.js"],
	],
	[
		"type as default binding is still checked",
		'import type from "./adapter.js";\ntype();',
		["./adapter.js"],
	],
	["zero-argument require records nothing", "require();", []],
	[
		"annotation import query fails closed",
		'let x: import("./types").Foo;',
		["./types"],
	],
	[
		"control-head regex is not division",
		'if (ready) /require("external-adapter")/.test(text);',
		[],
	],
	["unicode identifier is one token", 'prérequire("external-adapter");', []],
	[
		"postfix division keeps scanning",
		'const half = count++ / Number(require("external-adapter"));',
		["external-adapter"],
	],
	[
		"keyword property name stays operand context",
		'const ratio = settings.return / Number(require("external-adapter"));',
		["external-adapter"],
	],
	[
		"interpolation regex is not division",
		'const s = tag`${/require("external-adapter")/.test(s)}`;',
		[],
	],
	[
		"backslash line continuation in specifier",
		'import("no\\\n' + 'de:fs");',
		["node:fs"],
	],
	[
		"U+2028 ends line comments",
		'// note\u2028import "missing-package";',
		["missing-package"],
	],
	[
		"clause continues on the next line",
		'import { adapter }\nfrom "./adapter.js";',
		["./adapter.js"],
	],
	[
		"typeof import in value position is a runtime call",
		"const kind = typeof import(name);",
		[null],
	],
	[
		"ternary alternate import is a runtime call",
		'const adapter = ready ? fallback : import("external-adapter");',
		["external-adapter"],
	],
	[
		"leading paren file does not crash",
		'import { A } from "node:fs";\n(async () => {})();',
		["node:fs"],
	],
	[
		"call paren does not steal the control-head record",
		'if (require("node:fs")) /require("external-adapter")/.test(text);',
		["node:fs"],
	],
	[
		"non-breaking space separates tokens",
		'import\u00a0"missing-package";',
		["missing-package"],
	],
	[
		"clause continues across CRLF",
		'import { adapter }\r\nfrom "./adapter.js";',
		["./adapter.js"],
	],
	[
		"spread is not property access",
		'[...require("external-adapter")];',
		["external-adapter"],
	],
	[
		"for-of separator allows a regex",
		'for (const match of /require("external-adapter")/.exec(text) ?? []) {}',
		[],
	],
	[
		"of as identifier keeps division",
		'const of = 1;\nconst r = of / Number(require("external-adapter"));',
		["external-adapter"],
	],
];

test("import scanner extracts runtime specifiers", () => {
	for (const [name, code, expected] of CASES) {
		assert.deepEqual(runtimeSpecifiers(code), expected, name);
	}
});
