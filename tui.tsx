/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import { createSignal, onCleanup, onMount } from "solid-js";
import {
	ageOf,
	clean,
	copyToClipboard,
	createMonitor,
	lifecycleOf,
	mergeLineOf,
	openBrowser,
	summarizeChecks,
	summarizeReview,
	type PullRequest,
	type Snapshot,
} from "./model.ts";

const POLL_MS = 5000;

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
		let monitor: ReturnType<typeof createMonitor> | undefined;
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
		const pr = () => (state().directory === directory() ? state().pr : null);
		const theme = () => context.theme;
		const toast = (
			message: string,
			variant: "info" | "success" | "warning" | "error" = "info",
		) => context.ui.toast.show({ title: "Pull Request", message, variant });

		async function open() {
			const value = pr();
			if (!value) {
				return;
			}
			const message = await openBrowser(
				value.url,
				directory(),
				lifecycle.signal,
			);
			if (message && !lifecycle.signal.aborted) {
				toast(`${message} ${value.url}`, "warning");
			}
		}

		async function copy() {
			const value = pr();
			if (!value) {
				return;
			}
			const ok = await copyToClipboard(
				value.url,
				directory(),
				lifecycle.signal,
			);
			if (!lifecycle.signal.aborted) {
				toast(
					ok ? "PR URL copied" : "Could not copy PR URL",
					ok ? "success" : "error",
				);
			}
		}

		function mergeFg(line: string) {
			if (line === "Ready to merge" || line === "Merged") {
				return theme().text.feedback.success.base;
			}
			if (
				line === "Closed without merging" ||
				line === "Merge status unknown"
			) {
				return theme().text.muted;
			}
			return theme().text.feedback.warning.base;
		}

		function ActionButton(props: {
			label: string;
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
						highlighted()
							? theme().background.raised.high
							: theme().background.raised.base
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
					<text fg={disabled() ? theme().text.faint : theme().text.base}>
						{props.label}
					</text>
				</box>
			);
		}

		function PrCard(props: { p: PullRequest }) {
			return (
				<>
					<box>
						<text
							fg={theme().markdown.link}
							onMouseUp={(event) => {
								if (event.button !== 0) {
									return;
								}
								event.stopPropagation();
								void open();
							}}
						>
							<b>#{props.p.number}</b>{" "}
							<a href={props.p.url}>{clean(props.p.title)}</a>
						</text>
						<text fg={theme().text.muted}>
							{clean(props.p.headRefName)} -&gt; {clean(props.p.baseRefName)}
						</text>
					</box>
					<box>
						<text
							fg={
								props.p.state === "MERGED"
									? theme().text.feedback.success.base
									: props.p.state === "CLOSED"
										? theme().text.feedback.error.base
										: theme().text.base
							}
						>
							{lifecycleOf(props.p)}
						</text>
						<text fg={theme().text.muted}>
							Review: {summarizeReview(props.p.reviewDecision)}
						</text>
						<text fg={mergeFg(mergeLineOf(props.p))}>
							<b>{mergeLineOf(props.p)}</b>
						</text>
						<text
							fg={
								summarizeChecks(props.p.statusCheckRollup).failed > 0
									? theme().text.feedback.warning.base
									: theme().text.muted
							}
						>
							{checksLine(props.p)}
						</text>
					</box>
					<box>
						<text fg={theme().text.base}>
							+{props.p.additions.toLocaleString()} / -
							{props.p.deletions.toLocaleString()} / {props.p.changedFiles}{" "}
							files
						</text>
						<text fg={theme().text.muted}>
							{props.p.unresolvedThreads} unresolved / {props.p.totalComments}{" "}
							total comments
						</text>
						<text fg={theme().text.muted}>
							Updated {ageOf(props.p.updatedAt, state().now)}
						</text>
						<text fg={theme().text.muted}>
							{state().loading
								? "Refreshing..."
								: `Checked ${ageOf(state().fetchedAt, state().now)}`}
						</text>
					</box>
				</>
			);
		}

		function Card() {
			onMount(() => {
				monitor = createMonitor({ directory, publish: setState });
				monitor.tick();
			});
			const timer = setInterval(() => {
				monitor?.tick();
			}, POLL_MS);
			// Never hold the process open on this timer alone; the host owns lifetime.
			timer.unref?.();
			onCleanup(() => {
				clearInterval(timer);
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
						<text fg={theme().text.base}>{expanded() ? "v" : ">"}</text>
						<text fg={theme().text.base}>
							<b>Pull Request</b>
						</text>
					</box>
					{expanded() ? (
						<>
							{pr() ? <PrCard p={pr() as PullRequest} /> : null}
							{state().error ? (
								<text fg={theme().text.feedback.warning.base}>
									{pr() ? "STALE: " : ""}
									{state().error}
								</text>
							) : null}
							<box flexDirection="row" gap={1} flexWrap="wrap">
								<ActionButton
									label={state().loading ? "Refreshing" : "Refresh"}
									disabled={state().loading}
									onPress={() => monitor?.tick(true)}
								/>
								<ActionButton label="Copy URL" onPress={() => void copy()} />
								<ActionButton label="Open" onPress={() => void open()} />
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

function checksLine(pr: PullRequest): string {
	const counts = summarizeChecks(pr.statusCheckRollup);
	if (counts.passed + counts.failed + counts.pending + counts.skipped === 0) {
		return "No checks reported";
	}
	let line = `Checks: ${counts.passed} passed / ${counts.failed} failed / ${counts.pending} pending`;
	if (counts.skipped > 0) {
		line += ` / ${counts.skipped} skipped`;
	}
	return line;
}
