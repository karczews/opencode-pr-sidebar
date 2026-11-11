import { execFileSync } from "node:child_process";

// Enforces AGENTS.md commit conventions without extra dependencies:
// type(scope): subject, lowercase imperative subject, no trailing period,
// subject <= 72 chars. Merge commits are skipped.
const TYPES = ["feat", "fix", "docs", "chore", "refactor", "test"];
const HEADER =
	/^(feat|fix|docs|chore|refactor|test)(\([^()\s]+\))?: (\S[\s\S]*)$/;

export function checkMessage(header) {
	if (/^Merge /.test(header)) {
		return null;
	}
	const match = HEADER.exec(header);
	if (!match) {
		return `must match "type[(scope)]: subject" with type one of ${TYPES.join("|")} (got ${JSON.stringify(header)})`;
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
		const out = execFileSync("git", ["log", "--format=%H%x00%s", range], {
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
		// Fresh branches push a zero base; only the head commit exists to check.
		if (/^0+$/.test(base)) {
			return head;
		}
		return `${base}..${head}`;
	}
	if (args.length === 1) {
		return args[0];
	}
	return "origin/main...HEAD";
}

const range = resolveRange(process.argv.slice(2));
let lines = commitsIn(range);
if (lines === null) {
	// Unknown revision (e.g. no origin/main locally): fall back to HEAD.
	lines = commitsIn("HEAD");
}
if (lines === null || lines.length === 0) {
	console.log(
		lines === null
			? "lint-commits: no git history found, ok"
			: "lint-commits: no commits in range, ok",
	);
	process.exit(0);
}

let failed = false;
for (const line of lines) {
	const separator = line.indexOf("\x00");
	const hash = separator === -1 ? line : line.slice(0, separator);
	const header = separator === -1 ? "" : line.slice(separator + 1);
	const error = checkMessage(header);
	if (error) {
		console.error(`${hash.slice(0, 8)} ${header}\n  ${error}`);
		failed = true;
	}
}

if (failed) {
	process.exit(1);
}
console.log(`lint-commits ok (${lines.length} commit(s) in ${range})`);
