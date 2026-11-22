# Tasks

Each numbered task is one Conventional Commit; every commit passes `npm run check` on its own, which means every source change also commits the rebuilt `dist/`. A lint rule is switched on in the same commit as the code fixes it requires.

## 0. docs(openspec): add ts-readability change

- [x] 0.1 Run `openspec new change ts-readability`, set `skip_specs: true` in `.openspec.yaml` (no requirement changes), and port the plan into `proposal.md`, `design.md`, and `tasks.md`, verified by `openspec validate --changes ts-readability` and by `npm run check` staying green (openspec/ is excluded from every check).

## 1. chore: widen formatter line width to 100

- [x] 1.1 Run `npm ci`; confirm `npx tsc --version` reports 7.x and `npx biome --version` reports 2.6.7; run `npm run compile` so `dist/` is rebuilt by TS 7, then get a green `npm run check` baseline on the reformatted tree.
- [x] 1.2 Prove the pending diff is formatting only without touching the working tree: scratch `git worktree add` at HEAD, copy the edited `biome.json` in, run the repo's pinned `biome format --write`, diff against the working tree excluding `dist/`, and require an identical result (if not, stop and report); remove the worktree.
- [x] 1.3 Commit only formatting changes and the rebuilt `dist/`.

## 2. chore: enable stricter typescript compiler flags

- [x] 2.1 Add `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, and `noUncheckedIndexedAccess` to `tsconfig.json`; leave `tsconfig.dist.json` alone (the root config is `noEmit`, so the flags only affect type checking), verified by `npm run typecheck` and `npm run compile` both passing with TS 7.
- [x] 2.2 `model.ts` `splitPRUrl`: destructure the regex groups and check them (for example `const [, owner, repo, num] = match` plus a guard), throwing the same "Invalid PR URL" error, verified by the existing `splitPRUrl` tests.
- [x] 2.3 `test/model.test.ts`: fix the 11 `noUncheckedIndexedAccess` errors by narrowing with `assert.ok(x)` or a guard; no non-null `!`, verified by `npm run check`.

## 3. chore: enable numeric separator and block statement rules

- [x] 3.1 In `biome.json`, set `style.useNumericSeparators` and `style.useBlockStatements` to `"error"` for all files, verified by `npm run lint`.
- [x] 3.2 Apply the fixes with `npx biome lint --write --unsafe --only=style/useNumericSeparators --only=style/useBlockStatements .` (60000 becomes 60_000 and similar; braces added to 17 statements in `check-imports.mjs`); no hand edits expected, verified by `git diff` showing only those changes and by the full test suite.

## 4. refactor(pr-sidebar): type merge status and gh enum fields

- [x] 4.1 Define `MergeLine` (the 12 strings `mergeLineOf` returns), `ReviewDecision`, `MergeStateStatus`, and `Mergeable` as `as const` arrays with derived types; `mergeLineOf` returns `MergeLine`, verified by `npm run typecheck`.
- [x] 4.2 `parsePRView`: add a small `oneOf(value, allowed, fallback)` helper mapping unknown values to the fallback (`""` for review, `"UNKNOWN"` for the other two); the displayed text is unchanged because `summarizeReview` and `mergeLineOf` already treat unknown values like these fallbacks, verified by the existing summarizer tests plus a new `parsePRView` test that pins the normalization.
- [x] 4.3 Turn `summarizeReview` into a `Record<ReviewDecision, string>` and `displayError` into a `Record<FetchErrorKind, string>` (absent maps to "PR refresh failed" as today), verified by the existing tests unedited.
- [x] 4.4 Export `Tone` and `MERGE_TONE: Record<MergeLine, Tone>` (success: "Ready to merge", "Merged"; muted: "Closed without merging", "Merge status unknown"; warning: everything else); in `tui.tsx` add `toneColor(theme, tone)` replacing `mergeFg` and `lifecycleTone(state)` replacing the lifecycle nested ternary (MERGED success, CLOSED error, else base), verified by a new test pinning `MERGE_TONE` and by the render tests.
- [x] 4.5 Move the `summarizeReview("COMMENTED")` case into the `parsePRView` normalization test (it no longer type-checks), verified by `npm run check`.

## 5. refactor(pr-sidebar): replace nested ternaries with lookups

- [x] 5.1 `openBrowser`: the launcher comes from a `Partial<Record<NodeJS.Platform, string>>` lookup (`darwin: "open"`, `linux: "xdg-open"`), verified by the existing launcher tests.
- [x] 5.2 `copyToClipboard`: the command comes from a new `clipboardCommand(platform, env)` function using early returns, verified by the existing clipboard tests.
- [x] 5.3 Turn on `style.noNestedTernary` for all files; the only remaining hits are the two replaced here, verified by `npm run lint`.

## 6. refactor(pr-sidebar): pass subprocess options as objects

- [x] 6.1 `run(file, args, { cwd, signal, input?, timeoutMs? }: RunOptions)` with `Execute = typeof run`; update the callers in `detectRepo`, `fetchPRView`, `fetchCounts`, `openBrowser`, and `copyToClipboard`, verified by `npm run check` (most test fakes take only `(file, args)` and do not change).
- [x] 6.2 Update the four direct `run(...)` tests, the fake that takes `_cwd`, and any fake that reads `input`, verified by the monitor and platform tests.
- [x] 6.3 Export `PRRef = { owner, repo, number }` as `splitPRUrl`'s return type; change `countsQuery(ref)` and `fetchCounts(ref, directory, signal, execute)`; the monitor passes `splitPRUrl(parsed.url)` straight in (`parsePRView` already checks the URL number), verified by the counts tests including the call near line 216.
- [x] 6.4 Add a Biome overrides entry for `["model.ts", "tui.tsx"]` setting `complexity.useMaxParams` to `"error"` with the default limit of 4, verified by `npm run lint`.

## 7. refactor(pr-sidebar): split monitor cycle into steps

- [x] 7.1 Export `Repo = { root, branch }` (used by `detectRepo`) and `Monitor = { tick(force?, activity?): void; stop(): void }` as `createMonitor`'s return type; in `tui.tsx`, `ReturnType<typeof createMonitor>` becomes `Monitor`, verified by `npm run typecheck`.
- [x] 7.2 Split `cycle()` into closure steps in order — `currentDirectory()`, `detect(cwd)`, `syncRepo(cwd, repo)`, `shouldFetch(force, activity)`, `fetchAndPublish(cwd, repo)` (with `publishError(error)` pulled out if it still scores over 15) — and have `cycle()` call them in sequence, keeping the existing order of side effects exactly, verified by the existing monitor tests passing without edits (apart from task 6 signature changes).
- [x] 7.3 In the same overrides entry, set `complexity.noExcessiveCognitiveComplexity` to `"error"` with the default limit of 15, verified by `npm run lint`.

## 8. refactor(pr-sidebar): hoist card components out of setup

- [x] 8.1 Move `ActionButton` and `PrCard` to module scope, passing `theme` as a prop typed `import type { ResolvedTheme } from "@opencode/theme/tui"`; verify the rewritten `check-imports.mjs` still skips type-only imports via `npm run check:imports`.
- [x] 8.2 `PrCard` props become `{ pr, now, loading, fetchedAt, theme, onOpen }`; rename the prop `p` to `pr`; never destructure props in hoisted Solid components (read `props.x` so they stay reactive); use a JSX string for the arrow; split `PrCard` along its three `<box>` groups into `PrHeader`, `PrStatus`, and `PrStats` only if it is still too long, verified by the render tests.
- [x] 8.3 Move `checksLine` to model.ts as `checksLineOf(counts)` next to the other summary text, with unit tests; the render test that checks "Checks: 1 passed / 1 failed / 0 pending" must still pass; `Card` stays inside `setup()` because it owns `monitor` and `expanded`, verified by `npm run check`. No lint rule changes in this task.

## 9. refactor(pr-sidebar): tidy pr view parsing

- [x] 9.1 Add `asPositiveInt(value, label)` and remove the two `data.number as number` casts in `parsePRView`, verified by the existing `parsePRView` tests.
- [x] 9.2 Write the GraphQL query in `countsQuery` as a multi-line template literal (GraphQL ignores the extra whitespace) and loosen the test regex near line 225 to `/^query=query \{\s*repository\(owner: "o", name: "r"\)/`, verified by the counts tests.

## Verification

- [x] V.1 After each task: `npm run check` green and `git status` clean (the rebuilt `dist/` committed).
- [x] V.2 At the end: `node scripts/check-commits.mjs main HEAD` validates the Conventional Commit messages.
- [x] V.3 At the end: `git diff main -- test/test-render.test.mjs` shows no changes to asserted strings, so every string the render tests check still renders; this does not cover text the tests do not check.
- [x] V.4 Manually check colors, since the render tests only check text: load the plugin in OpenCode (`/run`) and confirm "Ready to merge" is green, blockers are yellow, "Closed without merging" is muted, and a merged lifecycle is green while a closed one is red.
