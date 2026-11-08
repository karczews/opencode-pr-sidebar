# Proposal

## Why

When working on a branch that already has an open pull request, the fastest question is "what is the state of my PR right now, and how do I open it". Switching to a browser or running `gh` commands breaks flow. A small current-branch card in the OpenCode sidebar keeps the PR link, status, jobs, approvals, and comment counts one glance away.

## What Changes

- Detect the working directory's current branch and look up its pull request via the authenticated GitHub CLI. No extra credentials or model calls.
- Render a single current-branch PR card above Context in the sidebar:
  - Clickable PR title/number linking to the PR URL, plus Open-in-browser and Copy-URL actions with a manual-URL fallback for SSH/headless/failed launchers.
  - Lifecycle (`Open / Draft / Merged / Closed`), head-to-base branches, diff stats (`+additions / -deletions / files`).
  - Review head decision string only (`Approved / Changes requested / Review required / No decision`).
  - Checks aggregate counts only (`N passed / M failed / K pending`, plus skipped when present).
  - Merge line (`Ready to merge / Blocked: <reason> / Merged / Closed without merging`).
  - Comment counts only (`N unresolved review threads / M total comments`, covering review threads plus general conversations).
  - Freshness (`Updated X ago / Checked Y ago`) with an explicit stale warning when the last refresh failed.
- Refresh behavior: poll locally cheap, throttle GitHub queries, support manual Refresh from sidebar and command palette, abort in-flight work on branch/directory change, time out subprocesses.
- Empty/error states: no PR for branch, non-Git directory, detached HEAD, lookup failure, auth/rate-limit/network errors.

Explicitly out of scope for this change: session-history multi-PR lists, owner filters, per-check names, voter lists, thread/content lists, approve/merge/checkout actions, non-GitHub hosts.

## Capabilities

### New Capabilities

- `pr-sidebar`: current-branch pull request card in the OpenCode TUI sidebar (detection, display fields, open/copy/refresh actions, polling, empty and error states).

### Modified Capabilities

- None. The project has no existing specs.

## Impact

- New TUI plugin entrypoint (TSX) loaded from local config; no build step for users.
- Runtime dependencies: OpenCode v2 TUI plugin API (`slots`, `theme`, `dialog`/`toast`, `keymap`, command palette), `git` and authenticated `gh` on `PATH`.
- No new services, no persistence beyond in-memory snapshot, no model usage.
- Main risk is OpenCode v2 API drift versus earlier plugin APIs and the exact `gh` GraphQL/JSON fields for unresolved-thread and comment totals; both are verified by spike tasks before UI work.
