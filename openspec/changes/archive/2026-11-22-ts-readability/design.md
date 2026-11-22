# Design

## Context

See proposal.md Why for motivation. The change lands on `chore/biome-rules-improvement` at main `d9a30d5`, where the formatter step is already applied in the working tree (Biome `lineWidth: 100`, `trailingCommas: "all"`, whole repo reformatted) but not committed, and `dist/` was last built by TS 5.9 while CI now builds with TS 7.

Measured baseline for the stricter rules: `noNestedTernary` 4 hits; `useNumericSeparators` 5 hits; `useMaxParams` 2 hits (`run`, `fetchCounts`, limit 4); `noExcessiveCognitiveComplexity` 1 hit (`cycle()` scores 58, limit 15; `parsePRView` and `mergeLineOf` pass); tsc strict flags — the seven listed in the proposal produce 0 errors, `noUncheckedIndexedAccess` produces 13 (2 in `splitPRUrl`, 11 in `test/model.test.ts`). These were measured with TS 5.9, so they are rechecked after `npm ci` installs TS 7.

Constraints: the two-file layout (`model.ts`, `tui.tsx`) is fixed — `compile.mjs`, `check-imports.mjs`, the `files` list in `package.json`, and AGENTS.md all depend on it. Every commit passes `npm run check` on its own, which includes `verify:dist`, so every source change also commits the rebuilt `dist/`. A lint rule is switched on in the same commit as the code fixes it requires.

## Goals / Non-Goals

**Goals:**
- Same behavior and same rendered text; code that is easier to read and checked by the compiler and linter.
- A formatting-only reformat commit, proven against a scratch worktree before it lands.
- Typed `gh` enums with record lookups, so adding a merge line forces a tone choice (`Record<MergeLine, Tone>`).
- A monitor whose cycle reads as ordered steps with unchanged side-effect order.

**Non-Goals:**
- No user-visible behavior, requirement, or rendered-text changes (`skip_specs: true`); `parsePRView` normalizing unknown enum strings (Decision 3) is the only data-level change.
- No function-length lint rule. Biome counts a nested function's lines toward the containing function, so `createMonitor` and `setup()` — closure factories holding state — cannot pass any useful limit without becoming classes or module-level functions. That is too much risk in the concurrency-sensitive monitor for a cosmetic rule; `noExcessiveCognitiveComplexity` covers the actual problem in `cycle()`, and `setup()` still gets shorter through hoisting in task 8 because it helps, not to satisfy a rule.
- No cleanup of `scripts/check-imports.mjs` complexity (out of scope); the complexity and parameter rules apply only to `model.ts` and `tui.tsx` through a Biome overrides entry.
- `exactOptionalPropertyTypes` and `noPropertyAccessFromIndexSignature` are skipped: one adds noise, the other makes code harder to read.

## Decisions

### 1. The reformat is its own commit, proven before it lands
`lineWidth: 100` with `trailingCommas: "all"` reflows every file. Before committing, a scratch worktree at HEAD gets the edited `biome.json` and a full `biome format --write` from the repo's pinned Biome 2.6.7; its result must be identical to the working tree (excluding `dist/`), which proves the pending diff is formatting only and was produced by the pinned version.
Rationale: keeps blame meaningful; the reformat SHA later goes into `.git-blame-ignore-revs`.
Alternatives considered: mixing formatting into the refactor commits (hides real changes, rejected).

### 2. Strict flags in `tsconfig.json` only
`tsconfig.dist.json` is left alone: the new flags live only in the root `tsconfig.json`, which is `noEmit`, so they only take effect during type checking. `scripts/compile.mjs` emits `dist/` through `tsconfig.dist.json`, which does not set them, so the build output is unaffected and no flags are duplicated.
`splitPRUrl` destructures and guards the regex groups (same "Invalid PR URL" error), and the test narrows indexed access with `assert.ok`/guards instead of non-null `!`.

### 3. `gh` enums as literal unions derived from `as const` arrays
`MergeLine` (the 12 strings `mergeLineOf` returns), `ReviewDecision`, `MergeStateStatus`, and `Mergeable` are each an `as const` array with the type derived from it. `parsePRView` maps unknown values through a small `oneOf(value, allowed, fallback)` helper: `""` for review, `"UNKNOWN"` for the other two.
Rationale: `summarizeReview` and `mergeLineOf` already treat unknown values exactly like these fallbacks (traced branch by branch), so what the user sees is unchanged; the records below force exhaustiveness when values are added.
Alternatives considered: branded types or rejecting unknown strings (rejected: changes behavior).

### 4. Lookups instead of if chains
`summarizeReview` becomes `Record<ReviewDecision, string>`; `displayError` becomes `Record<FetchErrorKind, string>` with `absent` mapped to "PR refresh failed" as today.
Colors key off tone, not display strings: model.ts exports `Tone = "success" | "warning" | "error" | "muted" | "base"` and `MERGE_TONE: Record<MergeLine, Tone>` — success for "Ready to merge" and "Merged", muted for "Closed without merging" and "Merge status unknown", warning for everything else. `tui.tsx` maps tones to theme tokens with `toneColor(theme, tone)`, which replaces `mergeFg`; the lifecycle nested ternary becomes `lifecycleTone(state)` (MERGED success, CLOSED error, else base).
Rationale: the record must cover every `MergeLine`, so adding a merge line forces a choice of tone; string comparison against display text cannot drift from `mergeLineOf` because there is none.

### 5. Subprocess options as one object
`run(file, args, { cwd, signal, input?, timeoutMs? }: RunOptions)` keeps `Execute = typeof run`; callers in `detectRepo`, `fetchPRView`, `fetchCounts`, `openBrowser`, and `copyToClipboard` switch to it. `splitPRUrl`'s result becomes the exported `PRRef` type, and `countsQuery(ref)` / `fetchCounts(ref, directory, signal, execute)` take it directly — `parsePRView` already checks that the URL number matches. A Biome overrides entry for `["model.ts", "tui.tsx"]` sets `complexity.useMaxParams` to the default limit of 4.
Rationale: positional booleans and five-plus positional parameters are the two biggest readability offenders the linter found.

### 6. Monitor cycle split into ordered closure steps
`cycle()` becomes a sequence of closure steps in this order: `currentDirectory()` (empty-cwd and changed-directory resets), `detect(cwd)` (detection AbortController bookkeeping), `syncRepo(cwd, repo)` (key reset and branch emit), `shouldFetch(force, activity)` (in-flight and throttle checks, aborting when forced), and `fetchAndPublish(cwd, repo)` (the try/catch/finally, with `publishError(error)` pulled out if it still scores over 15). The existing order of side effects is kept exactly. `Repo` and `Monitor` are exported and `createMonitor` returns `Monitor`. The same overrides entry sets `complexity.noExcessiveCognitiveComplexity` to the default limit of 15.
Rationale: the monitor tests are the safety net and must pass without edits (apart from task 6's signature changes); converting the closure factory to a class would risk the serialization and abort semantics for a cosmetic rule.

### 7. Card components at module scope
`ActionButton` and `PrCard` hoist out of `setup()` with `theme` passed as a prop typed `import type { ResolvedTheme } from "@opencode/theme/tui"` (type-only imports are skipped by `check-imports.mjs`). `PrCard` takes `{ pr, now, loading, fetchedAt, theme, onOpen }` (the prop `p` is renamed to `pr`). In Solid components moved to module scope, props are never destructured — they are read as `props.x` so they stay reactive. `checksLine` moves to model.ts as `checksLineOf(counts)`, next to the other summary text, with unit tests. `Card` stays inside `setup()` because it owns `monitor` and `expanded`. The JSX arrow uses a string expression, not an entity.
Rationale: `setup()` keeps only wiring; the card reads as a component tree.

## Risks / Trade-offs

- [Risk] The pending reformat was produced by Biome 2.6.6 while the pin is 2.6.7 → Mitigation: scratch-worktree proof before committing; if outputs differ, stop and report instead of committing.
- [Risk] The monitor refactor touches concurrency-sensitive code → Mitigation: steps preserve the exact side-effect order; the existing monitor tests pass unedited.
- [Risk] Hoisted components lose `setup()` closures → Mitigation: state and handlers arrive as props and are read reactively; render tests pin the asserted strings.
- [Risk] `dist/` drift inside the commit series → Mitigation: every source change runs `npm run compile` and commits the rebuilt `dist/`; `verify:dist` enforces it.
- [Trade-off] No function-length rule, so `createMonitor` and `setup()` stay long → accepted; cognitive complexity covers the real problem in `cycle()`, and hoisting shortens `setup()` anyway.
- [Trade-off] The reformat touches every file → accepted; isolated commit, "Rebase and merge" keeps it separate on main, and a follow-up `chore` adds `.git-blame-ignore-revs`.

## Migration Plan

None: a pure refactor on a feature branch, merged with "Rebase and merge". After merge, a small follow-up `chore` adds `.git-blame-ignore-revs` with the reformat commit's post-rebase SHA on main plus a `CONTRIBUTING.md` line: `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

## Open Questions

None that change the approach.
