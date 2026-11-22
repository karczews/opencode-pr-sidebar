# Tasks

## 1. Setup

- [x] 1.1 Install dependencies in this worktree (`npm ci`) and verify `npm run check` passes on the unchanged tree, so later failures can be traced to this change

## 2. Underline the PR title

- [x] 2.1 In `test/test-render.test.mjs`, add a render test that uses `setup.captureSpans()` to find the span(s) whose text contains `Example smoke PR` and asserts that their `attributes` have the `TextAttributes.UNDERLINE` bit (from `@opentui/core`) and that their `fg` is the mock theme's `markdown.link` color. The test also asserts that the `#42` span and the `feature -> main` branch-line span do not have that bit. Verify the new test fails against the current `tui.tsx` with `npm run test:render`
- [x] 2.2 In `tui.tsx` `PrCard`, wrap the title text inside the existing `<a href=...>` with `<u>…</u>`. Keep the `fg={theme.markdown.link}` color, the `<b>#N</b>` prefix and the `onMouseUp` open handler unchanged. If `<u>` inside `<a>` drops the hyperlink or the underline, nest `<a>` inside `<u>` instead, and keep whichever order passes 2.1. Verify the test from 2.1 passes, and that the existing P0 field test and open/copy test still pass, with `npm run test:render`
- [x] 2.3 Run `npm run compile` and include the regenerated `dist/tui.js`. Verify `npm run verify:dist` reports no diff

## 3. Integration check

- [x] 3.1 Run `npm run check` (format, lint, imports, typecheck, dist, model, registration and render tests) and verify that it exits 0
