# Tasks

## 1. Spikes and scaffolding

- [x] 1.1 Confirm OpenCode v2 TUI plugin API surface (slots, theme, dialog/toast, keymap, palette, events) against local docs/source and record the supported entrypoint shape, verified by a short note in the change directory listing what was checked.
- [x] 1.2 Confirm `gh` fields for PR payload plus unresolved-thread and total-comment counts against a real PR and lock the field list, verified by pasting the working `gh` commands and redacted output into the change scratch note.
- [x] 1.3 Scaffold plugin skeleton (entrypoint, data module, tests, tsconfig, package scripts, formatter/linter config) and verify `install`, `format check`, `lint`, `typecheck`, and `test` all pass on the empty baseline.

## 2. Data layer

- [x] 2.1 Implement branch/repo detection (`git rev-parse`), PR fetch via `gh`, strict response parsing/validation, and URL sanitizing, verified by unit tests covering invalid payloads, bad URLs, and control-character cleaning.
- [x] 2.2 Implement summarizers for lifecycle, review head-decision string, checks aggregate counts, merge readiness line, diff stats, comment counts, and relative ages, verified by unit tests for each mapping including blocked reasons and no-checks handling.
- [x] 2.3 Implement snapshot monitor with branch/directory keying, throttled GitHub refresh plus manual bypass, 15s timeouts, abort and version guards, stale retention with error kinds, verified by unit tests for throttle, stale-on-error, absent-PR clearing, and in-flight cancellation.

## 3. Sidebar card

- [x] 3.1 Render stable slot root with collapsible header and current-branch card fields (number/title link, head to base, lifecycle, review, checks counts, merge line, diff stats, comment counts, updated/checked ages, stale/error), verified by TUI smoke check on a PR branch showing every field.
- [x] 3.2 Implement empty and error states (no PR, non-Git dir, detached HEAD, head mismatch, auth/rate-limit/CLI-unavailable/refresh-failed) that never leak another branch's data, verified by TUI smoke checks in each state.
- [x] 3.3 Document card fields and states in README with a screenshot or ASCII layout, verified by following the README against a live sidebar.

## 4. Actions and polling wiring

- [x] 4.1 Implement Open-in-browser with platform launcher plus SSH/headless/failure fallback to full URL, Copy-URL with failure toast, and Refresh bypass, verified by unit tests for fallback matrix plus manual open/copy checks.
- [x] 4.2 Wire palette commands (Open, Copy, Details-equivalent, Refresh), session-idle and branch-change refresh hooks, polling timers, and dispose cleanup that stops all work, verified by unit tests for disposal plus manual palette and hide/show sidebar checks.

## 5. Integration and release readiness

- [x] 5.1 Run full verification (`install`, `format check`, `lint`, `typecheck`, `test`) and fix all findings, verified by clean command output.
- [x] 5.2 Perform end-to-end TUI pass (PR branch, no-PR branch, non-Git dir, resize, collapse/expand, refresh, offline/auth-failure stale) and record results, verified by a completed checklist in the change.
