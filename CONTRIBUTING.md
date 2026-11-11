# Contributing

## Checks

Run `npm run check` before pushing: format, lint, typecheck, model tests,
registration and headless render tests. Use Conventional Commits for commits
and PR titles (`type(scope): subject`, lowercase imperative subject).

## Releases

Versions are managed by [release-please](https://github.com/googleapis/release-please):
`feat` → minor, `fix`/`perf` → patch, `!` (`feat!:`) → breaking (minor while `0.x`,
major after); `docs`/`chore`/`test`/`refactor` alone trigger no release.
Conventional commits on `main` accumulate into a release PR that bumps
`package.json`/`package-lock.json`, updates `CHANGELOG.md`, and tags
`vX.Y.Z` — merge it to publish. Do not bump versions manually; CI rejects
version edits in feature PRs. The pinned install command in the README's
Install section always points at the latest tag.
