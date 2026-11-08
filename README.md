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

Palette commands (`ctrl+p`): `PR: Open on GitHub`, `PR: Copy URL`, and
`PR: Refresh status`.

## Card layout

```
+----------------------------------+
| v Pull Request                   |
| #42 Fix login        (link)      |
| feature -> main                  |
| Open                             |
| Review: Approved                 |
| Ready to merge                   |
| Checks: 3 passed / 1 failed / 0  |
| +120 / -30 / 8 files             |
| 4 unresolved / 12 total comments |
| Updated 2h ago                   |
| Checked 1m ago                   |
| [ Refresh ]                      |
+----------------------------------+
```

Fields, all from the current branch's pull request:

| Field | Values |
| --- | --- |
| Title | `#number` plus the PR title; the title is a terminal hyperlink to the PR URL. |
| Branches | `head -> base`. |
| Lifecycle | `Open`, `Draft`, `Merged`, `Closed`. |
| Review | Head decision only: `Approved`, `Changes requested`, `Review required`, `No review decision`. |
| Merge | `Ready to merge`, a blocked reason, `Merged`, `Closed without merging`, or `Merge status unknown`. |
| Checks | Aggregate counts: passed, failed, pending, plus skipped when any. `No checks reported` means exactly that, not passing. |
| Changes | Added lines, removed lines, changed files. |
| Comments | Unresolved review threads and total comments (issue comments, reviews, threads). |
| Freshness | When the PR was last updated and when the last successful check ran. |
| Refresh | Manual refresh; dimmed while a refresh is in flight. |

Click the header row to collapse or expand the card.

## States

| Situation | What the sidebar shows |
| --- | --- |
| Branch has a PR | The card above. |
| No PR for the branch | Nothing. |
| Not a Git repository, detached HEAD, or PR head does not match the branch | Nothing; no GitHub query for the mismatch case. |
| First lookup fails | A short error: `GitHub CLI unavailable`, `GitHub authentication required`, `GitHub rate limit reached`, or `PR refresh failed`. |
| Refresh fails after success | The last good data, prefixed `STALE:`, with the failure kind. |

## Refresh behavior

Branch and directory are checked every five seconds. GitHub is queried at most
once per minute, and Refresh bypasses that throttle. Obsolete responses are
discarded when the branch or directory changes, and every `git`/`gh` call times
out after fifteen seconds.

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
