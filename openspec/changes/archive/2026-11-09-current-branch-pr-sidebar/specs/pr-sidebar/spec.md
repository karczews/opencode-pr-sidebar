# Spec Delta

## Purpose

Gives anyone working on a GitHub-backed branch immediate, trustworthy visibility of that branch's pull request without leaving the OpenCode sidebar.

## ADDED Requirements

### Requirement: Show pull request for current branch
The system SHALL detect the working directory's current branch and display its pull request in a single sidebar card.

#### Scenario: Branch with a pull request
- **WHEN** the working directory is on a branch that has a pull request
- **THEN** the card shows that pull request's number, title, URL, head branch, and base branch.

#### Scenario: Branch switch updates card
- **WHEN** the user switches to a different branch
- **THEN** the card discards the previous pull request and looks up the new branch's pull request.

### Requirement: Clickable pull request link with open and copy actions
The system SHALL make the pull request title a terminal hyperlink and provide Open-in-browser and Copy-URL actions with a manual-URL fallback.

#### Scenario: Open pull request in browser
- **WHEN** the user activates the title link or the Open action and a local browser launcher exists
- **THEN** the system launches the pull request URL in the browser.

#### Scenario: Fallback when browser cannot launch
- **WHEN** the user activates Open over SSH, on a headless machine, on an unsupported platform, or when the launcher is missing or fails
- **THEN** the system shows the full pull request URL for manual opening instead of failing silently.

#### Scenario: Copy pull request URL
- **WHEN** the user activates the Copy action
- **THEN** the system copies the full pull request URL to the clipboard or reports that copying failed.

### Requirement: Display lifecycle and branches
The system SHALL display the pull request lifecycle as one of Open, Draft, Merged, or Closed, plus head and base branch names.

#### Scenario: Lifecycle values
- **WHEN** the pull request is a draft, merged, closed, or open and ready
- **THEN** the card shows Draft, Merged, Closed, or Open respectively.

### Requirement: Display review head decision
The system SHALL display only the pull request's head review decision string.

#### Scenario: Review decisions
- **WHEN** the head decision is approved, changes requested, review required, or absent
- **THEN** the card shows Approved, Changes requested, Review required, or No review decision.

### Requirement: Display checks aggregate counts
The system SHALL display check results as aggregate counts of passed, failed, and pending, plus skipped when present, with no per-check names in this change.

#### Scenario: Counts line
- **WHEN** checks have completed with mixed results
- **THEN** the card shows counts such as 3 passed, 1 failed, 2 pending.

#### Scenario: No checks reported
- **WHEN** the pull request reports zero checks
- **THEN** the card shows No checks reported and MUST NOT present that as passing.

### Requirement: Display merge readiness
The system SHALL display a single merge line derived from merge state, never from conflict detection alone.

#### Scenario: Ready to merge
- **WHEN** the host reports a clean merge state, mergeable content, no draft, and no outstanding required review
- **THEN** the card shows Ready to merge.

#### Scenario: Blocked reasons
- **WHEN** the pull request is a draft, has conflicts, is blocked by rules, is behind the base, has failing checks, or has changes requested
- **THEN** the card shows the matching blocked reason instead of Ready to merge.

#### Scenario: Merged or closed
- **WHEN** the pull request is merged or closed without merging
- **THEN** the card shows Merged or Closed without merging.

### Requirement: Display comment counts
The system SHALL display comment activity as counts only: unresolved review threads and total comments including general conversations.

#### Scenario: Comment counts
- **WHEN** the pull request has unresolved threads and total comments
- **THEN** the card shows both numbers, for example 4 unresolved and 12 total.

### Requirement: Display change size
The system SHALL display additions, deletions, and changed-file counts for the pull request.

#### Scenario: Diff stats
- **WHEN** the pull request changes files
- **THEN** the card shows added lines, removed lines, and file count.

### Requirement: Display freshness and stale state
The system SHALL display when the pull request was updated and when it was last checked, and SHALL mark retained data as stale after a failed refresh.

#### Scenario: Freshness ages
- **WHEN** data was fetched successfully
- **THEN** the card shows relative ages such as Updated 2h ago and Checked 1m ago.

#### Scenario: Failed refresh keeps stale data
- **WHEN** a refresh fails due to network, authentication, rate limit, or timeout
- **THEN** the card keeps the last successful data and shows an explicit stale warning with the failure kind.

### Requirement: Refresh pull request data
The system SHALL refresh automatically on a throttle, after branch or directory change, and on demand, with timeouts and cancellation of obsolete work.

#### Scenario: Manual refresh bypasses throttle
- **WHEN** the user activates Refresh
- **THEN** the system queries immediately even if the automatic throttle has not elapsed.

#### Scenario: Obsolete responses are discarded
- **WHEN** the branch or directory changes while a lookup is in flight
- **THEN** the system aborts or ignores that response and never shows it on the new branch.

### Requirement: Handle empty and error states
The system SHALL handle non-Git directories, detached HEAD, branches without a pull request, and lookup failures without showing wrong data.

#### Scenario: No pull request for branch
- **WHEN** the current branch has no pull request
- **THEN** the card is hidden or shows an explicit no-PR state and MUST NOT show another branch's pull request.

#### Scenario: Initial lookup failure
- **WHEN** the first lookup fails for a reason other than absence
- **THEN** the card shows a short error describing the kind, such as authentication required, rate limited, CLI unavailable, or refresh failed.
