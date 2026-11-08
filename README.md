# pr-sidebar

Current-branch GitHub pull request card for the OpenCode TUI sidebar.

The card shows one pull request: the one belonging to the working directory's
current branch. It is read-only and uses the authenticated GitHub CLI, so it
needs no extra credentials and makes no model calls.

## Requirements

- OpenCode v2 with TUI plugin support (verified on 2.2.6; uses the V2
  `Plugin.define({ setup })` TUI API from `@opencode/plugin/tui`).
- `git` and an authenticated `gh` (`gh auth login`) on the TUI process's `PATH`.

## Install

Register the plugin directory in the global CLI config
(`~/.config/opencode/cli.json`), adding it alongside any existing entries:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/absolute/path/to/opencode-pr-sidebar"]
}
```

The entry is a directory, not a file: OpenCode v2 resolves the directory's
`tui` entrypoint (`tui.tsx`). Restart OpenCode and open a repository checkout
on a branch that has a pull request. The Plugins dialog shows `pr-sidebar`
once it loads.

## Card

```
+-------------------------------------------+
| v Pull Request                            |
| #42 Fix login  (hyperlink, click to open) |
| feature -> main                           |
| Open                                      |
| Review: Approved                          |
| Ready to merge                            |
| Checks: 3 passed / 1 failed / 2 pending   |
| +120 / -30 / 8 files                      |
| 4 unresolved / 12 total comments          |
| Updated 2h ago                            |
| Checked 1m ago                            |
| [ Refresh ] [ Copy URL ] [ Open ]         |
+-------------------------------------------+
```

The header starts expanded. Click it to collapse or expand; polling keeps
running while collapsed. Colors come from the host theme: lifecycle and merge
state use success/error/warning/muted tokens, the title uses the link token,
and buttons highlight on hover.

### What it shows

All values come from the current branch's pull request.

| Field | Values |
| --- | --- |
| Title | `#number` plus the PR title; a terminal hyperlink to the PR URL, also clickable to open it. |
| Branches | `head -> base`. |
| Lifecycle | `Open`, `Draft`, `Merged`, `Closed`. |
| Review | Head decision only: `Approved`, `Changes requested`, `Review required`, `No review decision`. |
| Merge | `Ready to merge`, `Blocked: draft`, `Blocked: merge conflicts`, `Changes requested`, `Blocked by repository rules`, `Behind base branch`, `Checks not passing`, `Merge hooks must pass`, `Awaiting required review`, `Merged`, `Closed without merging`, or `Merge status unknown`. Ready requires clean state, mergeable content, no draft, and no outstanding required review. |
| Checks | Aggregate counts: passed, failed, pending, plus skipped when any. `No checks reported` means exactly that, not passing. Failed checks color the line with the warning token. |
| Changes | Added lines, removed lines, changed files. |
| Comments | Unresolved review threads and total comments (issue comments, reviews, threads). |
| Freshness | When the PR was last updated and when the last successful check ran; shows `Refreshing...` while a refresh is in flight. |
| Errors | `STALE: <reason>` when a refresh fails after success, or a short error on the first failure. |

### Actions

- **Click the title** or the `Open` button (or `PR: Open on GitHub` in the
  command palette) to open the PR in the browser. Over SSH, on headless Linux,
  on unsupported platforms, or when the launcher is missing or fails, a toast
  shows the full PR URL instead of failing silently.
- **Copy URL** (or `PR: Copy URL`) copies the full PR URL with the platform
  clipboard tool (`pbcopy`, `clip`, `wl-copy`, `xclip`); a toast reports success
  or failure.
- **Refresh** (or `PR: Refresh status`) refreshes immediately, bypassing the
  throttle; the button is dimmed and labeled `Refreshing` while loading.
- Palette commands are available with `ctrl+p`; Open and Copy are enabled only
  when a PR is present.
- Click the header row to collapse or expand the card.

### Data and polling

- Branch and repo root come from `git rev-parse --show-toplevel --abbrev-ref HEAD`.
- PR data comes from `gh pr view --json` with a locked field list; comment
  counts come from a `gh api graphql` query (`comments`, `reviews`,
  `reviewThreads` with `isResolved`). Responses are strictly validated and PR
  titles, branches, and URLs are sanitized before display.
- Branch and directory are checked every five seconds. GitHub is queried at
  most once per minute, or after ten seconds when a session execution succeeds;
  a manual Refresh bypasses both. A branch-change event triggers an immediate
  re-check.
- Each `git`/`gh` call times out after fifteen seconds. Subprocesses run with
  repository-selecting environment variables (`GH_REPO`, `GIT_DIR`,
  `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_INDEX_FILE`) removed so a parent shell
  cannot redirect the lookup.
- Snapshots are keyed by directory, repo root, and branch. Switching branches
  or directories clears the old card and aborts in-flight work; stale responses
  are discarded. Network/auth/rate-limit failures keep the last good data with
  a `STALE` marker.
- Hiding the sidebar or disabling the plugin stops all polling and disposes the
  plugin's event subscriptions, abort signal, and monitor.

## States

| Situation | What the sidebar shows |
| --- | --- |
| Branch has a PR | The card above. |
| No PR for the branch | Nothing. |
| Not a Git repository, detached HEAD, or PR head does not match the branch | Nothing; no GitHub query for the mismatch case. |
| First lookup fails | A short error: `GitHub CLI unavailable`, `GitHub authentication required`, `GitHub rate limit reached`, or `PR refresh failed`. |
| Refresh fails after success | The last good data, prefixed `STALE:`, with the failure kind. |

## Development

```sh
npm install
npm run check
```

`npm run check` runs formatting, lint, strict type checks, model unit tests, a
registration test, and a headless render test that drives the real
Solid/OpenTUI runtime with temporary Git repositories and a stubbed `gh`.

| Command | Purpose |
| --- | --- |
| `npm run fmt` / `fmt-check` | Format or verify formatting. |
| `npm run lint` | Biome lint. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm test` | Model unit tests. |
| `npm run test:register` | Asserts the V2 setup registers the slot, palette commands, and events. |
| `npm run test:render` | Headless card render and state matrix. |

The render test uses `--conditions=browser` because Node otherwise resolves
`solid-js` to its server build, where `onMount` never runs; the TUI uses the
browser build.
