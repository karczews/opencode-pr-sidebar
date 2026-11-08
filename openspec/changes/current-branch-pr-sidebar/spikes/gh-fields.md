# Spike 1.2 — `gh` fields for the P0 payload

Checked 2026-11-08 with `gh 2.103.3`, authed as `karczews`
(scopes `gist read:org repo`), probed against public `cli/cli` PRs (read-only).

## Call 1 — PR core (`gh pr view --json`)

All P0 display fields except comment counts come from one call:

```
gh pr view --json url,number,title,state,isDraft,additions,deletions,changedFiles,\
headRefName,baseRefName,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,\
autoMergeRequest,updatedAt
```

Verified on `cli/cli#14964` (open, `REVIEW_REQUIRED`, `mergeStateStatus: BLOCKED`,
`mergeable: MERGEABLE`): every field present. `statusCheckRollup` entries carry
`__typename` (`CheckRun` with `status`/`conclusion`/`name`, `StatusContext` with
`state`/`context`), matching the checks aggregator in the design.

Deliberately excluded: `comments` / `reviews` arrays (they embed full bodies —
wasteful to poll every 60s). Counts come from call 2 instead.

## Call 2 — comment counts (`gh api graphql`)

`gh pr view --json` has no `reviewThreads` field, so unresolved threads need GraphQL:

```graphql
query {
	repository(owner: "...", name: "...") {
		pullRequest(number: N) {
			comments(first: 1) {
				totalCount
			}
			reviews(first: 1) {
				totalCount
			}
			reviewThreads(first: 100) {
				totalCount
				nodes {
					isResolved
				}
			}
		}
	}
}
```

Verified on `cli/cli#14927`: `comments.totalCount = 0`,
`reviews.totalCount = 1`, `reviewThreads.totalCount = 4` with all four nodes
`isResolved: false`. (Redacted: node list trimmed to the `isResolved` flags.)

## Locked P0 definitions

- `unresolvedThreads` = nodes with `isResolved == false` (first 100 nodes).
- `totalComments` = `comments.totalCount + reviews.totalCount + reviewThreads.totalCount`.
- Caveat (documented, accepted for P0): when `reviewThreads.totalCount > 100`,
  the unresolved count is a lower bound over the first 100 threads; the card shows
  the counted number, never an invented one.

## Refresh shape

Two subprocess calls per GitHub refresh (both under the existing 15s timeout each):
`gh pr view` for the core payload, `gh api graphql` for the counts. A failure in
either marks the card STALE per the spec; a `totalCount`-only failure must not
zero out previously shown counts.
