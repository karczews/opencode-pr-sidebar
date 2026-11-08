# AGENTS.md

OpenCode TUI sidebar plugin for GitHub PRs (current-branch card). Early stage: `LICENSE` plus OpenSpec planning artifacts under `openspec/`; no plugin source yet. Implementation plans live in `openspec/changes/<name>/` — read `proposal.md`, `specs/`, `design.md`, `tasks.md` there before coding.

## Commits

Use Conventional Commits for every commit: `type(scope): subject`.

- `type`: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`. Use `docs` for OpenSpec planning artifacts.
- `scope`: area touched, e.g. `openspec`, `pr-sidebar`. Omit it when the change is repo-wide.
- `subject`: imperative mood, lowercase, no trailing period, max 72 chars.
- Add a body only when the subject cannot explain why; planning rationale belongs in the OpenSpec artifacts, not the commit body.

Examples:

- `chore: add MIT license`
- `docs(openspec): add current-branch-pr-sidebar change`
- `docs: add AGENTS.md commit conventions`
- `feat(pr-sidebar): render current-branch PR card`
