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
import { ageOf, checksLineOf, clean, copyToClipboard, createMonitor, MERGE_TONE, openBrowser, summarize } from "./model.js";
const POLL_MS = 5000;
function toneColor(theme, tone) {
  if (tone === "success") {
    return theme.text.feedback.success.base;
  }
  if (tone === "error") {
    return theme.text.feedback.error.base;
  }
  if (tone === "warning") {
    return theme.text.feedback.warning.base;
  }
  if (tone === "muted") {
    return theme.text.muted;
  }
  return theme.text.base;
}
function lifecycleTone(state) {
  if (state === "MERGED") {
    return "success";
  }
  if (state === "CLOSED") {
    return "error";
  }
  return "base";
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
      var _v$ = highlighted() ? props.theme.background.raised.high : props.theme.background.raised.base,
        _v$2 = disabled() ? props.theme.text.faint : props.theme.text.base;
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
  // One memoized summary per card: the merge, review, and checks lines share it.
  const summary = createMemo(() => summarize(props.pr));
  return [(() => {
    var _el$3 = _$createElement("box"),
      _el$4 = _$createElement("box"),
      _el$5 = _$createElement("text"),
      _el$6 = _$createElement("a"),
      _el$7 = _$createElement("u"),
      _el$8 = _$createElement("b"),
      _el$9 = _$createTextNode(`#`),
      _el$0 = _$createElement("text"),
      _el$1 = _$createElement("text"),
      _el$10 = _$createTextNode(` -> `);
    _$insertNode(_el$3, _el$4);
    _$insertNode(_el$3, _el$1);
    _$insertNode(_el$4, _el$5);
    _$insertNode(_el$4, _el$0);
    _$setProp(_el$4, "flexDirection", "row");
    _$setProp(_el$4, "gap", 1);
    _$insertNode(_el$5, _el$6);
    _$setProp(_el$5, "flexShrink", 0);
    _$setProp(_el$5, "onMouseUp", event => {
      if (event.button !== 0) {
        return;
      }
      event.stopPropagation();
      void props.onOpen();
    });
    _$insertNode(_el$6, _el$7);
    _$insertNode(_el$7, _el$8);
    _$insertNode(_el$8, _el$9);
    _$insert(_el$8, () => props.pr.number, null);
    _$setProp(_el$0, "flexShrink", 1);
    _$insert(_el$0, () => clean(props.pr.title));
    _$insertNode(_el$1, _el$10);
    _$insert(_el$1, () => clean(props.pr.headRefName), _el$10);
    _$insert(_el$1, () => clean(props.pr.baseRefName), null);
    _$effect(_p$ => {
      var _v$3 = props.theme.markdown.link,
        _v$4 = props.pr.url,
        _v$5 = props.theme.text.base,
        _v$6 = props.theme.text.muted;
      _v$3 !== _p$.e && (_p$.e = _$setProp(_el$5, "fg", _v$3, _p$.e));
      _v$4 !== _p$.t && (_p$.t = _$setProp(_el$6, "href", _v$4, _p$.t));
      _v$5 !== _p$.a && (_p$.a = _$setProp(_el$0, "fg", _v$5, _p$.a));
      _v$6 !== _p$.o && (_p$.o = _$setProp(_el$1, "fg", _v$6, _p$.o));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined
    });
    return _el$3;
  })(), (() => {
    var _el$13 = _$createElement("box"),
      _el$14 = _$createElement("text"),
      _el$15 = _$createElement("text"),
      _el$16 = _$createTextNode(`Review: `),
      _el$17 = _$createElement("text"),
      _el$18 = _$createElement("b"),
      _el$19 = _$createElement("text");
    _$insertNode(_el$13, _el$14);
    _$insertNode(_el$13, _el$15);
    _$insertNode(_el$13, _el$17);
    _$insertNode(_el$13, _el$19);
    _$insert(_el$14, () => summary().lifecycle);
    _$insertNode(_el$15, _el$16);
    _$insert(_el$15, () => summary().review, null);
    _$insertNode(_el$17, _el$18);
    _$insert(_el$18, () => summary().merge);
    _$insert(_el$19, () => checksLineOf(summary().checks));
    _$effect(_p$ => {
      var _v$7 = toneColor(props.theme, lifecycleTone(props.pr.state)),
        _v$8 = props.theme.text.muted,
        _v$9 = toneColor(props.theme, MERGE_TONE[summary().merge]),
        _v$0 = summary().checks.failed > 0 ? props.theme.text.feedback.warning.base : props.theme.text.muted;
      _v$7 !== _p$.e && (_p$.e = _$setProp(_el$14, "fg", _v$7, _p$.e));
      _v$8 !== _p$.t && (_p$.t = _$setProp(_el$15, "fg", _v$8, _p$.t));
      _v$9 !== _p$.a && (_p$.a = _$setProp(_el$17, "fg", _v$9, _p$.a));
      _v$0 !== _p$.o && (_p$.o = _$setProp(_el$19, "fg", _v$0, _p$.o));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined
    });
    return _el$13;
  })(), (() => {
    var _el$20 = _$createElement("box"),
      _el$21 = _$createElement("text"),
      _el$22 = _$createTextNode(`+`),
      _el$23 = _$createTextNode(` / -`),
      _el$24 = _$createTextNode(` / `),
      _el$26 = _$createTextNode(` files`),
      _el$27 = _$createElement("text"),
      _el$28 = _$createTextNode(` unresolved / `),
      _el$29 = _$createTextNode(` total comments`),
      _el$30 = _$createElement("text"),
      _el$31 = _$createTextNode(`Updated `),
      _el$32 = _$createElement("text");
    _$insertNode(_el$20, _el$21);
    _$insertNode(_el$20, _el$27);
    _$insertNode(_el$20, _el$30);
    _$insertNode(_el$20, _el$32);
    _$insertNode(_el$21, _el$22);
    _$insertNode(_el$21, _el$23);
    _$insertNode(_el$21, _el$24);
    _$insertNode(_el$21, _el$26);
    _$insert(_el$21, () => props.pr.additions.toLocaleString(), _el$23);
    _$insert(_el$21, () => props.pr.deletions.toLocaleString(), _el$24);
    _$insert(_el$21, () => props.pr.changedFiles, _el$26);
    _$insertNode(_el$27, _el$28);
    _$insertNode(_el$27, _el$29);
    _$insert(_el$27, () => props.pr.unresolvedThreads, _el$28);
    _$insert(_el$27, () => props.pr.totalComments, _el$29);
    _$insertNode(_el$30, _el$31);
    _$insert(_el$30, () => ageOf(props.pr.updatedAt, props.now), null);
    _$insert(_el$32, (() => {
      var _c$ = _$memo(() => !!props.loading);
      return () => _c$() ? "Refreshing..." : `Checked ${ageOf(props.fetchedAt, props.now)}`;
    })());
    _$effect(_p$ => {
      var _v$1 = props.theme.text.base,
        _v$10 = props.theme.text.muted,
        _v$11 = props.theme.text.muted,
        _v$12 = props.theme.text.muted;
      _v$1 !== _p$.e && (_p$.e = _$setProp(_el$21, "fg", _v$1, _p$.e));
      _v$10 !== _p$.t && (_p$.t = _$setProp(_el$27, "fg", _v$10, _p$.t));
      _v$11 !== _p$.a && (_p$.a = _$setProp(_el$30, "fg", _v$11, _p$.a));
      _v$12 !== _p$.o && (_p$.o = _$setProp(_el$32, "fg", _v$12, _p$.o));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined
    });
    return _el$20;
  })()];
}
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
        var _el$33 = _$createElement("box"),
          _el$34 = _$createElement("box"),
          _el$35 = _$createElement("text"),
          _el$36 = _$createElement("text"),
          _el$37 = _$createElement("b");
        _$insertNode(_el$33, _el$34);
        _$setProp(_el$33, "gap", 1);
        _$setProp(_el$33, "flexShrink", 0);
        _$insertNode(_el$34, _el$35);
        _$insertNode(_el$34, _el$36);
        _$setProp(_el$34, "flexDirection", "row");
        _$setProp(_el$34, "gap", 1);
        _$setProp(_el$34, "onMouseDown", event => {
          if (event.button !== 0) {
            return;
          }
          event.stopPropagation();
          setExpanded(value => !value);
        });
        _$insert(_el$35, () => expanded() ? "▼" : "▶");
        _$insertNode(_el$36, _el$37);
        _$insertNode(_el$37, _$createTextNode(`Pull Request`));
        _$insert(_el$33, (() => {
          var _c$2 = _$memo(() => !!expanded());
          return () => _c$2() ? [_$createComponent(Show, {
            get when() {
              return pr();
            },
            children: p => _$createComponent(PrCard, {
              get pr() {
                return p();
              },
              get now() {
                return state().now;
              },
              get loading() {
                return state().loading;
              },
              get fetchedAt() {
                return state().fetchedAt;
              },
              get theme() {
                return theme();
              },
              onOpen: open
            })
          }), _$memo(() => _$memo(() => !!state().error)() ? (() => {
            var _el$40 = _$createElement("text");
            _$insert(_el$40, () => pr() ? "STALE: " : "", null);
            _$insert(_el$40, () => state().error, null);
            _$effect(_$p => _$setProp(_el$40, "fg", theme().text.feedback.warning.base, _$p));
            return _el$40;
          })() : null), (() => {
            var _el$39 = _$createElement("box");
            _$setProp(_el$39, "flexDirection", "row");
            _$setProp(_el$39, "gap", 1);
            _$setProp(_el$39, "flexWrap", "wrap");
            _$insert(_el$39, _$createComponent(ActionButton, {
              get label() {
                return state().loading ? "Refreshing" : "Refresh";
              },
              get theme() {
                return theme();
              },
              get disabled() {
                return state().loading;
              },
              onPress: () => monitor?.tick(true)
            }), null);
            _$insert(_el$39, _$createComponent(ActionButton, {
              label: "Copy URL",
              get theme() {
                return theme();
              },
              onPress: () => void copy()
            }), null);
            _$insert(_el$39, _$createComponent(ActionButton, {
              label: "Open",
              get theme() {
                return theme();
              },
              onPress: () => void open()
            }), null);
            return _el$39;
          })()] : null;
        })(), null);
        _$effect(_p$ => {
          var _v$13 = Boolean(pr() || state().error),
            _v$14 = theme().text.base,
            _v$15 = theme().text.base;
          _v$13 !== _p$.e && (_p$.e = _$setProp(_el$33, "visible", _v$13, _p$.e));
          _v$14 !== _p$.t && (_p$.t = _$setProp(_el$35, "fg", _v$14, _p$.t));
          _v$15 !== _p$.a && (_p$.a = _$setProp(_el$36, "fg", _v$15, _p$.a));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined
        });
        return _el$33;
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