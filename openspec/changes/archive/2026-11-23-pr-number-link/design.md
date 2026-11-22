# Design

## Context

The card's top line in `PrCard` (`tui.tsx`) is currently a single `<text>`, roughly:

```tsx
<text fg={theme.markdown.link} onMouseUp={open}>
  <b>#{number}</b>{" "}
  <a href={url}><u>{title}</u></a>
</text>
```

The click handler sits on the whole `<text>`, so any click on the line opens the PR. In OpenTUI (`@opentui/core` 0.8.x), mouse handlers (`onMouseUp` and the rest) belong to `Renderable`. The inline nodes `<b>`, `<u>`, `<a>` and `<span>` are `TextNodeRenderable`, which extends `BaseRenderable` and receives no mouse events. So the number can't be made clickable on its own while it stays a span inside the title's `<text>`.

## Goals / Non-Goals

**Goals:**
- Only the `#<number>` cells open the PR on click, carry the terminal hyperlink, and are underlined.
- The title wraps as it does today when it's longer than the sidebar is wide.

**Non-Goals:**
- Hover effects on the number.
- Changes to the Open and Copy URL buttons or the command palette.

## Decisions

**Split the line into two `<text>` elements in a row `<box>`.**

```tsx
<box flexDirection="row" gap={1}>
  <text flexShrink={0} fg={theme.markdown.link} onMouseUp={open}>
    <a href={url}><u><b>#{number}</b></u></a>
  </text>
  <text flexShrink={1} fg={theme.text.base}>{title}</text>
</box>
```

- The number is its own `Renderable`, so its `onMouseUp` fires only for clicks on the number. It keeps the existing left-button check and `stopPropagation`.
- The title `<text>` has no handler. Nothing above it in the card handles clicks (the header toggle is a separate box), so a click on it does nothing.
- `flexShrink={0}` keeps the number from wrapping or truncating. The title shrinks and wraps within the remaining width.
- `gap={1}` replaces the literal space that sat between the number and the title.
- Alternative considered: keep one `<text>` and decide in the handler whether the click fell on the number, by comparing `event.x` with the number's width. Rejected, because it depends on the text starting at a known column and breaks once the line wraps.

**The title uses `theme.text.base`.** The link color now marks only the part that opens the PR (see the proposal's assumption).

**Hyperlink stays an `<a>` around the number.** The render test already verifies `<a>` through `renderer.getLinkIdAt`, so the same check can move to the number's cells.

## Risks / Trade-offs

- [A long title now wraps with a hanging indent under itself instead of starting again at column 0 under `#42`.] → This is acceptable and arguably easier to read. The render test only checks that the title text is present, not how it wraps.
- [The click target shrinks from the whole line to three or four cells.] → That's what was asked for. The Open button and the command palette still offer larger targets.
- [`<u>` and nested `<a>`/`<b>` have only been verified on `@opentui/solid` 0.8.4.] → Same as the previous change. The render tests will catch a regression on the version in use.
