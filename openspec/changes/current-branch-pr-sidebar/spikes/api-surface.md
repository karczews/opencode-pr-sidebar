# Spike 1.1 — OpenCode v2 TUI plugin API surface

Checked 2026-11-08 on this machine: `opencode v2.2.6`, node `v26.13.0`.

## Corrected conclusion

The first pass read `@opencode-ai/plugin@1.18.29` (the V1 author package) and
concluded the V1 API. Live testing proved the v2.2.6 host loads external TUI
modules but only calls the **V2** `setup(context)` entry, never the V1
`tui(api)` callback: a valid-looking V1 module appeared as `local` in the
Plugins dialog while its slot, commands, and gh calls never ran.

Authoring package: `@opencode/plugin@2.2.6` (`./tui` export), verified to exist
on npm at the host version and installed as a devDependency.

## Confirmed V2 surface (types in `@opencode/plugin/dist/tui/context.d.ts`)

- Module: `export default Plugin.define({ id, setup(context) })`; setup may
  return a cleanup function. Returned/claimed resources are also disposed by
  the host when the plugin deactivates.
- Slots: `context.ui.slot({ append: "sidebar.content", render: ({ sessionID }) => JSX })`
  (also `prepend` / `before` / `after` / `replace`).
- Keymap: `context.keymap.layer(() => ({ mode: "global", priority, commands, bindings }))`
  with commands `{ id, title, group, palette: true, enabled, run }`. Palette
  discovery reads reachable layers, so a command without `palette: true` stays
  out of the palette.
- Events: `context.data.on(type, handler)` returns an unsubscribe; verified
  `session.execution.succeeded` and `vcs.branch.updated` exist in the client
  event union.
- Theme: `context.theme` is the resolved theme (`text.base`, `text.muted`,
  `text.faint`, `text.feedback.{success,warning,error}.base`,
  `background.raised.{base,high}`, `markdown.link`, `diff.text.*`).
- UI: `context.ui.toast.show({ title, message, variant })`.
- Location: `context.location?.directory` with `context.data.location.default()`
  as fallback.
- No lifecycle signal on `context`; plugins own their abort controller.

## Verification

Live host run on a throwaway Git repo with a stubbed `gh`: the card rendered
every P0 field, `gh pr view` + the GraphQL counts query fired, and the palette
listed `PR: Open on GitHub`, `PR: Copy URL`, and `PR: Refresh status`.
