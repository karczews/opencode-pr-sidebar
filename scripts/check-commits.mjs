import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Enforces AGENTS.md commit conventions without extra dependencies:
// type[(scope)][!]: subject, lowercase imperative subject, no trailing
// period, subject <= 72 chars. A trailing "!" marks a semver breaking
// change (release-please bumps minor pre-1.0, major after). True merge
// commits (2+ parents) are skipped; matching on the subject prefix alone
// would let any "Merge ..." message through.
const TYPES = ["feat", "fix", "docs", "chore", "refactor", "test"];
const HEADER = new RegExp(
	`^(${TYPES.join("|")})(\\([^()\\s]+\\))?!?: (\\S[\\s\\S]*)$`,
);

export function checkMessage(header, merge = false) {
	if (merge) {
		return null;
	}
	const match = HEADER.exec(header);
	if (!match) {
		return `must match "type[(scope)][!]: subject" with type one of ${TYPES.join("|")} (got ${JSON.stringify(header)})`;
	}
	const subject = match[3];
	if (subject.length > 72) {
		return `subject exceeds 72 chars (${subject.length})`;
	}
	if (!/^[a-z]/.test(subject)) {
		return "subject must start lowercase (imperative mood)";
	}
	if (subject.endsWith(".")) {
		return "subject must not end with a period";
	}
	return null;
}

function commitsIn(range) {
	try {
		const out = execFileSync("git", ["log", "--format=%H%x00%P%x00%s", range], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return out ? out.split("\n") : [];
	} catch {
		return null;
	}
}

function resolveRange(args) {
	if (args.length >= 2) {
		const [base, head] = args;
		// Empty (manual workflow run) or zero (fresh branch push) base: only
		// the head commit exists to check.
		if (!base || /^0+$/.test(base)) {
			return `${head}^!`;
		}
		return `${base}..${head}`;
	}
	if (args.length === 1) {
		return args[0];
	}
	return "origin/main..HEAD";
}

if (isEntryPoint()) {
	const range = resolveRange(process.argv.slice(2));
	const explicit = process.argv.length > 2;
	let effectiveRange = range;
	let lines = commitsIn(range);
	if (lines === null && !explicit) {
		// Unknown revision (e.g. no origin/main locally): fall back to the tip commit.
		effectiveRange = "HEAD^!";
		lines = commitsIn(effectiveRange);
	}
	if (lines === null) {
		console.error(
			explicit
				? `lint-commits: cannot read range ${range}; fetch the base ref first`
				: "lint-commits: no git history found",
		);
		process.exit(1);
	}
	if (lines.length === 0) {
		console.log("lint-commits: no commits in range, ok");
		process.exit(0);
	}

	let failed = false;
	for (const line of lines) {
		const [hash = "", parents = "", ...rest] = line.split("\x00");
		const header = rest.join("\x00");
		const error = checkMessage(header, parents.trim().includes(" "));
		if (error) {
			console.error(`${hash.slice(0, 8)} ${header}\n  ${error}`);
			failed = true;
		}
	}

	if (failed) {
		process.exit(1);
	}
	console.log(
		`lint-commits ok (${lines.length} commit(s) in ${effectiveRange})`,
	);
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
