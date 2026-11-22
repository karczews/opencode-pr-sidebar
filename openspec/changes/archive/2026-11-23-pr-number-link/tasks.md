# Tasks

## 1. Setup

- [x] 1.1 Confirm `npm run check` passes on the current branch before any change. Run `npm ci` first if `node_modules` is missing. This gives a baseline for later failures

## 2. Move the link from the title to the number

- [x] 2.1 In `test/test-render.test.mjs`, replace the test "sidebar card underlines only the PR title link" with "sidebar card makes only the PR number a link". It asserts that the `#42` span has the `TextAttributes.UNDERLINE` bit and the `LINK_RGB` color, and that `setup.renderer.getLinkIdAt` returns a non-zero id on its cells. It also asserts that the `Example smoke PR` span has no UNDERLINE bit, uses the `TONE_RGB.base` color, and has link id 0, and that the `feature` branch-line span has no UNDERLINE bit. Verify the new test fails against the current `tui.tsx` with `npm run test:render`
- [x] 2.2 In the test "open and copy report failures with the URL when launchers are unavailable", add two clicks before the button loop, reusing its failing-launcher stubs and toast polling:
  - Click `#42` (found with `findText`) and expect exactly one toast matching `/Could not launch a browser.*pull\/42/`.
  - Click the `Example smoke PR` title, flush and wait about 1 s, and expect zero toasts.

  Verify the title-click assertion fails against the current `tui.tsx`, where the whole line opens the PR
- [x] 2.3 In `tui.tsx` `PrCard`, replace the top-line `<text>` with a `<box flexDirection="row" gap={1}>` holding two elements:
  - a number `<text flexShrink={0} fg={theme.markdown.link}>` with the existing `onMouseUp` open handler, containing `<a href={url}><u><b>#{number}</b></u></a>`;
  - a title `<text flexShrink={1} fg={theme.text.base}>{clean(title)}</text>` with no handler.

  Verify the tests from 2.1 and 2.2 pass and all other render tests still pass with `npm run test:render`
- [x] 2.4 Update `README.md`:
  - the walkthrough sketch line `#42 Fix login  (hyperlink, click to open)` → `#42 Fix login  (number is a link, click to open)`;
  - step 3 "Click the title or `Open`" → "Click the PR number or `Open`".

  Leave the `x-release-please` block untouched. Verify with `git diff README.md` that only those lines changed
- [x] 2.5 Run `npm run compile` and stage the regenerated `dist/tui.js`. Verify `npm run verify:dist` exits 0

## 3. Integration check

- [x] 3.1 Run `npm run check` and verify that it exits 0

## Workflow follow-up

- Commit on `feat/updatescore-link` so this lands in the still-open PR #43, and update that PR's title and description to describe the number link, not the title underline.
- Archive the change after review.
