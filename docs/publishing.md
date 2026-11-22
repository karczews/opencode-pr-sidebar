# Publishing to npm

`opencode2-pr-sidebar` is published from GitHub Actions using npm Trusted
Publishing (OIDC). There is no npm token to create, store, or rotate: the
publish job asks GitHub for a short-lived identity token, and npm accepts it
only from the workflow configured on the package. Provenance is generated
automatically for public repositories and packages.

Release versions and tags are owned by `release-please`. Do not bump
`package.json`, `package-lock.json`, `CHANGELOG.md`, or
`.release-please-manifest.json` by hand — the `version ownership` check in
`check.yml` rejects those edits in feature PRs.

## One-time setup on npmjs.com

In the package settings at `npmjs.com/package/opencode2-pr-sidebar/access`, add
a **GitHub Actions** trusted publisher with:

| Field | Value |
| --- | --- |
| Organization or user | `karczews` |
| Repository | `opencode-pr-sidebar` |
| Workflow filename | `release-please.yml` |
| Environment name | leave blank (unless an environment is added to the job) |
| Allowed actions | enable **direct `npm publish`** |

Use the filename only, with its extension; npm validates it against the
workflow that runs the publish, including for manual runs. Configurations
created after 2026-09-03 default to `npm stage publish` only, so direct
publishing must be selected explicitly. A new configuration must complete its
first successful publish within **2 days** or it expires and must be recreated.

For extra hardening, set **Settings → Publishing access → Require two-factor
authentication and disallow tokens** after trusted publishing works; OIDC
publishes keep working.

## How a release is published

1. Merged `feat:` / `fix:` commits (Conventional Commits) make release-please
   open or update a release PR on `main`; `docs:` / `chore:` / `test:` /
   `refactor:` commits do not trigger a release.
2. Merging the release PR creates the GitHub release and tag. The
   `release-please` job reports `release_created`, which triggers the
   `publish-npm` job in `.github/workflows/release-please.yml`.
3. That job checks out the tagged code, installs from `.nvmrc`, verifies npm ≥
   11.5.1 (the documented minimum), runs `npm ci` and `npm run verify:dist`,
   then runs `npm publish`. It has only `contents: read` and `id-token: write`
   permissions — no `NPM_TOKEN` secret, no `--provenance` flag.

`npm run verify:dist` rebuilds `dist/` and fails on drift. The compiled
`dist/tui.js` and `dist/model.js` are committed because OpenCode skips install
scripts; never add `build`, `prepare`, `prepack`, `install`, `postinstall`, or
`preinstall` scripts (see [distribution notes](plugin-distribution.md) §3.3).

## Publishing the current version on demand

To publish the version already in `package.json` without cutting a new release
(for example, the first npm release):

1. Push `release-please.yml` to `main`.
2. In GitHub, go to **Actions → release-please → Run workflow** and tick
   **Publish the current package.json version to npm**.

Running `npm publish` locally is not part of this flow — with no npm account
session it fails with `ENEEDAUTH`, and with a token session it bypasses the
workflow's provenance and verification. Trusted publishing works only in CI.

## Verify a published package

```sh
npm view opencode2-pr-sidebar version
opencode plugin add opencode2-pr-sidebar
opencode plugin list
```

`plugin add` writes TUI-only plugins to `~/.config/opencode/cli.json`. Restart
OpenCode and confirm the card renders and the palette commands work; test the
installed package, not a workspace-linked copy.

## Troubleshooting

- **`ENEEDAUTH` from the workflow** — check that the npm trusted publisher's
  owner, repository, and `release-please.yml` filename match exactly (all
  fields are case-sensitive), that direct `npm publish` is allowed, and that
  the configuration has not expired.
- **`git dep preparation failed`** — a build-class lifecycle script was added;
  keep build output committed and script names outside the trigger list.
- **Name collision** — `opencode-pr-sidebar` on npm belongs to a different
  project; this package is `opencode2-pr-sidebar`.

Sources: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers),
[automatic provenance](https://docs.npmjs.com/generating-provenance-statements),
[GitHub OIDC](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect).
