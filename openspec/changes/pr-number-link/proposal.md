# Proposal

## Why

The `underline-pr-title-link` change underlined the whole PR title, which in practice makes the card's top line look like one long link while the `#<number>` prefix doesn't match it. A short, single link target reads better. Making only the PR number the link keeps the cue obvious and leaves the title as plain, readable text.

## What Changes

- The `#<number>` prefix becomes the only link on the card's top line: it is underlined, shown in the link color, carries the terminal hyperlink, and opens the PR when clicked.
- The PR title is no longer a link: it has no underline and no terminal hyperlink, and clicking it does nothing.
- The title switches from the link color to the normal text color, since it no longer opens anything. Assumption: the user asked for the title not to be clickable, and keeping the link color would still make it look like a link.
- The number stays bold.
- The Open button, Copy URL button and the command palette entries are unchanged.
- The README walkthrough is updated, because it currently says to click the title.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pr-sidebar`: the "Clickable pull request link with open and copy actions" requirement is removed and replaced by "Clickable pull request number with open and copy actions". The new requirement swaps the "Title is styled as a link" scenario for "Number is styled as a link", adds "Title is not clickable", and has "Open pull request in browser" name the number instead of the title link. The fallback and copy scenarios carry over unchanged. This is a remove-and-add rather than an in-place edit, because OpenSpec doesn't allow a modified requirement to drop a scenario.

## Impact

- `tui.tsx`: the top line in `PrCard` is split into separate number and title elements, because OpenTUI only delivers mouse events to whole text elements, not to spans inside them (see `design.md`).
- `test/test-render.test.mjs`: the "underlines only the PR title link" test is replaced by one that checks the number is the underlined link and the title isn't. A new test clicks the number and expects it to open the PR, and another clicks the title and expects nothing to happen.
- `dist/tui.js`: rebuilt with `npm run compile`.
- `README.md`: the walkthrough sketch and step 3 change from clicking the title to clicking the number.
- No new dependencies and no model changes.
- PR #43 (`feat/updatescore-link`) is still open with the title underline. This change can land on the same branch so the title underline never ships.
