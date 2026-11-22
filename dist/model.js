import { execFile } from "node:child_process";
// gh enum fields, with the fallbacks parsePRView normalizes unknowns to.
const REVIEW_DECISIONS = ["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED", ""];
const MERGE_STATE_STATUSES = [
    "BEHIND",
    "BLOCKED",
    "CLEAN",
    "DIRTY",
    "DRAFT",
    "HAS_HOOKS",
    "UNKNOWN",
    "UNSTABLE",
];
const MERGEABLE_STATES = ["MERGEABLE", "CONFLICTING", "UNKNOWN"];
export const PR_VIEW_FIELDS = [
    "url",
    "number",
    "title",
    "state",
    "isDraft",
    "additions",
    "deletions",
    "changedFiles",
    "headRefName",
    "baseRefName",
    "mergeable",
    "mergeStateStatus",
    "reviewDecision",
    "statusCheckRollup",
    "updatedAt",
].join(",");
// --- subprocess execution ---
const REPO_ENV_KEYS = [
    "GH_REPO",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
];
export function run(file, args, { cwd, signal, input, timeoutMs = 15_000 }) {
    return new Promise((resolve, reject) => {
        const env = {
            ...process.env,
            GH_PROMPT_DISABLED: "1",
            GIT_TERMINAL_PROMPT: "0",
            NO_COLOR: "1",
        };
        // A launching shell's overrides must not select another worktree or repository.
        for (const key of REPO_ENV_KEYS) {
            delete env[key];
        }
        const child = execFile(file, args, { cwd, env, signal, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                reject(Object.assign(error, { stderr }));
            }
            else {
                resolve(stdout);
            }
        });
        child.stdin?.on("error", () => { });
        child.stdin?.end(input);
    });
}
export async function detectRepo(directory, signal, execute = run) {
    try {
        const out = await execute("git", ["rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"], {
            cwd: directory,
            signal,
        });
        const [root, branch] = out.trim().split("\n");
        if (!root || !branch) {
            return null;
        }
        return { root, branch };
    }
    catch {
        return null;
    }
}
export async function fetchPRView(directory, signal, execute = run) {
    return execute("gh", ["pr", "view", "--json", PR_VIEW_FIELDS], { cwd: directory, signal });
}
export function countsQuery(ref) {
    if (!Number.isInteger(ref.number) || ref.number < 1) {
        throw new Error("Invalid PR number");
    }
    return `query { repository(owner: ${JSON.stringify(ref.owner)}, name: ${JSON.stringify(ref.repo)}) { pullRequest(number: ${ref.number}) { comments(first: 1) { totalCount } reviews(first: 1) { totalCount } reviewThreads(first: 100) { totalCount nodes { isResolved } } } } }`;
}
export async function fetchCounts(ref, directory, signal, execute = run) {
    return execute("gh", ["api", "graphql", "-f", `query=${countsQuery(ref)}`], {
        cwd: directory,
        signal,
    });
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function asRecord(value, label) {
    if (!isRecord(value)) {
        throw new Error(label);
    }
    return value;
}
function asString(data, key) {
    const value = data[key];
    if (typeof value !== "string") {
        throw new Error(`Invalid PR response: ${key}`);
    }
    return value;
}
function optionalString(value) {
    return typeof value === "string" ? value : undefined;
}
function oneOf(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
}
export function clean(value) {
    return (String(value ?? "")
        // biome-ignore lint/suspicious/noControlCharactersInRegex: strip terminal controls and bidi overrides from host-provided text.
        .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ")
        .replace(/\s+/g, " ")
        .trim());
}
export function splitPRUrl(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
        throw new Error("Invalid PR URL");
    }
    const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)$/.exec(parsed.pathname);
    if (!match) {
        throw new Error("Invalid PR URL");
    }
    const [, owner, repo, num] = match;
    if (!owner || !repo || !num) {
        throw new Error("Invalid PR URL");
    }
    return { owner, repo, number: Number(num) };
}
function asNonNegativeInt(value, label) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new Error(`Invalid PR response: ${label}`);
    }
    return value;
}
export function parsePRView(text) {
    let data;
    try {
        data = JSON.parse(text);
    }
    catch {
        throw new Error("Invalid PR response: not JSON");
    }
    if (!isRecord(data)) {
        throw new Error("Invalid PR response");
    }
    if (!Number.isInteger(data.number) || data.number < 1) {
        throw new Error("Invalid PR response: number");
    }
    if (data.state !== "OPEN" && data.state !== "CLOSED" && data.state !== "MERGED") {
        throw new Error("Invalid PR response: state");
    }
    const url = asString(data, "url");
    const parts = splitPRUrl(url);
    if (parts.number !== data.number) {
        throw new Error("Invalid PR response: url number mismatch");
    }
    if (typeof data.isDraft !== "boolean") {
        throw new Error("Invalid PR response: isDraft");
    }
    if (!Array.isArray(data.statusCheckRollup)) {
        throw new Error("Invalid PR response: statusCheckRollup");
    }
    const rollup = [];
    for (const entry of data.statusCheckRollup) {
        if (isRecord(entry)) {
            rollup.push({
                __typename: optionalString(entry.__typename),
                name: optionalString(entry.name),
                context: optionalString(entry.context),
                state: optionalString(entry.state),
                status: optionalString(entry.status),
                conclusion: optionalString(entry.conclusion),
            });
        }
    }
    return {
        number: data.number,
        url,
        title: asString(data, "title"),
        state: data.state,
        isDraft: data.isDraft,
        headRefName: asString(data, "headRefName"),
        baseRefName: asString(data, "baseRefName"),
        additions: asNonNegativeInt(data.additions, "additions"),
        deletions: asNonNegativeInt(data.deletions, "deletions"),
        changedFiles: asNonNegativeInt(data.changedFiles, "changedFiles"),
        updatedAt: asString(data, "updatedAt"),
        mergeStateStatus: oneOf(data.mergeStateStatus, MERGE_STATE_STATUSES, "UNKNOWN"),
        mergeable: oneOf(data.mergeable, MERGEABLE_STATES, "UNKNOWN"),
        reviewDecision: oneOf(data.reviewDecision, REVIEW_DECISIONS, ""),
        statusCheckRollup: rollup,
    };
}
export function parseCounts(text) {
    let data;
    try {
        data = JSON.parse(text);
    }
    catch {
        throw new Error("Invalid counts response: not JSON");
    }
    const root = asRecord(data, "Invalid counts response");
    const payload = asRecord(root.data, "Invalid counts response: data");
    const repository = asRecord(payload.repository, "Invalid counts response: repository");
    const pr = asRecord(repository.pullRequest, "Invalid counts response: pullRequest");
    const totalOf = (key) => {
        const section = asRecord(pr[key], `Invalid counts response: ${key}`);
        return asNonNegativeInt(section.totalCount, key);
    };
    const comments = totalOf("comments");
    const reviews = totalOf("reviews");
    const threadsSection = asRecord(pr.reviewThreads, "Invalid counts response: reviewThreads");
    const threads = asNonNegativeInt(threadsSection.totalCount, "reviewThreads");
    if (!Array.isArray(threadsSection.nodes)) {
        throw new Error("Invalid counts response: reviewThreads nodes");
    }
    // Lower bound over the first page when totalCount exceeds the fetched nodes.
    let unresolved = 0;
    for (const node of threadsSection.nodes) {
        if (isRecord(node) && node.isResolved === false) {
            unresolved++;
        }
    }
    return {
        unresolvedThreads: unresolved,
        totalComments: comments + reviews + threads,
    };
}
export function errorKind(error) {
    const detail = error && typeof error === "object"
        ? error
        : {};
    const text = String(detail.stderr ?? detail.message ?? "");
    if (/no pull requests? found|no GitHub remotes|none of the git remotes.*GitHub/i.test(text)) {
        return "absent";
    }
    if (detail.code === "ENOENT") {
        return "cli-missing";
    }
    if (/auth login|authentication|HTTP 401|Bad credentials|not logged/i.test(text)) {
        return "auth";
    }
    if (/rate limit/i.test(text)) {
        return "rate-limit";
    }
    return "refresh-failed";
}
const FAILED_CONCLUSIONS = new Set([
    "FAILURE",
    "CANCELLED",
    "TIMED_OUT",
    "ACTION_REQUIRED",
    "STARTUP_FAILURE",
    "STALE",
]);
function classifyStatusContext(check) {
    if (check.state === "SUCCESS") {
        return "passed";
    }
    if (check.state === "FAILURE" || check.state === "ERROR") {
        return "failed";
    }
    if (check.state === "SKIPPED") {
        return "skipped";
    }
    return "pending";
}
function classifyCheckRun(check) {
    if (check.status !== "COMPLETED") {
        return "pending";
    }
    if (check.conclusion === "SUCCESS") {
        return "passed";
    }
    if (check.conclusion === "SKIPPED" || check.conclusion === "NEUTRAL") {
        return "skipped";
    }
    if (check.conclusion != null && FAILED_CONCLUSIONS.has(check.conclusion)) {
        return "failed";
    }
    // Unknown or missing conclusion: never invent a pass or a failure.
    return "pending";
}
function classifyCheck(check) {
    return check.__typename === "StatusContext"
        ? classifyStatusContext(check)
        : classifyCheckRun(check);
}
export function summarizeChecks(rollup) {
    const counts = { passed: 0, failed: 0, pending: 0, skipped: 0 };
    for (const check of rollup) {
        counts[classifyCheck(check)]++;
    }
    return counts;
}
export const summarizeReview = {
    APPROVED: "Approved",
    CHANGES_REQUESTED: "Changes requested",
    REVIEW_REQUIRED: "Review required",
    "": "No review decision",
};
export function lifecycleOf(pr) {
    if (pr.state === "MERGED") {
        return "Merged";
    }
    if (pr.state === "CLOSED") {
        return "Closed";
    }
    return pr.isDraft ? "Draft" : "Open";
}
const MERGE_LINES = [
    "Merged",
    "Closed without merging",
    "Blocked: draft",
    "Blocked: merge conflicts",
    "Changes requested",
    "Blocked by repository rules",
    "Behind base branch",
    "Checks not passing",
    "Merge hooks must pass",
    "Awaiting required review",
    "Ready to merge",
    "Merge status unknown",
];
export function mergeLineOf(pr) {
    // Order matters: the first matching blocker wins.
    if (pr.state === "MERGED") {
        return "Merged";
    }
    if (pr.state === "CLOSED") {
        return "Closed without merging";
    }
    if (pr.isDraft || pr.mergeStateStatus === "DRAFT") {
        return "Blocked: draft";
    }
    if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY") {
        return "Blocked: merge conflicts";
    }
    if (pr.reviewDecision === "CHANGES_REQUESTED") {
        return "Changes requested";
    }
    if (pr.mergeStateStatus === "BLOCKED") {
        return "Blocked by repository rules";
    }
    if (pr.mergeStateStatus === "BEHIND") {
        return "Behind base branch";
    }
    if (pr.mergeStateStatus === "UNSTABLE") {
        return "Checks not passing";
    }
    if (pr.mergeStateStatus === "HAS_HOOKS") {
        return "Merge hooks must pass";
    }
    if (pr.reviewDecision === "REVIEW_REQUIRED") {
        return "Awaiting required review";
    }
    if (pr.mergeStateStatus === "CLEAN" && pr.mergeable === "MERGEABLE") {
        return "Ready to merge";
    }
    return "Merge status unknown";
}
// The record must cover every MergeLine, so adding a merge line forces a choice of tone.
export const MERGE_TONE = {
    Merged: "success",
    "Closed without merging": "muted",
    "Blocked: draft": "warning",
    "Blocked: merge conflicts": "warning",
    "Changes requested": "warning",
    "Blocked by repository rules": "warning",
    "Behind base branch": "warning",
    "Checks not passing": "warning",
    "Merge hooks must pass": "warning",
    "Awaiting required review": "warning",
    "Ready to merge": "success",
    "Merge status unknown": "muted",
};
export function ageOf(time, now = Date.now()) {
    const timestamp = new Date(time ?? Number.NaN).getTime();
    const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
    if (!Number.isFinite(seconds)) {
        return "unknown";
    }
    if (seconds < 60) {
        return "just now";
    }
    if (seconds < 3600) {
        return `${Math.floor(seconds / 60)}m ago`;
    }
    if (seconds < 86_400) {
        return `${Math.floor(seconds / 3600)}h ago`;
    }
    return `${Math.floor(seconds / 86_400)}d ago`;
}
export function summarize(pr) {
    return {
        lifecycle: lifecycleOf(pr),
        review: summarizeReview[pr.reviewDecision],
        checks: summarizeChecks(pr.statusCheckRollup),
        merge: mergeLineOf(pr),
    };
}
const GITHUB_THROTTLE_MS = 60_000;
const GITHUB_ACTIVITY_THROTTLE_MS = 10_000;
export const displayError = {
    absent: "PR refresh failed",
    "cli-missing": "GitHub CLI unavailable",
    auth: "GitHub authentication required",
    "rate-limit": "GitHub rate limit reached",
    "refresh-failed": "PR refresh failed",
};
export function createMonitor({ directory, publish, execute = run, now = Date.now, }) {
    let current = {
        pr: null,
        error: "",
        fetchedAt: 0,
        now: now(),
        loading: false,
    };
    let key = "";
    let version = 0;
    let stopped = false;
    let lastFetchAt = 0;
    let request;
    let detection;
    // Serialize cycles so overlapping ticks cannot interleave fetches.
    let tail = Promise.resolve();
    const emit = (patch) => {
        current = { ...current, ...patch, now: now() };
        publish(current);
    };
    const reset = (next) => {
        key = next;
        version++;
        request?.abort();
        request = undefined;
        detection?.abort();
        detection = undefined;
        lastFetchAt = 0;
        emit({ pr: null, error: "", fetchedAt: 0, loading: false });
    };
    const isStale = (expected, cwd, signal) => stopped || expected !== version || directory() !== cwd || signal.aborted;
    async function cycle(force, activity) {
        if (stopped) {
            return;
        }
        const cwd = directory();
        if (!cwd) {
            if (key) {
                reset("");
            }
            return;
        }
        if (current.directory !== cwd) {
            reset("");
            emit({ directory: cwd });
        }
        const detectController = new AbortController();
        detection = detectController;
        let repo;
        try {
            repo = await detectRepo(cwd, detectController.signal, execute);
        }
        catch {
            repo = null;
        }
        finally {
            if (detection === detectController) {
                detection = undefined;
            }
        }
        if (stopped || directory() !== cwd) {
            return;
        }
        if (!repo) {
            if (key) {
                reset("");
            }
            return;
        }
        const next = JSON.stringify([cwd, repo.root, repo.branch]);
        if (next !== key) {
            reset(next);
        }
        if (current.branch !== repo.branch) {
            emit({ branch: repo.branch });
        }
        if (repo.branch === "HEAD") {
            return;
        }
        if (request) {
            if (!force) {
                return;
            }
            request.abort();
            request = undefined;
        }
        else if (!force &&
            lastFetchAt > 0 &&
            now() - lastFetchAt < (activity ? GITHUB_ACTIVITY_THROTTLE_MS : GITHUB_THROTTLE_MS)) {
            return;
        }
        const expected = version;
        const abort = new AbortController();
        request = abort;
        lastFetchAt = now();
        emit({ loading: true });
        try {
            const viewText = await fetchPRView(cwd, abort.signal, execute);
            if (isStale(expected, cwd, abort.signal)) {
                return;
            }
            const parsed = parsePRView(viewText);
            if (parsed.headRefName !== repo.branch) {
                emit({ pr: null, error: "", fetchedAt: now() });
                return;
            }
            const countsText = await fetchCounts(splitPRUrl(parsed.url), cwd, abort.signal, execute);
            if (isStale(expected, cwd, abort.signal)) {
                return;
            }
            const counts = parseCounts(countsText);
            emit({ pr: { ...parsed, ...counts }, error: "", fetchedAt: now() });
        }
        catch (error) {
            if (isStale(expected, cwd, abort.signal)) {
                return;
            }
            const kind = errorKind(error);
            if (kind === "absent") {
                emit({ pr: null, error: "", fetchedAt: now() });
            }
            else {
                emit({ error: displayError[kind] });
            }
        }
        finally {
            if (request === abort) {
                request = undefined;
            }
            if (expected === version && !stopped) {
                emit({ loading: false });
            }
        }
    }
    return {
        tick(force = false, activity = false) {
            if (stopped) {
                return;
            }
            tail = tail.then(() => cycle(force, activity)).catch(() => { });
        },
        stop() {
            stopped = true;
            version++;
            request?.abort();
            request = undefined;
            detection?.abort();
            detection = undefined;
        },
    };
}
const LAUNCHERS = {
    darwin: "open",
    linux: "xdg-open",
};
export async function openBrowser(url, cwd, signal, { env = process.env, platform = process.platform, execute = run } = {}) {
    if (signal.aborted) {
        return;
    }
    if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) {
        return "SSH session detected. Open the URL below in your local browser.";
    }
    if (platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
        return "No graphical display detected. Open the URL below in your browser.";
    }
    const launcher = LAUNCHERS[platform];
    if (!launcher) {
        return "Browser opening is unavailable here. Open the URL below in your browser.";
    }
    try {
        await execute(launcher, [url], { cwd, signal });
    }
    catch {
        if (!signal.aborted) {
            return "Could not launch a browser. Open the URL below in your browser.";
        }
    }
    return undefined;
}
function clipboardCommand(platform, env) {
    if (platform === "darwin") {
        return { file: "pbcopy", args: [] };
    }
    if (platform === "win32") {
        return { file: "clip", args: [] };
    }
    if (env.WAYLAND_DISPLAY) {
        return { file: "wl-copy", args: [] };
    }
    return { file: "xclip", args: ["-selection", "clipboard"] };
}
export async function copyToClipboard(text, cwd, signal, { env = process.env, platform = process.platform, execute = run } = {}) {
    if (signal.aborted) {
        return false;
    }
    const command = clipboardCommand(platform, env);
    try {
        await execute(command.file, command.args, { cwd, signal, input: text });
        return !signal.aborted;
    }
    catch {
        return false;
    }
}
