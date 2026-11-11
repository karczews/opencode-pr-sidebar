import { createComponent as _$createComponent } from "opentui:runtime-module:%40opentui%2Fsolid";
import { memo as _$memo } from "opentui:runtime-module:%40opentui%2Fsolid";
import { createTextNode as _$createTextNode } from "opentui:runtime-module:%40opentui%2Fsolid";
import { effect as _$effect } from "opentui:runtime-module:%40opentui%2Fsolid";
import { insertNode as _$insertNode } from "opentui:runtime-module:%40opentui%2Fsolid";
import { insert as _$insert } from "opentui:runtime-module:%40opentui%2Fsolid";
import { setProp as _$setProp } from "opentui:runtime-module:%40opentui%2Fsolid";
import { createElement as _$createElement } from "opentui:runtime-module:%40opentui%2Fsolid";
/** @jsxImportSource @opentui/solid */
import { Plugin } from "opentui:runtime-module:%40opencode%2Fplugin%2Ftui";
import { createMemo, createSignal, onCleanup, onMount, Show } from "opentui:runtime-module:solid-js";
import { ageOf, clean, copyToClipboard, createMonitor, openBrowser, summarize } from "./model.js";
const POLL_MS = 5000;
export default Plugin.define({
  id: "pr-sidebar",
  setup(context) {
    const [state, setState] = createSignal({
      pr: null,
      error: "",
      fetchedAt: 0,
      now: Date.now(),
      loading: false
    });
    const [expanded, setExpanded] = createSignal(true);
    let monitor;
    const lifecycle = new AbortController();
    const directory = () => {
      if (context.location?.directory) {
        return context.location.directory;
      }
      try {
        return context.data.location.default().directory;
      } catch {
        return "";
      }
    };
    // Hide PR data fetched for a previous directory while the monitor catches up.
    const pr = () => state().directory === directory() ? state().pr : null;
    const theme = () => context.theme;
    const toast = (message, variant = "info") => context.ui.toast.show({
      title: "Pull Request",
      message,
      variant
    });
    async function open() {
      const value = pr();
      if (!value) {
        return;
      }
      const message = await openBrowser(value.url, directory(), lifecycle.signal);
      if (message && !lifecycle.signal.aborted) {
        toast(`${message} ${value.url}`, "warning");
      }
    }
    async function copy() {
      const value = pr();
      if (!value) {
        return;
      }
      const ok = await copyToClipboard(value.url, directory(), lifecycle.signal);
      if (!lifecycle.signal.aborted) {
        toast(ok ? "PR URL copied" : "Could not copy PR URL", ok ? "success" : "error");
      }
    }
    function mergeFg(line) {
      if (line === "Ready to merge" || line === "Merged") {
        return theme().text.feedback.success.base;
      }
      if (line === "Closed without merging" || line === "Merge status unknown") {
        return theme().text.muted;
      }
      return theme().text.feedback.warning.base;
    }
    function ActionButton(props) {
      const [over, setOver] = createSignal(false);
      const disabled = () => props.disabled === true;
      const highlighted = () => over() && !disabled();
      return (() => {
        var _el$ = _$createElement("box"),
          _el$2 = _$createElement("text");
        _$insertNode(_el$, _el$2);
        _$setProp(_el$, "height", 1);
        _$setProp(_el$, "flexShrink", 0);
        _$setProp(_el$, "paddingLeft", 1);
        _$setProp(_el$, "paddingRight", 1);
        _$setProp(_el$, "onMouseOver", () => setOver(true));
        _$setProp(_el$, "onMouseOut", () => setOver(false));
        _$setProp(_el$, "onMouseUp", event => {
          if (event.button !== 0 || disabled()) {
            return;
          }
          event.stopPropagation();
          props.onPress();
        });
        _$insert(_el$2, () => props.label);
        _$effect(_p$ => {
          var _v$ = highlighted() ? theme().background.raised.high : theme().background.raised.base,
            _v$2 = disabled() ? theme().text.faint : theme().text.base;
          _v$ !== _p$.e && (_p$.e = _$setProp(_el$, "backgroundColor", _v$, _p$.e));
          _v$2 !== _p$.t && (_p$.t = _$setProp(_el$2, "fg", _v$2, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$;
      })();
    }
    function PrCard(props) {
      // One memoized summary per card: the previous code derived the merge,
      // review, and checks lines with separate calls.
      const summary = createMemo(() => summarize(props.p));
      return [(() => {
        var _el$3 = _$createElement("box"),
          _el$4 = _$createElement("text"),
          _el$5 = _$createElement("b"),
          _el$6 = _$createTextNode(`#`),
          _el$7 = _$createTextNode(` `),
          _el$8 = _$createElement("a"),
          _el$9 = _$createElement("text"),
          _el$0 = _$createTextNode(` -&gt; `);
        _$insertNode(_el$3, _el$4);
        _$insertNode(_el$3, _el$9);
        _$insertNode(_el$4, _el$5);
        _$insertNode(_el$4, _el$7);
        _$insertNode(_el$4, _el$8);
        _$setProp(_el$4, "onMouseUp", event => {
          if (event.button !== 0) {
            return;
          }
          event.stopPropagation();
          void open();
        });
        _$insertNode(_el$5, _el$6);
        _$insert(_el$5, () => props.p.number, null);
        _$insert(_el$8, () => clean(props.p.title));
        _$insertNode(_el$9, _el$0);
        _$insert(_el$9, () => clean(props.p.headRefName), _el$0);
        _$insert(_el$9, () => clean(props.p.baseRefName), null);
        _$effect(_p$ => {
          var _v$3 = theme().markdown.link,
            _v$4 = props.p.url,
            _v$5 = theme().text.muted;
          _v$3 !== _p$.e && (_p$.e = _$setProp(_el$4, "fg", _v$3, _p$.e));
          _v$4 !== _p$.t && (_p$.t = _$setProp(_el$8, "href", _v$4, _p$.t));
          _v$5 !== _p$.a && (_p$.a = _$setProp(_el$9, "fg", _v$5, _p$.a));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined
        });
        return _el$3;
      })(), (() => {
        var _el$1 = _$createElement("box"),
          _el$10 = _$createElement("text"),
          _el$11 = _$createElement("text"),
          _el$12 = _$createTextNode(`Review: `),
          _el$13 = _$createElement("text"),
          _el$14 = _$createElement("b"),
          _el$15 = _$createElement("text");
        _$insertNode(_el$1, _el$10);
        _$insertNode(_el$1, _el$11);
        _$insertNode(_el$1, _el$13);
        _$insertNode(_el$1, _el$15);
        _$insert(_el$10, () => summary().lifecycle);
        _$insertNode(_el$11, _el$12);
        _$insert(_el$11, () => summary().review, null);
        _$insertNode(_el$13, _el$14);
        _$insert(_el$14, () => summary().merge);
        _$insert(_el$15, () => checksLine(summary().checks));
        _$effect(_p$ => {
          var _v$6 = props.p.state === "MERGED" ? theme().text.feedback.success.base : props.p.state === "CLOSED" ? theme().text.feedback.error.base : theme().text.base,
            _v$7 = theme().text.muted,
            _v$8 = mergeFg(summary().merge),
            _v$9 = summary().checks.failed > 0 ? theme().text.feedback.warning.base : theme().text.muted;
          _v$6 !== _p$.e && (_p$.e = _$setProp(_el$10, "fg", _v$6, _p$.e));
          _v$7 !== _p$.t && (_p$.t = _$setProp(_el$11, "fg", _v$7, _p$.t));
          _v$8 !== _p$.a && (_p$.a = _$setProp(_el$13, "fg", _v$8, _p$.a));
          _v$9 !== _p$.o && (_p$.o = _$setProp(_el$15, "fg", _v$9, _p$.o));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined
        });
        return _el$1;
      })(), (() => {
        var _el$16 = _$createElement("box"),
          _el$17 = _$createElement("text"),
          _el$18 = _$createTextNode(`+`),
          _el$19 = _$createTextNode(` / -`),
          _el$20 = _$createTextNode(` / `),
          _el$21 = _$createTextNode(` files`),
          _el$23 = _$createElement("text"),
          _el$24 = _$createTextNode(` unresolved / `),
          _el$25 = _$createTextNode(` total comments`),
          _el$27 = _$createElement("text"),
          _el$28 = _$createTextNode(`Updated `),
          _el$29 = _$createElement("text");
        _$insertNode(_el$16, _el$17);
        _$insertNode(_el$16, _el$23);
        _$insertNode(_el$16, _el$27);
        _$insertNode(_el$16, _el$29);
        _$insertNode(_el$17, _el$18);
        _$insertNode(_el$17, _el$19);
        _$insertNode(_el$17, _el$20);
        _$insertNode(_el$17, _el$21);
        _$insert(_el$17, () => props.p.additions.toLocaleString(), _el$19);
        _$insert(_el$17, () => props.p.deletions.toLocaleString(), _el$20);
        _$insert(_el$17, () => props.p.changedFiles, _el$21);
        _$insertNode(_el$23, _el$24);
        _$insertNode(_el$23, _el$25);
        _$insert(_el$23, () => props.p.unresolvedThreads, _el$24);
        _$insert(_el$23, () => props.p.totalComments, _el$25);
        _$insertNode(_el$27, _el$28);
        _$insert(_el$27, () => ageOf(props.p.updatedAt, state().now), null);
        _$insert(_el$29, (() => {
          var _c$ = _$memo(() => !!state().loading);
          return () => _c$() ? "Refreshing..." : `Checked ${ageOf(state().fetchedAt, state().now)}`;
        })());
        _$effect(_p$ => {
          var _v$0 = theme().text.base,
            _v$1 = theme().text.muted,
            _v$10 = theme().text.muted,
            _v$11 = theme().text.muted;
          _v$0 !== _p$.e && (_p$.e = _$setProp(_el$17, "fg", _v$0, _p$.e));
          _v$1 !== _p$.t && (_p$.t = _$setProp(_el$23, "fg", _v$1, _p$.t));
          _v$10 !== _p$.a && (_p$.a = _$setProp(_el$27, "fg", _v$10, _p$.a));
          _v$11 !== _p$.o && (_p$.o = _$setProp(_el$29, "fg", _v$11, _p$.o));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined
        });
        return _el$16;
      })()];
    }
    function Card() {
      onMount(() => {
        monitor = createMonitor({
          directory,
          publish: setState
        });
        monitor.tick();
        const timer = setInterval(() => {
          monitor?.tick();
        }, POLL_MS);
        // Never hold the process open on this timer alone; the host owns lifetime.
        timer.unref?.();
        onCleanup(() => clearInterval(timer));
      });
      onCleanup(() => {
        monitor?.stop();
        monitor = undefined;
      });
      // A stable root keeps the slot mounted while the first lookup is in flight.
      return (() => {
        var _el$30 = _$createElement("box"),
          _el$31 = _$createElement("box"),
          _el$32 = _$createElement("text"),
          _el$33 = _$createElement("text"),
          _el$34 = _$createElement("b");
        _$insertNode(_el$30, _el$31);
        _$setProp(_el$30, "gap", 1);
        _$setProp(_el$30, "flexShrink", 0);
        _$insertNode(_el$31, _el$32);
        _$insertNode(_el$31, _el$33);
        _$setProp(_el$31, "flexDirection", "row");
        _$setProp(_el$31, "gap", 1);
        _$setProp(_el$31, "onMouseDown", event => {
          if (event.button !== 0) {
            return;
          }
          event.stopPropagation();
          setExpanded(value => !value);
        });
        _$insert(_el$32, () => expanded() ? "v" : ">");
        _$insertNode(_el$33, _el$34);
        _$insertNode(_el$34, _$createTextNode(`Pull Request`));
        _$insert(_el$30, (() => {
          var _c$2 = _$memo(() => !!expanded());
          return () => _c$2() ? [_$createComponent(Show, {
            get when() {
              return pr();
            },
            children: p => _$createComponent(PrCard, {
              get p() {
                return p();
              }
            })
          }), _$memo(() => _$memo(() => !!state().error)() ? (() => {
            var _el$37 = _$createElement("text");
            _$insert(_el$37, () => pr() ? "STALE: " : "", null);
            _$insert(_el$37, () => state().error, null);
            _$effect(_$p => _$setProp(_el$37, "fg", theme().text.feedback.warning.base, _$p));
            return _el$37;
          })() : null), (() => {
            var _el$36 = _$createElement("box");
            _$setProp(_el$36, "flexDirection", "row");
            _$setProp(_el$36, "gap", 1);
            _$setProp(_el$36, "flexWrap", "wrap");
            _$insert(_el$36, _$createComponent(ActionButton, {
              get label() {
                return state().loading ? "Refreshing" : "Refresh";
              },
              get disabled() {
                return state().loading;
              },
              onPress: () => monitor?.tick(true)
            }), null);
            _$insert(_el$36, _$createComponent(ActionButton, {
              label: "Copy URL",
              onPress: () => void copy()
            }), null);
            _$insert(_el$36, _$createComponent(ActionButton, {
              label: "Open",
              onPress: () => void open()
            }), null);
            return _el$36;
          })()] : null;
        })(), null);
        _$effect(_p$ => {
          var _v$12 = Boolean(pr() || state().error),
            _v$13 = theme().text.base,
            _v$14 = theme().text.base;
          _v$12 !== _p$.e && (_p$.e = _$setProp(_el$30, "visible", _v$12, _p$.e));
          _v$13 !== _p$.t && (_p$.t = _$setProp(_el$32, "fg", _v$13, _p$.t));
          _v$14 !== _p$.a && (_p$.a = _$setProp(_el$33, "fg", _v$14, _p$.a));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined
        });
        return _el$30;
      })();
    }
    context.ui.slot({
      append: "sidebar.content",
      render: () => _$createComponent(Card, {})
    });
    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [{
        id: "pr-sidebar.open",
        title: "PR: Open on GitHub",
        group: "Pull Request",
        palette: true,
        enabled: () => Boolean(pr()),
        run: () => void open()
      }, {
        id: "pr-sidebar.copy",
        title: "PR: Copy URL",
        group: "Pull Request",
        palette: true,
        enabled: () => Boolean(pr()),
        run: () => void copy()
      }, {
        id: "pr-sidebar.refresh",
        title: "PR: Refresh status",
        group: "Pull Request",
        palette: true,
        run: () => monitor?.tick(true)
      }]
    }));
    const offIdle = context.data.on("session.execution.succeeded", () => {
      monitor?.tick(false, true);
    });
    const offBranch = context.data.on("vcs.branch.updated", () => {
      monitor?.tick();
    });
    return () => {
      lifecycle.abort();
      offIdle();
      offBranch();
      monitor?.stop();
    };
  }
});
function checksLine(counts) {
  if (counts.passed + counts.failed + counts.pending + counts.skipped === 0) {
    return "No checks reported";
  }
  let line = `Checks: ${counts.passed} passed / ${counts.failed} failed / ${counts.pending} pending`;
  if (counts.skipped > 0) {
    line += ` / ${counts.skipped} skipped`;
  }
  return line;
}