# Proposal

## Why

The plugin works, but the TypeScript reads harder than it should: merge and lifecycle colors are picked by comparing display strings, `gh` enum fields are untyped `string`s, the monitor's `cycle()` concentrates every polling decision in one function that scores 58 on cognitive complexity, and Biome's default 80-column width explodes signature-heavy code into many short lines. This change makes the same behavior easier to read and lets the compiler and linter check it.

## What Changes

- Formatter: line width 100 plus trailing commas; a formatting-only commit covering the whole repo and the rebuilt `dist/`.
- Linter: enable `style.useNumericSeparators`, `style.useBlockStatements`, and `style.noNestedTernary` for all files, plus `complexity.useMaxParams` and `complexity.noExcessiveCognitiveComplexity` (defaults) for `model.ts` and `tui.tsx` via a Biome overrides entry. No function-length rule; see design.
- Compiler: add `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, and `noUncheckedIndexedAccess` to `tsconfig.json`. `tsconfig.dist.json` stays alone: the root `tsconfig.json` is `noEmit`, so the flags only take effect during type checking, and `dist/` is emitted through `tsconfig.dist.json`, which does not set them.
- model.ts: literal-union types for the merge line, review decision, merge state, and mergeable fields (as const arrays with derived types); `oneOf` normalization in `parsePRView`; `summarizeReview` and `displayError` become record lookups; exported `Tone` and `MERGE_TONE: Record<MergeLine, Tone>`; subprocess options passed as one object; exported `PRRef`, `Repo`, and `Monitor` types; `cycle()` split into ordered closure steps; `asPositiveInt` for the PR number; multi-line GraphQL query template.
- tui.tsx: `toneColor(theme, tone)` replaces `mergeFg`, `lifecycleTone(state)` replaces the nested lifecycle ternary; platform launchers and the clipboard command come from lookups and early returns; `ActionButton` and `PrCard` hoist to module scope with `theme` passed as a prop; `checksLine` moves to model.ts as `checksLineOf(counts)`.
- Tests: updated for the new signatures, plus new tests pinning `MERGE_TONE`, `checksLineOf`, and `parsePRView` normalization. The rendered card text is unchanged; `git diff main -- test/test-render.test.mjs` must show no changes to asserted strings.

Explicitly out of scope: any user-visible behavior or requirement change (the one data-level change is `parsePRView` normalizing unknown `gh` enum strings to their fallbacks, which renders the same text; see design Decision 3), `scripts/check-imports.mjs` complexity cleanup, `exactOptionalPropertyTypes`, and `noPropertyAccessFromIndexSignature` (measured: they add noise or make the code harder to read).

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- None. This is a pure readability/refactor change with no requirement-level behavior change, so the change sets `skip_specs: true` in `.openspec.yaml`.

## Impact

- Code: `model.ts`, `tui.tsx`, `test/model.test.ts`, plus `biome.json`, `tsconfig.json`, and the rebuilt `dist/` (every source change commits the rebuilt `dist/` so `verify:dist` passes per commit).
- Toolchain: no dependency changes; `package.json` requests TypeScript `^7.0.2` (the lockfile resolves `7.0.2`) and pins Biome `2.6.7`, from #36 and #35.
- Release: none. Every commit is `chore`, `refactor`, or `docs`, so release-please cuts no release.
- Merge plan: "Rebase and merge" so the reformat stays its own commit on main, followed by a small `chore` adding `.git-blame-ignore-revs` with the post-rebase reformat SHA.
