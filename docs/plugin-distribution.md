# Installing this TUI plugin: GitHub (Git spec) vs npm

Checked 2026-11-08 on this machine: `opencode v2.2.6` (Homebrew, macOS arm64),
`node v26.13.0`, `npm 11.20.0`, `gh 2.103.3`. Repo remote:
`git@github.com:karczews/opencode-pr-sidebar.git` (public, default branch `main`,
local `HEAD` == remote `HEAD` == `8c30d99`).

This is a research note, not a change to behaviour. It answers whether this repo's
TUI-only plugin can be distributed without publishing to npm, and what packaging
`opencode plugin add` actually requires. **Every claim below is cited to a primary
source**: official `opencode.ai` docs, the `anomalyco/opencode` repo/issues/spec,
official npm docs, this machine's CLI (help text, exact errors, `opencode debug
paths`), or the compiled v2.2.6 binary's embedded JavaScript. Sources are listed in
[Sources](#sources).

## Answer

**OpenCode v2 does support installing a TUI/CLI plugin directly from GitHub; npm
publishing is not required.** `opencode plugin add` accepts npm registry
names/versions/tags/ranges **and** npm-compatible Git package specifiers
(`github:owner/repo`, bare `owner/repo`, `git+https://…`, `git+ssh://…`,
`git@host:owner/repo.git`, `#branch`/`#tag`/`#sha`, `::path:` subdirectories).
It **rejects** local paths, `file://` URLs, tarballs and npm aliases with
`Error: Plugin target must be an npm registry package or Git package specifier`
— those are valid *config entries* in `cli.json` / `opencode.json(c)`, but not
install targets. For a TUI-only package, `plugin add` writes the spec into
`~/.config/opencode/cli.json` automatically; you do not have to hand-edit it.

For **this repo**, a GitHub install requires adding to `package.json`: `name`,
`version`, `exports["./tui"]`, and `files` covering `tui.tsx` + `model.ts`;
`type: "module"` and `private` removal for the npm route; OpenTUI peers; and
**no** `build`/`prepare`/`prepack`/`install`/`postinstall`/`preinstall` script or
`workspaces` field (already true today).

Two material caveats, both with official-tracker evidence:

1. Git installs with a `build`/`prepare`-class script fail with
   `git dep preparation failed` in the compiled binary (issue
   [#49704](https://github.com/anomalyco/opencode/issues/49704), still open,
   reproduced on 2.2.5). This repo has no such script, so it is unaffected.
2. **A raw `.tsx` TUI entry loaded from a package (under `node_modules`) can fail
   to load or never repaint** in the packaged CLI: issue
   [#39986](https://github.com/anomalyco/opencode/issues/39986) is still *open*,
   reproduced on 2.2.0 and on `dev` as of 2026-10-28, with workaround reports on
   2.2.5 as recent as 2026-11-07. This repo's `tui.tsx` is exactly that shape.
   Before shipping a GitHub/npm install, either ship a precompiled JS TUI entry
   (no JSX syntax), use the host's `opentui:runtime-module:*` virtual imports, or
   verify carefully on 2.2.6. Keeping the current local-path `cli.json` entry
   avoids this class of problem entirely.

`npm publish` is the alternative: remove `private: true`, pick an available name,
declared `files`/`exports`, then `opencode plugin add <name>`.

---

## 1. Exactly what `opencode plugin add` accepts

### 1.1 Local CLI help (exact output)

```
$ opencode plugin --help
DESCRIPTION
  Manage plugins

USAGE
  opencode plugin <subcommand> [flags]

SUBCOMMANDS
  list      List plugins
  add       Install a plugin and add it to the global configuration
  check     Check package plugins for updates
  update    Update package plugins
  remove    Remove a plugin from global configuration
```

```
$ opencode plugin add --help
DESCRIPTION
  Install a plugin and add it to the global configuration

USAGE
  opencode plugin add [flags] <package>

ARGUMENTS
  package string    npm registry or Git package specifier
```

(`opencode --version` → `opencode v2.2.6`.) The other subcommands take a
"configured package target": `opencode plugin check [flags] [<target>]`,
`opencode plugin update [flags] [<target>]`, `opencode plugin remove <package>`
(`package string    configured package specifier`), `opencode plugin list
[flags]` with `--builtin`.

### 1.2 The official docs

From [opencode.ai/docs/plugins – Manage](https://opencode.ai/docs/plugins/)
(identical at [`/v2/docs/plugins/`](https://opencode.ai/v2/docs/plugins/)):

> "Package installation accepts npm names with versions, tags, or ranges, plus
> npm-compatible Git package specifications. Git repositories can use hosted
> shortcuts, HTTPS, or SSH, including private repositories available through your
> existing Git credentials."

```sh
opencode plugin add @acme/opencode-plugin@latest
opencode plugin add github:acme/opencode-plugin
opencode plugin add git+ssh://git@github.com/acme/opencode-plugin.git#main
opencode plugin add 'github:acme/plugins#main::path:packages/opencode-plugin'
```

> "Branches, tags, complete commit hashes, and npm's `::path:`
> repository-subdirectory selectors are supported. Configure local paths
> directly; tarball and npm alias targets are not accepted by `plugin add`."

### 1.3 The resolver in the shipped binary (authoritative for v2.2.6)

The v2.2.6 binary at `/opt/homebrew/Cellar/opencode-v2/2.2.6/bin/opencode`
embeds the CLI's JavaScript. Its `cli.plugin.add` command is:

```js
var L=yr(wt.commands.plugin.commands.add,d("cli.plugin.add")(function*(e){
  if(!(yield*me(()=>KU(e.package))))
    return yield*m(Error("Plugin target must be an npm registry package or Git package specifier"));
  let r=yield*(yield*rm).add(e.package),a=w(cN(r));
  if(!a)return yield*m(Error(`Plugin package has no server, GUI, or TUI entrypoint: ${e.package}`));
  ...
  process.stdout.write(`TUI plugin "${e.package}" installed and added to ${n.path}${c}`)
}));
function w(e){if(e.server||e.gui)return"server";if(e.tui)return"tui"}
```

and the accept/reject predicate `KU` / `D` uses `npm-package-arg`:

```js
async function KU(p){return await D(p)!==void 0}
async function D(p){
  let{default:w}=await import("/$bunfs/root/chunk-e17bjwq4.js").then((m)=>Et(m.default,1));
  try{
    let h=w(p);
    if(h.type==="git")return{type:"git",...h.name?{name:h.name}:{},slug:Se(p),mutable:!Pe(h.gitCommittish)};
    if(!h.name||!["version","range","tag"].includes(h.type))return;
    return{type:"registry",name:h.name,spec:h.raw===h.name?"latest":h.rawSpec,mutable:h.type!=="version"}
  }catch{return}
}
```

So the gate is: **`npm-package-arg` type `git` → accepted as Git; types `version`,
`range`, or `tag` → accepted as npm registry; anything else → rejected.** The
`D(p)` result also drives the cache key and update/pinning behaviour (§3.4).

### 1.4 Parsed formats (verified with the npm-bundled `npm-package-arg`)

Run locally against the `npm-package-arg` bundled with this machine's npm
(`/opt/homebrew/lib/node_modules/npm/node_modules/npm-package-arg`, npm
11.20.0). Its type names and `gitCommittish` / `gitSubdir` / `hosted` fields are
exactly the ones the binary's `D(p)` gates on (§1.3):

| Specifier | `npa().type` | `plugin add` |
| --- | --- | --- |
| `opencode-acme-plugin` | `range` (rawSpec `*`) | accepted (npm, `latest`) |
| `opencode-acme-plugin@1.2.0` | `version` | accepted (npm, pinned) |
| `@acme/opencode-plugin@latest` | `tag` | accepted (npm) |
| `github:acme/opencode-plugin` | `git` | accepted |
| `acme/opencode-plugin` (bare `owner/repo`) | `git` | accepted |
| `git+https://github.com/acme/opencode-plugin.git` | `git` | accepted |
| `git+https://github.com/acme/opencode-plugin.git#main` | `git` (`gitCommittish: main`) | accepted |
| `git+ssh://git@github.com/acme/opencode-plugin.git#main` | `git` | accepted |
| `git@github.com:acme/opencode-plugin.git` | `git` (normalized to `git+ssh://`) | accepted |
| `git://github.com/acme/opencode-plugin.git` | `git` | accepted |
| `gitlab:…`, `bitbucket:…`, `gist:…` | `git` | accepted |
| `git+file:///tmp/repo` | `git` | accepted (useful for offline testing) |
| `github:acme/plugins#main::path:packages/opencode-plugin` | `git` (`gitSubdir`) | accepted |
| `https://github.com/acme/opencode-plugin.git` (bare https) | `git` | *parses* as git, but use the documented `git+https://` form ([docs quote above](https://opencode.ai/docs/plugins/)) |
| `file:///tmp/plugin`, `./plugin`, `/tmp/plugin` | `directory` | **rejected** |
| `foo.tgz` | `file` | **rejected** (tarball) |
| `npm:foo@1.0.0`, `foo@npm:bar@1.0.0` | `alias` | **rejected** (npm alias) |

The npm docs list the same Git shapes under "Git URLs as Dependencies" and
"GitHub URLs" (`<protocol>` is one of `git`, `git+ssh`, `git+http`, `git+https`,
`git+file`; `user/repo` is a GitHub shortcut; `#<commit-ish>` selects a ref):
[docs.npmjs.com/cli/v12/configuring-npm/package-json](https://docs.npmjs.com/cli/v12/configuring-npm/package-json/).

### 1.5 What is rejected — exact CLI error text

Reproduced locally with an isolated config/cache (`XDG_CONFIG_HOME`,
`XDG_CACHE_HOME`, `XDG_DATA_HOME` pointed at a temp dir, so nothing in
`~/.config/opencode` was touched):

```
$ opencode plugin add /Users/krka/git/opencode-pr-sidebar
Error: Plugin target must be an npm registry package or Git package specifier
    at <anonymous> (/$bunfs/root/chunk-sf117g8p.js:2:1306)
    at cli.plugin.add (/$bunfs/root/chunk-cd0exa2g.js:7:21641)
    at cli.plugin.add (definition) (/$bunfs/root/chunk-sf117g8p.js:2:1220)
exit=1
```

The same error (byte-identical) for `opencode plugin add ./` and
`opencode plugin add file:///Users/krka/git/opencode-pr-sidebar`. The only file
written under the isolated root was `data/opencode/log/opencode.log`.

### 1.6 Config entries are NOT the same as install targets

Local paths and `file://` URLs are perfectly valid **as config entries**, just not
as `plugin add` targets. From
[opencode.ai/v2/docs/cli/plugins](https://opencode.ai/v2/docs/cli/plugins):

```json title="cli.json"
{
  "plugins": [
    "opencode.example",
    "opencode.example@1.0.0",
    "@example/opencode-tui",
    "@example/opencode-tui@1.0.0",
    "./plugins/status",
    "../plugins/status",
    "/home/user/plugins/status",
    "file:///home/user/plugins/status"
  ]
}
```

and from [opencode.ai/docs/plugins – Configure](https://opencode.ai/docs/plugins/):

> "Add published packages, versioned packages, scoped packages, or local plugin
> directories to `opencode.json(c)`." … "Relative paths resolve from the config
> file containing the entry." … "Configured local paths must be directories. A
> path to a single file is skipped."

On this machine, `~/.config/opencode/cli.json` currently contains a local-path
entry (`"./herdr-opencode"`), which is exactly this supported shape: a local
plugin directory referenced directly in `cli.json`. Also note
[opencode.ai/v2/docs/migrate-v1](https://opencode.ai/v2/docs/migrate-v1):
"V2 replaces layered V1 `tui.json(c)` files with one global terminal client
configuration file: `~/.config/opencode/cli.json`."

---

## 2. What a GitHub install must contain

### 2.1 `package.json` shape

From [opencode.ai/v2/docs/build/plugins](https://opencode.ai/v2/docs/build/plugins):

> "Each part is an export of the package. Every part's SDK comes from the one
> `@opencode/plugin` dependency."

```json title="package.json"
{
  "name": "opencode-acme-plugin",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./tui": "./src/tui.tsx",
    "./gui-experimental": "./dist/gui-experimental.cjs",
    "./rpc": "./src/rpc.ts"
  },
  "files": ["src", "dist"],
  "dependencies": { "@opencode/plugin": "latest" }
}
```

> "**TUI** (`./tui`) runs in the terminal UI with `@opencode/plugin/tui`." …
> "A local plugin directory with a `package.json` `name` and `exports` loads its
> parts through them, like the published package. Without them, it uses file
> names at its root: `server` (else `index`), `tui`, and `rpc` with a `.ts`,
> `.tsx`, or `.js` extension".

From [opencode.ai/v2/docs/build/plugins/cli – Publish and load](https://opencode.ai/v2/docs/build/plugins/cli):

> "Expose the TUI plugin through `./tui`; add OpenTUI peers when the plugin
> renders JSX."

```json title="package.json"
{
  "name": "opencode-acme-plugin",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./tui": "./src/tui.tsx"
  },
  "dependencies": { "@opencode/plugin": "latest" },
  "peerDependencies": {
    "@opentui/core": ">=0.6.6",
    "@opentui/solid": ">=0.6.6",
    "solid-js": ">=1.9.0"
  }
}
```

> "Import `@opencode/plugin/tui` directly. OpenCode resolves this import at
> runtime, so local TUI plugins do not need an absolute path to an OpenCode
> checkout." … "Export `./tui` beside a server part or GUI part for automatic
> loading." … "Configure a TUI-only package in `cli.json` so it remains active
> against remote servers."

`exports["./tui"]` is not optional for a named package: the v2.2.6 binary's
entrypoint detector `cN` resolves the TUI part as the package subpath
`<name>/tui` only:

```js
function cN(e){
  ...
  o=(a)=>{for(let d of a){
    let m=t.name?[t.name,d].filter(Boolean).join("/"):c.resolve(t.directory,d||"index");
    try{return KE(m,t.directory)}catch(s){ ... }
  }return};
  return{server:o(["server",""]),tui:o(["tui"]),rpc:o(["rpc"]),gui: ...}
}
```
and the CLI aborts with ``Plugin package has no server, GUI, or TUI entrypoint:
<spec>`` when none resolve (quoted in §1.3). If `exports` exists but has no
`"./tui"` key, subpath resolution throws `ERR_PACKAGE_PATH_NOT_EXPORTED` and the
package is rejected — the historical spec says the same: "If package `exports`
exists, loader only resolves `./tui` or `./server`; it never falls back to
`exports["."]`" ([historical spec, §"Author package shape"](https://raw.githubusercontent.com/anomalyco/opencode/7feefb697f279fe08677512f08abf72a9f418d5a/packages/opencode/specs/tui-plugins.md) — see the version note in §2.3).

`files` matters because npm packs Git clones: from
[npm's package.json docs](https://docs.npmjs.com/cli/v12/configuring-npm/package-json/):

> "The optional `files` field is an array of file patterns that describes the
> entries to be included when your package is installed as a dependency. …
> Omitting the field will make it default to `[\"*\"]`" … "Certain files are
> always included, regardless of settings: `package.json`, `README`, `LICENSE /
> LICENCE`, The file in the `\"main\"` field, The file(s) in the `\"bin\"` field."
> … "If there is a `.gitignore` file, and `.npmignore` is missing, `.gitignore`'s
> contents will be used instead."

Verified locally with `npm pack --dry-run --json` (npm 11.20.0): with **no**
`files` field, a package containing `tui.tsx` + `model.ts` packs
`['model.ts', 'package.json', 'tui.tsx']` (the `["*"]` default). But once you
add a `files` field — recommended, to keep the tarball small and avoid
`.gitignore` surprises — only what you list is packed: `files: ["tui.tsx"]`
packed `['package.json', 'tui.tsx']` and dropped `model.ts`, which would break
`import … from "./model.ts"`. `exports` targets are **not** in npm's
always-included list, so if you use `files`, list **both** `tui.tsx` and
`model.ts` explicitly. This repo's `.gitignore` (`node_modules/`, `.DS_Store`,
`.tmp-render/`) does not exclude them.

`name` + `version`: npm's docs say "If you plan to publish your package, the
most important things in your `package.json` are the `name` and `version` fields
as they will be required" ([same npm docs](https://docs.npmjs.com/cli/v12/configuring-npm/package-json/)). For Git installs the v2.2.6 installer also reads the
cloned `package.json` to determine the installed package name (its `W` helper
falls back to the first `dependencies` key when no name is present), so declare
both.

### 2.2 Does OpenCode run npm install / a build itself, and where does it cache?

**Yes, OpenCode runs its own npm install; no, it does not run your build
scripts.** From the v2.2.6 binary, the `@opencode/Npm` service uses the real
`@npmcli/arborist`:

```js
ce=(e)=>n(function*(){
  let{Arborist:s}=yield*me(()=>import("/$bunfs/root/chunk-209bq6v.js")...);
  let o=e.add??[],
      c={...yield*X(e.config??e.dir), ...e.update?{preferOnline:!0,noGitRevCache:!0}:{}, audit:!1, windowsHide:!0},
      u=new s({...c,path:e.dir,binLinks:!0,progress:!1,savePrefix:"",ignoreScripts:!0});
  return yield*ke({try:()=>u.reify({...c,add:o,update:e.update,save:!0,saveType:"prod"}), ...})
}).pipe(oo("Npm.reify",{attributes:e}))
```

Note `ignoreScripts: true` and `saveType: "prod"`: lifecycle scripts are skipped
and only production dependencies are installed — **`devDependencies` of the
installed package are not installed**. Issue
[#49704](https://github.com/anomalyco/opencode/issues/49704) confirms the
mechanism: "`opencode plugin add` installs git specifiers through npm's real
`@npmcli/arborist` (`packages/core/src/npm.ts`, `Npm.reify` →
`arborist.reify()`), not Bun's own installer. Arborist's git fetching goes through
`pacote`'s `GitFetcher`."

The cache root is `~/.cache/opencode`. Local `opencode debug paths` output:

```
home       /Users/krka
data       /Users/krka/.local/share/opencode
cache      /Users/krka/.cache/opencode
config     /Users/krka/.config/opencode
state      /Users/krka/.local/state/opencode
tmp        /private/var/folders/gv/glry79z560l4hqlfbgzqwqmr0000gr/T/opencode
```

and the binary builds the per-spec directory as `join(cache, "npm", be(spec))`:

```js
P=(e,s)=>g.join(w.cache,"npm",be(e,s))
function be(p,w){
  if(w?.type==="git")return`git-${w.slug}-${ve("sha256").update(p).digest("hex").slice(0,12)}`;
  if(w?.type==="registry")return re(`${w.name}@${w.spec}`);
  return re(p)
}
```

with numeric (timestamp) subdirectories selected by `L(e)` / `U(e)`:
`L(e)` reads "directories whose names match `/^\d+$/`, sorted numerically" and
`U(e)` takes the last. So the layout is
`~/.cache/opencode/npm/git-<slug>-<12-hex>/<timestamp>/node_modules/<name>/` for
Git specs and `~/.cache/opencode/npm/<name>@<spec>/<timestamp>/…` for registry
specs. The binary's `K` helper reads `package-lock.json` /
`node_modules/.package-lock.json` to recover the resolved Git revision for
`plugin list` / `plugin check`.

Because `ignoreScripts: true` and no build is run, **ship source that the host can
load directly, or commit pre-built output**. The official
[build/plugins – Publish](https://opencode.ai/v2/docs/build/plugins) guidance says:
"Build the GUI bundle before you publish, and include it through `files`" (GUI
parts specifically); for TUI parts the docs' own example points `./tui` straight
at `./src/tui.tsx`.

### 2.3 `engines.opencode`

The historical in-repo spec `packages/opencode/specs/tui-plugins.md` documents it
under "Version compatibility":

> "npm plugins can declare a version compatibility range in `package.json` using
> the standard `engines` field: `{ \"engines\": { \"opencode\": \"^1.0.0\" } }`.
> The value is a semver range checked against the running OpenCode version. If
> the range is not satisfied, the plugin is skipped with a warning and a session
> error. If `engines.opencode` is absent, no check is performed (backward
> compatible). File plugins are never checked; only npm package plugins are
> validated."

Official issue [#43094](https://github.com/anomalyco/opencode/issues/43094) quotes
the loader (`packages/opencode/src/plugin/shared.ts:194-205`):

```ts
const range = engines.opencode
if (typeof range !== "string") return
if (!semver.satisfies(opencodeVersion, range)) {
  throw new Error(`Plugin requires opencode ${range} but running ${opencodeVersion}`)
}
```

**Caveat, important for v2.2.6:** that spec is **historical**, not current. It
lives at commit
[`7feefb697f279fe08677512f08abf72a9f418d5a`](https://raw.githubusercontent.com/anomalyco/opencode/7feefb697f279fe08677512f08abf72a9f418d5a/packages/opencode/specs/tui-plugins.md)
(2026-07-09); it was deleted by commit `44b6938b2ad2895bdd89d5d5cf753fb01ca8e3dd`
("removed packages/opencode", 2026-07-21), and the current `dev` tree has no
`packages/opencode/specs/` at all (verified via
`https://api.github.com/repos/anomalyco/opencode/git/trees/dev?recursive=1`).
It is a **V1-era** document: it describes `tui.json`, `@opencode-ai/plugin/tui`,
a `tui(api)` callback, `oc-themes`, `opencode plug`, and says "There is no
uninstall, list, or update CLI command for external plugins" — all contradicted
by the current V2 docs. Its `exports["./tui"]` / `engines.opencode` /
version-suffix notes are still informative, but the API sections are obsolete.
It was pointed to as authoritative by maintainer `kommander` in
[issue #28902](https://github.com/anomalyco/opencode/issues/28902) (2026-05-22):
"Check https://github.com/anomalyco/opencode/blob/dev/packages/opencode/specs/tui-plugins.md … the new TUI plugin API is not officially documented yet".

Current V2 docs ([`/build/plugins`](https://opencode.ai/v2/docs/build/plugins),
[`/build/plugins/cli`](https://opencode.ai/v2/docs/build/plugins/cli),
[`/docs/plugins`](https://opencode.ai/docs/plugins/)) do **not** mention
`engines.opencode`, and the compiled v2.2.6 binary contains no `engines.opencode`
string and no `Plugin requires opencode` error text (searched all occurrences of
`engines` in the 231 MB binary). Treat it as **optional/advisory metadata** on
v2; do not rely on it as a hard compatibility gate. It is harmless to declare
`"engines": { "opencode": ">=2.2.6" }`.

### 2.4 TUI-only plugins and `cli.json`

From [opencode.ai/v2/docs/build/plugins – Load](https://opencode.ai/v2/docs/build/plugins):

> "A package with only a TUI part goes in [`cli.json`](/cli/plugins) instead."

From [opencode.ai/docs/plugins – Terminal](https://opencode.ai/docs/plugins/):

> "TUI-only plugins are configured separately and remain active when connected to
> a remote server." `cli.json`: `{ "plugins": ["opencode-acme-cli"] }`

And [opencode.ai/v2/docs/cli/plugins](https://opencode.ai/v2/docs/cli/plugins)
adds the complementary rule:

> "Plugins configured in `opencode.json(c)` that expose a TUI component are
> loaded automatically by the CLI. … You do not need to add the same package to
> `cli.json`. The CLI gets the active plugin list from the connected OpenCode
> server … Use `cli.json` for CLI-only plugins. These plugins run locally in the
> terminal and remain active when the CLI connects to a remote server."

**`plugin add` handles the wiring for you.** The CLI's `w()` classifier
(`function w(e){if(e.server||e.gui)return"server";if(e.tui)return"tui"}`) sends
TUI-only packages to the CLI config service, whose file is
`join(config, "cli.json")`:

```js
let a=ae.join(o.config,"cli.json")
```

and prints `TUI plugin "<spec>" installed and added to <cli.json path>`. So for
this repo, after `opencode plugin add github:karczews/opencode-pr-sidebar`, the
spec lands in `~/.config/opencode/cli.json` automatically — no manual edit.

---

## 3. Gotchas

### 3.1 npm 12 `allow-git=none` — real, but not the situation on this host

Official npm config docs (v12.2.2),
[docs.npmjs.com/cli/v12/using-npm/config/#allow-git](https://docs.npmjs.com/cli/v12/using-npm/config/):

> "**allow-git** — Default: `\"none\"` … **As of npm 12 the default is none.**
> Git dependencies run git against a remote repo and may install configuration
> the project does not control. Opt in explicitly per project (in `.npmrc`) or
> per command (on the CLI) when you need git deps. `all` allows any git
> dependencies to be fetched and installed. `none` prevents any git dependencies
> from being fetched and installed."

So `npm config set allow-git all` (or `allow-git=all` in `.npmrc` /
`--allow-git=all`) is the documented opt-in if you hit `EALLOWGIT`.

**But this host is not npm 12**: `npm --version` → `11.20.0`, and
`npm config get allow-git` → `all`. More importantly, `opencode plugin add` does
not shell out to the system `npm` CLI — it uses the npm bundled inside the
compiled binary (§2.2, [#49704](https://github.com/anomalyco/opencode/issues/49704)),
whose config definitions set:

```js
"allow-git":new i("allow-git",{default:"all",type:["all","none","root"],description:"\n  Limits the ability for npm to fetch dependencies from git references. ..."})
```

Therefore the npm-12 default does **not** block `opencode plugin add` on this
machine. It matters only if you (or a future host) install Git dependencies with
the system npm directly. Verify with `npm --version` and `npm config get
allow-git` before applying the workaround.

### 3.2 Git credentials for private repos — and `gh` is a runtime concern, not an install one

The [plugins docs](https://opencode.ai/docs/plugins/) say private repos work
"including private repositories available through your existing Git credentials"
— i.e. `git`'s SSH keys / credential helper, not the `gh` CLI. `github:owner/repo`
normalizes to `https://github.com/owner/repo.git` (HTTPS) or
`ssh://git@…/owner/repo.git` (SSH) depending on the form used (verified with
`npm-package-arg`, §1.4); `git+ssh://git@github.com/…` uses your SSH key. This
repo is public (`"private": false, "visibility": "public"` per
`https://api.github.com/repos/karczews/opencode-pr-sidebar`), so no auth is
needed to install it. `gh` (`2.103.3`, authed as `karczews`) is needed **at
runtime** by `model.ts`, which shells out to `gh pr view` / `gh api graphql` —
that is unrelated to `plugin add`.

### 3.3 `build` / `prepare` scripts break Git installs (`git dep preparation failed`)

Official npm docs explain the trigger
([package.json docs, "Git URLs as Dependencies"](https://docs.npmjs.com/cli/v12/configuring-npm/package-json/)):

> "When installing from a git repository, the presence of certain fields in the
> `package.json` will cause npm to believe it needs to perform a build. … This
> flow will occur if your git dependency uses `workspaces`, or if any of the
> following scripts are present: `build`, `prepare`, `prepack`, `preinstall`,
> `install`, `postinstall`. If your git repository includes pre-built artifacts,
> you will likely want to make sure that none of the above scripts are defined."

Official issue [#49704](https://github.com/anomalyco/opencode/issues/49704)
(root cause, still **open**, reproduced on 2.2.5 on 2026-11-06):

> "`opencode plugin add`/`plugins` fails with `NpmInstallFailedError: git dep
> preparation failed` for **any** git dependency whose `package.json` has a
> `build`, `prepare`, `preinstall`, `install`, `postinstall`, or `prepack` script,
> or a `workspaces` field … the compiled `opencode` binary re-invokes itself as
> the 'npm' binary for pacote's git-dependency prepare step, but its own CLI
> doesn't know how to run that".

> "**Workaround** … avoid `build`/`prepare`/`preinstall`/`install`/`postinstall`/
> `prepack` script names (rename them) and avoid `workspaces` in the installed
> package's `package.json`, and ship any build output pre-built/committed
> instead."

Issue [#55073](https://github.com/anomalyco/opencode/issues/55073) (closed as
duplicate) has the exact failure and the confirmed fix:

```
NpmInstallFailedError:
    at Npm.reify ...
  [cause]: Error: git dep preparation failed
```
> "Workaround confirmed — renaming the `build` script to `build:dist` fixed the
> Git install on 2.0.28."

**This repo is safe today**: its `scripts` are `fmt`, `fmt-check`, `lint`,
`typecheck`, `test`, `test:render`, `check`, `test:register` — no trigger names,
and no `workspaces`. Do not add a `build`/`prepare` script to `package.json`
without also committing built output.

### 3.4 Version suffixes, pinning and refresh behaviour

From [opencode.ai/docs/plugins – Manage/Reload](https://opencode.ai/docs/plugins/):

> "`plugin check` checks server, GUI-only, and TUI-only package plugins for
> updates. `plugin update` updates every outdated package; pass a configured
> package target to check or update only that package. Local plugins and exact
> package revisions are skipped."

> "Server startup loads cached package plugins immediately, installs missing
> packages in the background, and checks unpinned npm and Git plugins for updates
> **without changing the installed package**. Exact npm versions and full Git
> commit hashes stay pinned."

The v2.2.6 binary implements exactly that. `D(p)` (§1.3) sets
`mutable: h.type !== "version"` for registry specs and
`mutable: !Pe(h.gitCommittish)` for Git specs, with:

```js
function oe(p){return p?.match(/#([a-f0-9]{40}|[a-f0-9]{64})(?=::|$)/i)?.[1]}
function Pe(p){return/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(p??"")}
```

i.e. a full 40/64-hex commit hash pins a Git spec; a branch, tag or no `#ref`
stays mutable. The cache key `be()` hashes the **entire spec string** for Git
targets (`git-<slug>-<sha256(spec)[:12]>`), so
`github:owner/repo#v1.0.0` and `github:owner/repo#main` occupy different cache
directories; changing the `#ref` is a reliable way to force a fresh fetch. The
historical spec (§2.3) states the npm side: "Explicit npm specs with a version
suffix (for example `pkg@1.2.3`) are pinned. Runtime install requests that exact
version and does not run stale/latest checks for newer registry versions. Bare
npm specs (`pkg`) are treated as `latest` and can refresh when the cached version
is stale."

Practical consequence for a GitHub-distributed plugin: pin a tag
(`github:karczews/opencode-pr-sidebar#v0.1.0`) and bump the tag to release, or
use `opencode plugin update`. Note [#49704](https://github.com/anomalyco/opencode/issues/49704)
also reports the `git dep preparation failed` path on `plugin update`.

### 3.5 Raw `.tsx` loaded from `node_modules` — the biggest risk for this repo

`opencode plugin add` installs packages under
`~/.cache/opencode/npm/…/node_modules/<name>/` (§2.2). Open issue
[#39986](https://github.com/anomalyco/opencode/issues/39986) ("tui: support
reactive external TSX plugins in packaged CLI", opened 2026-08-01, still
**open**, label `reproduced`):

> "The packaged Bun CLI does not reliably apply OpenTUI's runtime Solid transform
> to external TUI plugin TSX. A plugin can either fail while resolving
> `react/jsx-dev-runtime` or load project-local `solid-js` / `@opentui/solid`
> copies. The latter renders its initial frame, but signal updates do not
> repaint because the plugin and host use separate reactive graphs."

> "**Rejected approach** … OpenTUI's transform excludes JSX under `node_modules`,
> so npm TSX could still fail."

Maintainer-bot reproduction on 2026-10-28 (issue
[#39986](https://github.com/anomalyco/opencode/issues/39986)):

> "I reproduced this on `@opencode/cli@2.2.0` (packaged binary, latest release),
> and it still happens on the latest `dev` … **Plugins in
> `.opencode/plugins/<name>/` work.** … **The same two plugins fail when loaded
> as packages under `.opencode/node_modules/…`. That is how npm/github-installed
> plugins are laid out. Both fail with: `Cannot find package 'react' imported from
> …/tui.tsx`**."

Also on that issue, user `rizal72` (2026-10-25) reports the failure on 2.1.4 with
"exactly [the] `build/plugins/cli` → 'Publish and load' [shape]" — i.e. the
documented `exports: { "./tui": "./tui.tsx" }` + peers shape. Workarounds
shipped in production (issue comments, 2026-10-25 and 2026-11-07, on 2.1.4 /
2.2.5):

- Precompile the entry with `babel-preset-solid` (`moduleName: "@opentui/solid"`,
  `generate: "universal"`) and point `exports["./tui"]` at a `.js` file with no
  JSX syntax — "the host resolves `@opentui/solid`, `solid-js` and
  `@opencode/plugin/tui` from its own registry".
- Or avoid JSX entirely: a `.ts` entry that imports host singletons via virtual
  ids and builds the tree with explicit `jsx()` / `jsxs()` getters:
  `opentui:runtime-module:solid-js`,
  `opentui:runtime-module:%40opencode%2Fplugin%2Ftui`,
  `opentui:runtime-module:%40opentui%2Fsolid%2Fjsx-runtime`; keep
  `@opentui/*` / `solid-js` as optional peers.

The v2.2.6 binary does contain the host-side bridge
(`var Cd="opentui:runtime-module:"` and
`RA={nodeModulesRuntimeSpecifiers:!0,nodeModulesBareSpecifiers:!1}`), which is
why bare specifiers get rewritten even under `node_modules`; but the
transform-generated JSX-runtime import is the part that is not bridged. The
OpenTUI-side fix is still an open PR
([anomalyco/opentui#1741](https://github.com/anomalyco/opentui/pull/1741), linked
from the issue on 2026-10-22). **Treat a plain `./tui.tsx` GitHub/npm install as
unverified on 2.2.6.** This repo's current local-path config lives outside
`node_modules`, which is the layout that the same issue says works.

Related: [#33884](https://github.com/anomalyco/opencode/issues/33884) documents
the same `node_modules` isolation with v2 data points (2.0.3, 2.0.27, 2.1.2) —
e.g. "Install: `opencode plugin add github:zemadeiran/opencode-file-tree-v2` …
error=\"Cannot find package 'react' imported from …/tui.tsx\"".

### 3.6 `private: true`, `files`, and other packaging details

[npm package.json docs](https://docs.npmjs.com/cli/v12/configuring-npm/package-json/):

> "**private** — If you set `\"private\": true` in your `package.json`, then npm
> will refuse to publish it."

This repo has `"private": true` (line 4 of `package.json`) — it **blocks
`npm publish`**, but does not block a Git install (npm's `pack` from a clone is
not `publish`). Remove it for the npm route; for the GitHub-only route it can
stay, though removing it is harmless.

> "**peerDependencies** … As of npm v7, `peerDependencies` are installed by
> default." … "**engines** … Unless the user has set the `engine-strict` config
> flag, this field is advisory only and will only produce warnings when your
> package is installed as a dependency."

npm auto-installs both `dependencies` and (since v7) `peerDependencies`, so
either shape can nest a copy of the host's runtime packages inside the plugin
tree — the failure documented in
[#33884](https://github.com/anomalyco/opencode/issues/33884) and
[#39986](https://github.com/anomalyco/opencode/issues/39986). Follow the docs
(`peerDependencies`) and, if the §3.5 workarounds apply, mark them
`peerDependenciesMeta.optional` so no shadow copies are installed at all; keep
the exact pins in `devDependencies` for `npm run check` locally. Avoid plain
`dependencies` for the host-provided OpenTUI/solid packages. `@opencode/client`,
`@opencode/theme`, `@opentui/core` are not imported at runtime by this repo's
source (only `@opencode/plugin/tui`, `solid-js`, `node:child_process`, and the
relative `./model.ts`), so they can remain dev-only unless the compiled entry
needs them.

---

## 4. npm publishing alternative

Official [build/plugins – Publish](https://opencode.ai/v2/docs/build/plugins):

> "A published plugin is an npm package with the `package.json` above. Its parts
> use the same default exports as a local plugin. `npm publish`."

> "Use versions compatible with the OpenCode release you target, and test the
> installed package, not only a workspace-linked copy."

Minimal steps:

1. Remove `"private": true`. Pick an available npm name (the current `pr-sidebar`
   is generic; a scoped name such as `@karczews/opencode-pr-sidebar` is safer) and
   bump `version`. npm requires `name` + `version` to publish
   ([npm docs](https://docs.npmjs.com/cli/v12/configuring-npm/package-json/)).
2. Add `exports: { "./tui": "./tui.tsx" }` (or the precompiled `.js` entry, §3.5),
   keep `"type": "module"`, and add `files: ["tui.tsx", "model.ts", "README.md",
   "LICENSE"]` — `exports` targets are not auto-included by npm's packlist
   (§2.1).
3. Add `dependencies: { "@opencode/plugin": "latest" }` and
   `peerDependencies: { "@opentui/core": ">=0.6.6", "@opentui/solid": ">=0.6.6",
   "solid-js": ">=1.9.0" }` ([build/plugins/cli – Publish and load](https://opencode.ai/v2/docs/build/plugins/cli)). Keep toolchain packages
   (biome, typescript, `@types/node`, `@opencode/client`, `@opencode/theme`) in
   `devDependencies` — they are not installed for consumers (§2.2).
4. Optionally add `repository`, `license`, `keywords`, and
   `"engines": { "opencode": ">=2.2.6" }` (advisory, §2.3). Keep the no-trigger
   scripts rule (§3.3).
5. `npm publish` (scoped names need `--access=public` on first publish), then
   `opencode plugin add <name>` or `opencode plugin add <name>@<version>`.
   For a TUI-only package the CLI writes the spec to `cli.json` (§2.4).

Trade-off vs GitHub: versions, `plugin check`/`plugin update`, dist-tags and
semver ranges work as designed, and consumers need no `git` remote access; but you
need an npm account, a unique name, and a publish step per release. Both routes
share the §3.5 `node_modules` rendering risk, because both install into the same
npm cache tree.

---

## 5. Concrete recommendation for this repo

> **Status (2026-11-08): applied.** `package.json` is now
> `opencode-pr-sidebar@0.1.0` with `exports["./tui"]`, `files`, runtime
> `dependencies`, optional peers, and advisory `engines.opencode`; the packlist
> contains `tui.tsx`, `model.ts`, `README.md`, `LICENSE`. The remaining work is
> verifying the packaged install against the raw-TSX risk in §3.5.

Original state before the change (from `package.json`, `tui.tsx`, `model.ts`,
`.gitignore`):

- `"name": "pr-sidebar"`, `"version": "0.0.0"`, `"private": true`,
  `"type": "module"`, 8 scripts, **no `exports`, no `files`, no
  `dependencies`/`peerDependencies`, no `engines`**.
- `tui.tsx` = `/** @jsxImportSource @opentui/solid */`, imports
  `@opencode/plugin/tui`, `solid-js`, and `./model.ts`; default-exports
  `Plugin.define({ id: "pr-sidebar", setup })`.
- `model.ts` imports only `node:child_process`.
- All SDK packages were `devDependencies` pinned to `2.2.6` / `0.8.3` / `1.9.9`.

### 5.1 The `package.json` changes for `opencode plugin add github:karczews/opencode-pr-sidebar`

```json
{
  "name": "opencode-pr-sidebar",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "description": "Current-branch GitHub PR card for the OpenCode TUI sidebar",
  "exports": {
    "./tui": "./tui.tsx"
  },
  "files": ["tui.tsx", "model.ts", "README.md", "LICENSE"],
  "repository": { "type": "git", "url": "git+https://github.com/karczews/opencode-pr-sidebar.git" },
  "license": "MIT",
  "engines": { "opencode": ">=2.2.6" },
  "scripts": { /* unchanged: fmt, fmt-check, lint, typecheck, test, test:render, check, test:register */ },
  "dependencies": { "@opencode/plugin": "latest" },
  "peerDependencies": {
    "@opentui/core": ">=0.6.6",
    "@opentui/solid": ">=0.6.6",
    "solid-js": ">=1.9.0"
  },
  "devDependencies": { /* unchanged */ }
}
```

Notes on each field, all cited above:

- `name` (`pr-sidebar` is npm-legal but generic; prefer a descriptive/scoped
  name that is available on the registry) + `version` are needed for the
  installer's name resolution and for npm publish (§2.1).
- `exports["./tui"]` is **required** — without it `plugin add` fails with
  `Plugin package has no server, GUI, or TUI entrypoint: <spec>` (§1.3, §2.1).
- `files` must list `tui.tsx` **and** `model.ts` because `./model.ts` is a
  relative import and `exports` targets are not auto-packed (§2.1).
- `type: "module"` — already present; docs' publish examples use it (§2.1).
- `dependencies`/`peerDependencies` — `devDependencies` are not installed for
  the packaged copy (§2.2); use peers for OpenTUI/solid to avoid shadow copies
  (§3.6).
- `engines.opencode` — optional/advisory in v2 (§2.3).
- **Keep all existing script names**; do not introduce `build`/`prepare`/etc.
  (§3.3). `npm run check` stays a local-only convenience.
- `private: false` is only strictly needed for npm publish, but makes the
  manifest valid for both routes (§3.6).

No new source files are strictly needed: `tui.tsx` already exports the V2
`Plugin.define` shape that the docs require
([build/plugins/cli](https://opencode.ai/v2/docs/build/plugins/cli)). Commit and
push the manifest changes first — `plugin add github:…` fetches from the remote;
local uncommitted edits are invisible to it. Remote is public and `main` is at
`8c30d99`, matching local HEAD (verified above), so
`github:karczews/opencode-pr-sidebar` is a valid target today.

### 5.2 Option A — GitHub install (no npm account)

```sh
# after committing + pushing the manifest changes
opencode plugin add 'github:karczews/opencode-pr-sidebar#v0.1.0'
# or unpinned (mutable):
opencode plugin add github:karczews/opencode-pr-sidebar
```

`plugin add` will install into
`~/.cache/opencode/npm/git-opencode-pr-sidebar-<12-hex>/<timestamp>/node_modules/…`
and append the spec to `~/.config/opencode/cli.json` (§2.2, §2.4). To release a
new version, move the tag, or `opencode plugin remove …` then `plugin add …`
with a new `#ref` (§3.4). This is the lowest-friction path and needs no registry
account — but see §5.4.

### 5.3 Option B — npm publish

Same manifest as §5.1 (with `private` removed), then:

```sh
npm publish --access=public     # scoped name, first publish
opencode plugin add @karczews/opencode-pr-sidebar
```

Gives `plugin check` / `plugin update`, semver ranges and dist-tags as described
in [docs/plugins – Manage](https://opencode.ai/docs/plugins/). Costs: an npm
account, a unique name, and a publish per release. Test the installed package,
not the workspace copy ([build/plugins – Publish](https://opencode.ai/v2/docs/build/plugins)).

### 5.4 Trade-offs and the recommended sequencing

| | GitHub (`github:…`) | npm publish |
| --- | --- | --- |
| npm account / unique name | not needed | required |
| `plugin check` / `update` | supported but unpinned Git specs are mutable; pin a tag or full SHA (§3.4) | first-class, semver ranges / tags |
| Release mechanism | push commit / move tag | `npm publish` per version |
| Private-repo installs | works with existing Git credentials (§3.2) | needs registry access control |
| `private: true` | harmless (does not block a Git install) (§3.6) | **blocks publish** (§3.6) |
| Build scripts | must avoid `build`/`prepare`/… (§3.3) | same |
| Raw `.tsx` under `node_modules` | **at risk** (§3.5) | **at risk** (same cache layout) |

**Recommendation:** the §5.1 manifest work is done; test the GitHub spec next
(it needs no account and the repo is already public), but **do not assume the
current raw `tui.tsx` renders once installed** — issue
[#39986](https://github.com/anomalyco/opencode/issues/39986) is open and was
reproduced on 2.2.0 with workaround reports on 2.2.5, one day before this
machine's 2.2.6. Validate in a live TUI with `opencode plugin add
'git+file:///path/to/local/clone'` (accepted Git spec, §1.4) using an isolated
`XDG_*` config so `cli.json` is untouched. If the card fails to load or freezes,
ship a precompiled `.js` TUI entry (no JSX syntax) or the virtual
`opentui:runtime-module:*` shape from §3.5, and point `exports["./tui"]` at it —
then the same package works for both GitHub and npm installs. Until that is
verified, **keeping the existing local-path `cli.json` entry is the reliable
option**: local paths are documented config entries (§1.6) and correspond to the
layout that issue [#39986](https://github.com/anomalyco/opencode/issues/39986)
says works.

---

## Appendix: exact local command output used above

```
$ opencode --version
opencode v2.2.6

$ node --version
v26.13.0

$ npm --version
11.20.0

$ npm config get allow-git
all

$ gh --version
gh version 2.103.3 (2026-10-26)
https://github.com/cli/cli/releases/tag/v2.103.3

$ git remote -v
origin	git@github.com:karczews/opencode-pr-sidebar.git (fetch)
origin	git@github.com:karczews/opencode-pr-sidebar.git (push)

$ opencode debug paths
home       /Users/krka
data       /Users/krka/.local/share/opencode
cache      /Users/krka/.cache/opencode
config     /Users/krka/.config/opencode
state      /Users/krka/.local/state/opencode
...
```

Reproduction of the rejection (isolated `XDG_*` config/cache; no changes to
`~/.config/opencode`):

```
$ opencode plugin add /Users/krka/git/opencode-pr-sidebar
Error: Plugin target must be an npm registry package or Git package specifier
    at <anonymous> (/$bunfs/root/chunk-sf117g8p.js:2:1306)
    at cli.plugin.add (/$bunfs/root/chunk-cd0exa2g.js:7:21641)
    at cli.plugin.add (definition) (/$bunfs/root/chunk-sf117g8p.js:2:1220)
exit=1
```

(identical output for `./` and `file:///Users/krka/git/opencode-pr-sidebar`).

## Sources

All primary. Local sources were read from this machine on 2026-11-08; the compiled
binary is `/opt/homebrew/Cellar/opencode-v2/2.2.6/bin/opencode` (`opencode
v2.2.6`), and its embedded JS chunks are quoted verbatim from byte-offset
extractions.

- **D1** <https://opencode.ai/docs/plugins/> (and identical
  <https://opencode.ai/v2/docs/plugins/>) — Configure / Manage / Reload / Terminal.
- **D2** <https://opencode.ai/v2/docs/build/plugins> — Overview: Parts, Load,
  Publish.
- **D3** <https://opencode.ai/v2/docs/build/plugins/cli> — TUI: "Publish and
  load" package shape, peers, runtime resolution.
- **D4** <https://opencode.ai/v2/docs/cli/plugins> — `cli.json` entries,
  discovery paths, TUI auto-loading.
- **D5** <https://opencode.ai/v2/docs/migrate-v1> — `cli.json` path, V1→V2
  plugin config.
- **G1** `anomalyco/opencode` historical spec
  <https://raw.githubusercontent.com/anomalyco/opencode/7feefb697f279fe08677512f08abf72a9f418d5a/packages/opencode/specs/tui-plugins.md>
  (last revision before deletion; commit list
  <https://api.github.com/repos/anomalyco/opencode/commits?path=packages/opencode/specs/tui-plugins.md&per_page=5>).
  **V1-era, superseded** — see §2.3.
- **G2** <https://github.com/anomalyco/opencode/issues/28902> — maintainer
  reference to that spec (2026-05-22).
- **G3** <https://github.com/anomalyco/opencode/issues/49704> —
  `git dep preparation failed` root cause / workaround (open, reproduced 2.2.5).
- **G4** <https://github.com/anomalyco/opencode/issues/55073> — duplicate with
  exact error and confirmed `build:dist` workaround.
- **G5** <https://github.com/anomalyco/opencode/issues/43094> —
  `engines.opencode` loader source quote.
- **G6** <https://github.com/anomalyco/opencode/issues/39986> — reactive external
  TSX / `node_modules` issue (open, reproduced 2.2.0 / `dev`, workarounds on
  2.1.4–2.2.5).
- **G7** <https://github.com/anomalyco/opencode/issues/33884> — `node_modules`
  isolation, v2 data points (2.0.3 / 2.0.27 / 2.1.2).
- **G8** GitHub REST: <https://api.github.com/repos/anomalyco/opencode> (default
  branch `dev`),
  <https://api.github.com/repos/anomalyco/opencode/git/trees/dev?recursive=1>
  (no current `packages/opencode/specs/`),
  <https://api.github.com/repos/karczews/opencode-pr-sidebar> (public, `main`).
- **N1** <https://docs.npmjs.com/cli/v12/using-npm/config/> — `allow-git`
  default `none` as of npm 12; config precedence.
- **N2** <https://docs.npmjs.com/cli/v12/configuring-npm/package-json/> —
  `name`/`version`, `files`, `exports`, `type`, `private`, `peerDependencies`,
  `engines`, Git URLs as Dependencies, GitHub URLs, Local Paths.
- **L1** Local CLI: `opencode --version`, `opencode plugin --help`,
  `opencode plugin add --help`, `opencode plugin {list,check,update,remove}
  --help`, `opencode plugin add …` (isolated `XDG_*`), `opencode debug paths`.
- **L2** Local binary strings: `cli.plugin.add`, `KU`/`D`, `be`/`P`, `Pe`/`oe`,
  `Npm.reify` (`@npmcli/arborist`), `cN`, `my` (`cli.json` path), bundled npm
  `allow-git` definition, `opentui:runtime-module:` bridge.
- **L3** Local `npm-package-arg` parse table (§1.4), from
  `/opt/homebrew/lib/node_modules/npm/node_modules/npm-package-arg` with npm
  11.20.0.
- **L4** This repo: `package.json`, `.gitignore`, `tui.tsx`, `model.ts`,
  `git remote -v`, `git log -1`, `git ls-remote origin HEAD`,
  `~/.config/opencode/cli.json`, `~/.config/opencode/opencode.jsonc`.
