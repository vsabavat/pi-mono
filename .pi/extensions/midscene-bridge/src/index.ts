import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadMidsceneEnv } from "./env.js";
import { ensureBridge, createBridgeState, destroyBridge, getBridgeAgent } from "./bridge.js";
import type { BridgeStatus } from "./bridge.js";
import { runBrowserSteps, validateSteps } from "./actions.js";
import { BrowserToolInputSchema, type BrowserToolInput, type BrowserRunSummary } from "./types.js";

const TOOL_NAME = "browser_bridge";
const MAX_CONNECTION_RETRIES = 1;

function formatMissingEnv(missing: string[], envPath: string): string {
	const lines = [
		"Missing Midscene environment values.",
		`Add them to ${envPath} or export them in your shell:`,
		"",
		...missing.map((key) => `- ${key}`),
	];
	return lines.join("\n");
}

function isConnectionLost(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /connection lost|transport close/i.test(message);
}

function buildProgressUpdate(
	message: string,
	input: BrowserToolInput,
	startedAt: number,
	status?: BridgeStatus,
): { content: { type: "text"; text: string }[]; details: BrowserRunSummary } {
	return {
		content: [{ type: "text", text: message }],
		details: {
			connected: status?.connected ?? false,
			mode: status?.mode ?? (input.attach ?? "current_tab"),
			url: status?.url ?? input.url,
			reused: status?.reused ?? false,
			elapsedMs: Date.now() - startedAt,
			outputs: {},
			steps: [],
		},
	};
}

function formatStepErrors(errors: string[]): string {
	return ["Invalid step definitions:", "", ...errors.map((err) => `- ${err}`)].join("\n");
}

function formatSuccessMessage(summary: BrowserRunSummary): string {
	const outputsCount = Object.keys(summary.outputs).length;
	const lines = [
		"Browser task completed.",
		`Connected: ${summary.mode} ${summary.url ?? ""}`.trim(),
		`Steps: ${summary.steps.length}`,
		`Outputs: ${outputsCount}`,
	];
	return lines.join("\n");
}

export default function midsceneBridgeExtension(pi: ExtensionAPI) {
	const bridgeState = createBridgeState();
	let busy = false;

	pi.registerTool({
		name: TOOL_NAME,
		label: "Browser Bridge",
		description:
			"Use Midscene to control the user's Chrome tab via bridge mode. Prefer steps for stability; use task for a single high-level instruction.",
		parameters: BrowserToolInputSchema,
		async execute(_toolCallId, params, onUpdate, ctx, signal) {
			if (busy) {
				return {
					content: [{ type: "text", text: "Browser bridge is already running a task." }],
					isError: true,
					details: { error: "busy" },
				};
			}

			busy = true;
			const startedAt = Date.now();
			try {
				const envStatus = loadMidsceneEnv();
				if (envStatus.missing.length > 0) {
					return {
						content: [{ type: "text", text: formatMissingEnv(envStatus.missing, envStatus.envPath) }],
						isError: true,
						details: { missing: envStatus.missing, envPath: envStatus.envPath },
					};
				}

				const input = params as BrowserToolInput;
				if (!input.steps && !input.task) {
					return {
						content: [{ type: "text", text: "Provide either steps or task." }],
						isError: true,
						details: { error: "missing_steps_or_task" },
					};
				}

				if (input.steps) {
					const errors = validateSteps(input.steps);
					if (errors.length > 0) {
						return {
							content: [{ type: "text", text: formatStepErrors(errors) }],
							isError: true,
							details: { error: "invalid_steps", errors },
						};
					}
				}

				let lastError: unknown;
				for (let attempt = 0; attempt <= MAX_CONNECTION_RETRIES; attempt += 1) {
					try {
						const status = await ensureBridge(bridgeState, input);
						const agent = getBridgeAgent(bridgeState);
						if (!agent) {
							return {
								content: [{ type: "text", text: "Bridge failed to initialize." }],
								isError: true,
								details: { error: "bridge_not_ready" },
							};
						}

						const outputs: Record<string, unknown> = {};
						const stepResults: BrowserRunSummary["steps"] = [];
						const progress: BrowserRunSummary = {
							connected: status.connected,
							mode: status.mode,
							url: status.url,
							reused: status.reused,
							elapsedMs: 0,
							outputs,
							steps: stepResults,
						};
						const emitUpdate = (message: string) => {
							if (!onUpdate) return;
							progress.elapsedMs = Date.now() - startedAt;
							onUpdate({
								content: [{ type: "text", text: message }],
								details: progress,
							});
						};

						if (input.steps && input.steps.length > 0) {
							stepResults.push(
								...(
									await runBrowserSteps(agent, input.steps, {
										onUpdate: emitUpdate,
										signal,
									})
								),
							);
							for (const result of stepResults) {
								if (result.saveAs && result.status === "ok") {
									outputs[result.saveAs] = result.output;
								}
							}
						} else if (input.task) {
							emitUpdate("Running high-level task...");
							await agent.aiAct(input.task);
						}

						const summary: BrowserRunSummary = {
							connected: status.connected,
							mode: status.mode,
							url: status.url,
							reused: status.reused,
							elapsedMs: Date.now() - startedAt,
							outputs,
							steps: stepResults,
						};

						if (input.closeOnComplete) {
							await destroyBridge(bridgeState);
						}

						return {
							content: [{ type: "text", text: formatSuccessMessage(summary) }],
							details: summary,
						};
					} catch (error) {
						lastError = error;
						if (attempt < MAX_CONNECTION_RETRIES && isConnectionLost(error)) {
							onUpdate?.(buildProgressUpdate("Connection lost. Reconnecting...", input, startedAt));
							await destroyBridge(bridgeState);
							continue;
						}
						throw error;
					}
				}

				throw lastError;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Browser task failed: ${message}` }],
					isError: true,
					details: { error: message },
				};
			} finally {
				busy = false;
			}
		},
	});

	pi.registerCommand("browser", {
		description: "Manage the Midscene browser bridge",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;
			const trimmed = args.trim();
			if (!trimmed || trimmed === "status") {
				const agent = getBridgeAgent(bridgeState);
				const status = agent ? "connected" : "disconnected";
				ctx.ui.notify(`Browser bridge ${status}.`, "info");
				return;
			}
			if (trimmed === "close") {
				await destroyBridge(bridgeState);
				ctx.ui.notify("Browser bridge closed.", "info");
				return;
			}
			ctx.ui.notify("Unknown command. Try /browser status or /browser close.", "warning");
		},
	});

	pi.on("session_shutdown", async () => {
		await destroyBridge(bridgeState);
	});
}
