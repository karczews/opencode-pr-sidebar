# AGENTS.md

OpenCode TUI sidebar plugin for GitHub PRs (current-branch card). Target host: OpenCode v2, using the V2 TUI API (`@opencode/plugin/tui`, `Plugin.define({ id, setup })`); V1 `tui(api)` modules load but never run, so keep the V2 entry. `tui.tsx` holds the card and setup wiring; `model.ts` holds git/gh detection, parsing, summaries, the polling monitor, and browser/clipboard actions.

Verify with `npm run check` (format, lint, typecheck, model tests, registration test, headless render tests). Implementation plans live in `openspec/changes/<name>/` — read `proposal.md`, `specs/`, `design.md`, `tasks.md` there before coding.

## Commits

Use Conventional Commits for every commit: `type(scope): subject`.

- `type`: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`. Use `docs` for OpenSpec planning artifacts.
- `scope`: area touched, e.g. `openspec`, `pr-sidebar`. Omit it when the change is repo-wide.
- `subject`: imperative mood, lowercase, no trailing period, max 72 chars.
- Append `!` before the colon for semver breaking changes (`feat!:`).
  `release-please` bumps minor pre-1.0, major after.
- Add a body only when the subject cannot explain why; planning rationale belongs in the OpenSpec artifacts, not the commit body.

Examples:

- `chore: add MIT license`
- `docs(openspec): add current-branch-pr-sidebar change`
- `docs: add AGENTS.md commit conventions`
- `feat(pr-sidebar): render current-branch PR card`

## Versions

Versions are owned by release-please (node strategy): never bump
`package.json`/`package-lock.json`, `CHANGELOG.md`, or
`.release-please-manifest.json` manually — CI rejects such edits in feature
PRs. `release-please-config.json` stays human-editable. The install pin in
`README.md` carries an `x-release-please-version` marker — leave that line's
shape intact. `docs`/`chore`/`test`/`refactor` commits trigger no release.
