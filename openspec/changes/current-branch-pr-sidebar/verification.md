# Verification — end-to-end

Recorded 2026-11-08 on `opencode v2.2.6`, macOS, node `v26.13.0`.

## Automated (`npm run check`)

- Format, lint, and strict typecheck: clean.
- `npm test`: 30 model tests pass (detection, parsing, summaries, monitor
  throttle/stale/abort/dispose, browser fallback matrix, clipboard).
- `npm run test:register`: setup claims `sidebar.content`, registers the three
  palette commands in one global keymap layer, subscribes to
  `session.execution.succeeded` and `vcs.branch.updated`, and cleans up.
- `npm run test:render`: 11 headless Solid/OpenTUI tests pass:
  - full card field matrix on a PR branch;
  - hidden states for no PR, non-Git directory, detached HEAD, head mismatch
    (with no GitHub query for non-repo / detached / mismatch counts);
  - auth, rate-limit, and CLI-unavailable errors;
  - stale retention after a failed manual Refresh;
  - Open/Copy fallback toasts when launchers fail;
  - header collapse/expand and resize.

## Live host

Throwaway Git repo (`feature` branch) with a stubbed `gh` returning a canned
`OPEN`, `APPROVED`, `CLEAN`/`MERGEABLE` PR:

- Card rendered `Pull Request`, `#42 Example smoke PR`, `feature -> main`,
  `Open`, `Review: Approved`, `Ready to merge`, `Checks: 1 passed / 1 failed /
  0 pending`, `+20 / -3 / 2 files`, `1 unresolved / 4 total comments`,
  `Updated`/`Checked`, and the action buttons.
- `gh` calls used exactly the locked field list plus the counts GraphQL query.
- Command palette (`ctrl+p`) listed `PR: Open on GitHub`, `PR: Copy URL`, and
  `PR: Refresh status`.
- Leader+b hid the sidebar (card absent) and showed it again (card present).

## Notes

- The first implementation targeted the V1 `tui(api)` entry and silently did
  nothing on this host. `spikes/api-surface.md` records the correction and the
  V2 `setup(context)` surface used now.
- Global `cli.json` was temporarily pointed at the plugin for live checks and
  restored afterwards; the README documents the permanent registration.
