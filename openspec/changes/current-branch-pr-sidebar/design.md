# Design

## Context

See proposal.md Why for motivation. This is a greenfield plugin in an otherwise empty repo (`openspec/` only, no source yet). The specs in `specs/pr-sidebar/spec.md` define the behavior contract; this doc defines the approach.

Constraints: read-only display, GitHub only via the existing authenticated `gh` CLI, `git` on `PATH`, no extra credentials, no model calls, in-memory state only, must run inside the OpenCode v2 TUI plugin runtime (slots, theme, dialogs/toasts, keymap, command palette).

## Goals / Non-Goals

**Goals:**
- One correct card for the current branch: detection, lookup, counts-only display, open/copy/refresh, freshness + stale handling.
- Cheap polling: frequent local branch checks, throttled GitHub queries, manual refresh bypass, timeouts, cancellation on branch/directory switch.
- Graceful empty/error states that never show another branch's data.

**Non-Goals:**
- Session-history lists, owner filters, per-check names, voter lists, thread content, approve/merge/checkout actions, non-GitHub hosts, persistence, analytics.

## Decisions

### 1. Data source: `git` for branch, `gh` for PR
Use `git rev-parse --show-toplevel --abbrev-ref HEAD` for repo root + branch, then `gh pr view --json <fields>` for the PR payload, plus one minimal extra query for unresolved-thread and comment totals once the exact fields are confirmed by spike.
Rationale: reuses the user's existing `gh auth`, no token handling, works over SSH as long as tools run on the TUI machine.
Alternatives considered: direct GitHub REST/GraphQL with stored token (more auth surface, rejected); parsing `gh` human output (brittle, rejected).

### 2. Single-PR snapshot model
Keep one snapshot `{ pr, error, fetchedAt, now, loading, directory, branch }` keyed by `directory + repo root + branch`. Branch/directory change clears the card and aborts outstanding work via `AbortController` + version counter.
Rationale: matches current-branch-only scope; makes stale-branch races impossible by construction.
Alternatives considered: multi-PR store keyed by URL (needed for session history, rejected as out of scope).

### 3. Counts-only display, decision-string-only reviews
Checks: aggregate `passed / failed / pending (+ skipped)` from the rollup; reviews: head decision string only; comments: two integers (unresolved threads, total). Failed/pending-first per-check details, voter names, and thread lists are explicitly deferred.
Rationale: fits one compact card, keeps the query small, matches the confirmed P0 decisions; details can be added later without changing the card contract.
Alternatives considered: full check/run and review lists in P0 (more rows, pagination, layout cost, rejected).

### 4. Merge line from combined state
Ready requires clean merge state AND mergeable content AND no draft AND no outstanding required review; otherwise map to the specific blocked reason (draft, conflicts, rules, behind, checks, changes requested) or merged/closed terminal states.
Rationale: conflict-only inference mislabels `BLOCKED`/`BEHIND`/`UNSTABLE` as ready.
Alternatives considered: showing raw host strings only (accurate but cryptic, rejected as primary line; raw values can appear as secondary detail).

### 5. Polling and freshness
Branch/directory check on a short interval while the slot is mounted plus event hooks (session idle completion, branch change); GitHub at most ~60s normally and ~10s after session activity; manual refresh bypasses throttle; each subprocess times out (~15s). Publish `loading`, `fetchedAt`, and relative ages; on failure retain last data with a `STALE` marker.
Rationale: local checks are cheap, GitHub calls are not; users still get prompt updates after agent activity.
Alternatives considered: aggressive GitHub polling (rate-limit risk, rejected); refresh only on manual action (stale card, rejected).

### 6. Browser and clipboard handling
Title is a terminal hyperlink; Open uses the platform launcher (`open` on macOS, `xdg-open` on Linux) and falls back to showing the full URL on SSH/headless/unsupported platforms, missing launchers, launch errors, and timeouts. Copy uses the platform clipboard with an error toast on failure.
Rationale: a failed `open` must never look like success; the URL on screen is the reliable path.
Alternatives considered: launcher-only with silent failure (rejected); embedding full URLs always (wastes card width, rejected — full URL lives in fallback/toast).

### 7. Presentation: stable slot root, collapsible card
Render a stable root box in `sidebar_content` so async lookup never unmounts the slot; collapsible header; Refresh dimmed while loading; palette commands for Open/Copy/Details-equivalent/Refresh so keyboard users never need the mouse.
Rationale: empty-first render is a known slot-mount pitfall; palette parity keeps the card accessible.
Alternatives considered: hiding the slot until data arrives (risks the slot never mounting, rejected).

## Risks / Trade-offs

- [Risk] Exact `gh` fields for unresolved-thread and total-comment counts differ from assumption → Mitigation: spike first with `gh` against a real PR, lock field list before UI work; if a count is unavailable, show `unknown` rather than inventing it.
- [Risk] OpenCode v2 TUI API drift (slots, theme tokens, dialog, keymap) → Mitigation: spike against the v2 plugin API/docs before building UI; isolate runtime access behind a thin module.
- [Risk] Rate limits / auth expiry / offline → Mitigation: throttle, timeout, retain-last-with-STALE, short error kinds (auth required, rate limited, CLI unavailable).
- [Risk] Non-GitHub remotes, detached HEAD, branch/PR head mismatch → Mitigation: hide card or show explicit no-PR state; never display a mismatched PR.
- [Risk] SSH multiplexers stripping SSH env vars → Mitigation: treat headless-display detection as best-effort; fallback URL always available.
- Trade-off: counts-only P0 is less debuggable than per-check names → accepted; names are the natural next increment.

## Migration Plan

Greenfield: no migration. Ship as a local-directory plugin registered in `tui.json`; disabling the plugin or hiding the sidebar stops all polling. Rollback is removal of the plugin entry.

## Open Questions

None that change specs, approach, or tasks. The deferred increments (per-check names, voter lists, thread excerpts) are intentionally out of P0 and can be proposed as follow-up changes after P0 lands.
