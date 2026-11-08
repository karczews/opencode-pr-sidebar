import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { transformSolidSource } from "../node_modules/@opentui/solid/scripts/solid-transform.js";

const root = dirname(dirname(new URL(import.meta.url).pathname));
const dist = join(root, "dist");

// The packaged host does not rewrite bare specifiers for files under
// node_modules (nodeModulesBareSpecifiers: false), and installing its runtime
// packages would create a second reactive graph. Import the host's virtual
// runtime modules instead.
const runtimeModules = new Map([
	["@opentui/solid", "opentui:runtime-module:%40opentui%2Fsolid"],
	["solid-js", "opentui:runtime-module:solid-js"],
	["@opencode/plugin/tui", "opentui:runtime-module:%40opencode%2Fplugin%2Ftui"],
]);

const source = readFileSync(join(root, "tui.tsx"), "utf8");
const transformed = await transformSolidSource(source, { filename: "tui.tsx" });

let output = transformed.replaceAll('"./model.ts"', '"./model.js"');
for (const [bare, virtual] of runtimeModules) {
	const pattern = new RegExp(
		`(from\\s+["'])${bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(["'])`,
		"g",
	);
	output = output.replace(pattern, `$1${virtual}$2`);
}
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, "tui.js"), output);

const compiled = spawnSync(
	process.execPath,
	[
		join(root, "node_modules", "typescript", "bin", "tsc"),
		"model.ts",
		"--outDir",
		"dist",
		"--module",
		"nodenext",
		"--target",
		"es2022",
		"--moduleResolution",
		"nodenext",
		"--strict",
		"--skipLibCheck",
	],
	{ cwd: root, stdio: "inherit" },
);
if (compiled.status !== 0) {
	process.exit(compiled.status ?? 1);
}
console.log("compiled dist/tui.js and dist/model.js");
