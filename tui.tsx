/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import type { ResolvedTheme } from "@opencode/theme/tui";
import type { RGBA } from "@opentui/core";
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import {
	ageOf,
	checksLineOf,
	clean,
	copyToClipboard,
	createMonitor,
	MERGE_TONE,
	type Monitor,
	openBrowser,
	type PullRequest,
	type Snapshot,
	summarize,
	type Tone,
} from "./model.ts";

const POLL_MS = 5000;

function toneColor(theme: ResolvedTheme, tone: Tone): RGBA {
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

function lifecycleTone(state: PullRequest["state"]): Tone {
	if (state === "MERGED") {
		return "success";
	}
	if (state === "CLOSED") {
		return "error";
	}
	return "base";
}

function ActionButton(props: {
	label: string;
	theme: ResolvedTheme;
	disabled?: boolean;
	onPress: () => void;
}) {
	const [over, setOver] = createSignal(false);
	const disabled = () => props.disabled === true;
	const highlighted = () => over() && !disabled();
	return (
		<box
			height={1}
			flexShrink={0}
			paddingLeft={1}
			paddingRight={1}
			backgroundColor={
				highlighted() ? props.theme.background.raised.high : props.theme.background.raised.base
			}
			onMouseOver={() => setOver(true)}
			onMouseOut={() => setOver(false)}
			onMouseUp={(event) => {
				if (event.button !== 0 || disabled()) {
					return;
				}
				event.stopPropagation();
				props.onPress();
			}}
		>
			<text fg={disabled() ? props.theme.text.faint : props.theme.text.base}>{props.label}</text>
		</box>
	);
}

function PrCard(props: {
	pr: PullRequest;
	now: number;
	loading: boolean;
	fetchedAt: number;
	theme: ResolvedTheme;
	onOpen: () => void;
}) {
	// One memoized summary per card: the merge, review, and checks lines share it.
	const summary = createMemo(() => summarize(props.pr));
	return (
		<>
			<box>
				{/* Spans get no mouse events, so the number link needs its own text node. */}
				<box flexDirection="row" gap={1}>
					<text
						flexShrink={0}
						fg={props.theme.markdown.link}
						onMouseUp={(event) => {
							if (event.button !== 0) {
								return;
							}
							event.stopPropagation();
							void props.onOpen();
						}}
					>
						<a href={props.pr.url}>
							<u>
								<b>#{props.pr.number}</b>
							</u>
						</a>
					</text>
					<text flexShrink={1} fg={props.theme.text.base}>
						{clean(props.pr.title)}
					</text>
				</box>
				<text fg={props.theme.text.muted}>
					{clean(props.pr.headRefName)} {"->"} {clean(props.pr.baseRefName)}
				</text>
			</box>
			<box>
				<text fg={toneColor(props.theme, lifecycleTone(props.pr.state))}>
					{summary().lifecycle}
				</text>
				<text fg={props.theme.text.muted}>Review: {summary().review}</text>
				<text fg={toneColor(props.theme, MERGE_TONE[summary().merge])}>
					<b>{summary().merge}</b>
				</text>
				<text
					fg={
						summary().checks.failed > 0
							? props.theme.text.feedback.warning.base
							: props.theme.text.muted
					}
				>
					{checksLineOf(summary().checks)}
				</text>
			</box>
			<box>
				<text fg={props.theme.text.base}>
					+{props.pr.additions.toLocaleString()} / -{props.pr.deletions.toLocaleString()} /{" "}
					{props.pr.changedFiles} files
				</text>
				<text fg={props.theme.text.muted}>
					{props.pr.unresolvedThreads} unresolved / {props.pr.totalComments} total comments
				</text>
				<text fg={props.theme.text.muted}>Updated {ageOf(props.pr.updatedAt, props.now)}</text>
				<text fg={props.theme.text.muted}>
					{props.loading ? "Refreshing..." : `Checked ${ageOf(props.fetchedAt, props.now)}`}
				</text>
			</box>
		</>
	);
}

export default Plugin.define({
	id: "pr-sidebar",
	setup(context) {
		const [state, setState] = createSignal<Snapshot>({
			pr: null,
			error: "",
			fetchedAt: 0,
			now: Date.now(),
			loading: false,
		});
		const [expanded, setExpanded] = createSignal(true);
		let monitor: Monitor | undefined;
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
		const pr = () => (state().directory === directory() ? state().pr : null);
		const theme = () => context.theme;
		const toast = (message: string, variant: "info" | "success" | "warning" | "error" = "info") =>
			context.ui.toast.show({ title: "Pull Request", message, variant });

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
				monitor = createMonitor({ directory, publish: setState });
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
			return (
				<box visible={Boolean(pr() || state().error)} gap={1} flexShrink={0}>
					<box
						flexDirection="row"
						gap={1}
						onMouseDown={(event) => {
							if (event.button !== 0) {
								return;
							}
							event.stopPropagation();
							setExpanded((value) => !value);
						}}
					>
						<text fg={theme().text.base}>{expanded() ? "▼" : "▶"}</text>
						<text fg={theme().text.base}>
							<b>Pull Request</b>
						</text>
					</box>
					{expanded() ? (
						<>
							<Show when={pr()}>
								{(p) => (
									<PrCard
										pr={p()}
										now={state().now}
										loading={state().loading}
										fetchedAt={state().fetchedAt}
										theme={theme()}
										onOpen={open}
									/>
								)}
							</Show>
							{state().error ? (
								<text fg={theme().text.feedback.warning.base}>
									{pr() ? "STALE: " : ""}
									{state().error}
								</text>
							) : null}
							<box flexDirection="row" gap={1} flexWrap="wrap">
								<ActionButton
									label={state().loading ? "Refreshing" : "Refresh"}
									theme={theme()}
									disabled={state().loading}
									onPress={() => monitor?.tick(true)}
								/>
								<ActionButton label="Copy URL" theme={theme()} onPress={() => void copy()} />
								<ActionButton label="Open" theme={theme()} onPress={() => void open()} />
							</box>
						</>
					) : null}
				</box>
			);
		}

		context.ui.slot({ append: "sidebar.content", render: () => <Card /> });
		context.keymap.layer(() => ({
			mode: "global",
			priority: 10,
			commands: [
				{
					id: "pr-sidebar.open",
					title: "PR: Open on GitHub",
					group: "Pull Request",
					palette: true,
					enabled: () => Boolean(pr()),
					run: () => void open(),
				},
				{
					id: "pr-sidebar.copy",
					title: "PR: Copy URL",
					group: "Pull Request",
					palette: true,
					enabled: () => Boolean(pr()),
					run: () => void copy(),
				},
				{
					id: "pr-sidebar.refresh",
					title: "PR: Refresh status",
					group: "Pull Request",
					palette: true,
					run: () => monitor?.tick(true),
				},
			],
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
	},
});
