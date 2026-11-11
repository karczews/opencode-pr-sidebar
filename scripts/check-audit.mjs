import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

// Gates `npm audit` on moderate+ findings except those listed in
// audit-exceptions.json with a justification. An allowlisted advisory can
// never mask a new one: every finding is evaluated individually.
const THRESHOLD = new Set(["moderate", "high", "critical"]);

export function advisoryIds(vulnerability) {
	const ids = new Set();
	for (const via of vulnerability.via ?? []) {
		if (
			via !== null &&
			typeof via === "object" &&
			typeof via.url === "string"
		) {
			const match = /\/advisories\/(GHSA-[a-z0-9-]+)/i.exec(via.url);
			if (match) {
				ids.add(match[1].toUpperCase());
			}
		}
	}
	return ids;
}

export function evaluate(report, exceptions) {
	const allowed = new Set(
		Object.keys(exceptions).map((id) => id.toUpperCase()),
	);
	const failures = [];
	for (const [name, vulnerability] of Object.entries(
		report.vulnerabilities ?? {},
	)) {
		if (!THRESHOLD.has(vulnerability.severity)) {
			continue;
		}
		const ids = advisoryIds(vulnerability);
		// Entries without advisory objects are transitive consequences of the
		// advisories carried by their root entries, which are evaluated on
		// their own rows. Allowlisting a root accepts its whole chain.
		if (ids.size === 0) {
			continue;
		}
		const unlisted = [...ids].filter((id) => !allowed.has(id));
		if (unlisted.length > 0) {
			failures.push({
				name,
				severity: vulnerability.severity,
				range: vulnerability.range,
				advisories: [...ids],
				fixAvailable: vulnerability.fixAvailable,
			});
		}
	}
	return failures;
}

function loadReport() {
	try {
		return JSON.parse(
			execFileSync("npm", ["audit", "--json"], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}),
		);
	} catch (error) {
		// npm audit exits nonzero when findings meet its threshold, but the
		// JSON report is still on stdout.
		const output = error.stdout?.toString() ?? "";
		try {
			return JSON.parse(output);
		} catch {
			console.error("check-audit: npm audit produced no JSON output");
			process.exit(1);
		}
	}
}

function main() {
	const exceptions = JSON.parse(readFileSync("audit-exceptions.json", "utf8"));
	const failures = evaluate(loadReport(), exceptions);
	if (failures.length > 0) {
		for (const failure of failures) {
			console.error(
				`${failure.severity} ${failure.name} ${failure.range ?? ""} advisories: ${failure.advisories.join(", ") || "unknown"} fixAvailable: ${JSON.stringify(failure.fixAvailable)}`,
			);
		}
		console.error(
			"check-audit failed: unlisted moderate+ advisories; add entries with justification to audit-exceptions.json only after review",
		);
		process.exit(1);
	}
	console.log("check-audit ok (no unlisted moderate+ advisories)");
}

function isEntryPoint() {
	try {
		return (
			realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url)
		);
	} catch {
		return false;
	}
}

if (isEntryPoint()) {
	main();
}
