import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { runBrowserSteps } from "./actions.js";
import type { BridgeStatus } from "./bridge.js";
import { createBridgeState, destroyBridge, ensureBridge, getBridgeAgent, takeBridgeScreenshot } from "./bridge.js";
import { loadMidsceneEnv } from "./env.js";
import { resizeSnapshotImage } from "./image-resize.js";
import { normalizePlanTasks, normalizeStepsInput, resolvePlanTarget, runBrowserPlan } from "./plan.js";
import type { PlaywrightStatus } from "./playwright.js";
import {
	createPlaywrightState,
	destroyPlaywright,
	ensurePlaywright,
	getPlaywrightAgent,
	getPlaywrightPage,
	takePlaywrightScreenshot,
} from "./playwright.js";
import { type BrowserRunSummary, type BrowserStep, type BrowserToolInput, BrowserToolInputSchema } from "./types.js";

const TOOL_NAME = "browser_bridge";
const MAX_CONNECTION_RETRIES = 1;

type BrowserStatus = BridgeStatus | PlaywrightStatus;
type ToolContent = TextContent | ImageContent;

const textContent = (text: string): TextContent => ({ type: "text", text });

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

function isBridgeCallTimeout(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /bridge call timeout/i.test(message);
}

function isNoTabConnected(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /no tab is connected/i.test(message);
}

function formatNoTabConnected(): string {
	return "Browser bridge has no connected tab. Connect a Chrome tab and retry, or use runtime: playwright.";
}

function formatBridgeCallTimeout(message: string): string {
	const match = message.match(/timeout.*?:\s*([A-Za-z0-9_.-]+)/i);
	const method = match?.[1] ? ` (${match[1]})` : "";
	return [`Bridge call timed out${method}.`, "Focus the Chrome tab and retry, or use runtime: playwright."].join("\n");
}

function getAddressInUse(error: unknown): { message: string; port?: number } | null {
	const message = error instanceof Error ? error.message : String(error);
	if (!/EADDRINUSE/i.test(message)) return null;
	const match = message.match(/EADDRINUSE.*?:::(\d+)\b/) ?? message.match(/EADDRINUSE.*?:(\d+)\b/);
	const port = match?.[1] ? Number.parseInt(match[1], 10) : undefined;
	return { message, port: Number.isNaN(port) ? undefined : port };
}

function isMissingPlaywrightBrowser(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /executable doesn't exist/i.test(message) && /playwright/i.test(message);
}

function formatMissingPlaywrightBrowser(): string {
	return [
		"Playwright browsers are not installed.",
		"Run `npx playwright install` in packages/coding-agent/examples/extensions/midscene-bridge.",
	].join("\n");
}

function buildProgressUpdate(
	message: string,
	input: BrowserToolInput,
	startedAt: number,
	status?: BrowserStatus,
): { content: ToolContent[]; details: BrowserRunSummary } {
	return {
		content: [textContent(message)],
		details: {
			connected: status?.connected ?? false,
			mode: status?.mode ?? input.attach ?? "current_tab",
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

function formatPlanErrors(errors: string[]): string {
	return ["Invalid plan definitions:", "", ...errors.map((err) => `- ${err}`)].join("\n");
}

function formatPlanTargetErrors(errors: string[]): string {
	return ["Invalid plan target:", "", ...errors.map((err) => `- ${err}`)].join("\n");
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

async function buildSnapshotContent(
	state: ReturnType<typeof createPlaywrightState>,
	label: string,
	fullPage: boolean,
): Promise<ToolContent[]> {
	const screenshot = await takePlaywrightScreenshot(state, fullPage);
	if (!screenshot) {
		return [textContent("Screenshot unavailable.")];
	}
	const resized = await resizeSnapshotImage({ type: "image", data: screenshot.data, mimeType: screenshot.mimeType });
	return [textContent(label), { type: "image", data: resized.data, mimeType: resized.mimeType }];
}

async function buildBridgeSnapshotContent(
	agent: ReturnType<typeof getBridgeAgent>,
	label: string,
): Promise<ToolContent[]> {
	if (!agent) {
		return [textContent("Screenshot unavailable.")];
	}
	const screenshot = await takeBridgeScreenshot(agent);
	if (!screenshot) {
		return [textContent("Screenshot unavailable.")];
	}
	const resized = await resizeSnapshotImage({ type: "image", data: screenshot.data, mimeType: screenshot.mimeType });
	return [textContent(label), { type: "image", data: resized.data, mimeType: resized.mimeType }];
}

export default function midsceneBridgeExtension(pi: ExtensionAPI) {
	const bridgeState = createBridgeState();
	const playwrightState = createPlaywrightState();
	let busy = false;

	pi.registerTool({
		name: TOOL_NAME,
		label: "Browser Bridge",
		description:
			"Use Midscene to control a browser via bridge or Playwright. Prefer bridge unless full-page/isolated sessions are required. Prefer steps or plan (add expect for validation); steps accept type+target/prompt or ai* shorthand (aiTap, aiInput, aiAssert). Snapshots work in bridge (viewport) and Playwright (full page).",
		parameters: BrowserToolInputSchema,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (busy) {
				return {
					content: [textContent("Browser bridge is already running a task.")],
					isError: true,
					details: { error: "busy" },
				};
			}

			busy = true;
			const startedAt = Date.now();
			let runtime: BrowserToolInput["runtime"] = "bridge";
			let snapshotOnError = false;
			try {
				const envStatus = loadMidsceneEnv();
				if (envStatus.missing.length > 0) {
					return {
						content: [textContent(formatMissingEnv(envStatus.missing, envStatus.envPath))],
						isError: true,
						details: { missing: envStatus.missing, envPath: envStatus.envPath },
					};
				}

				const input = params as BrowserToolInput;
				runtime = input.runtime ?? "bridge";
				const rawSteps = input.steps ?? [];
				const plan = input.plan;
				const hasSteps = rawSteps.length > 0;
				const hasTask = typeof input.task === "string" && input.task.trim().length > 0;
				const hasPlan = plan !== undefined;
				const hasPlanYaml = typeof input.planYaml === "string" && input.planYaml.trim().length > 0;
				let normalizedSteps: BrowserStep[] = [];
				const activeModes = [
					hasSteps ? "steps" : null,
					hasTask ? "task" : null,
					hasPlan ? "plan" : null,
					hasPlanYaml ? "planYaml" : null,
				].filter((mode): mode is string => Boolean(mode));
				const wantsSnapshot = input.snapshot ?? activeModes.length > 0;
				snapshotOnError = input.snapshotOnError ?? wantsSnapshot;
				const snapshotFullPage = input.snapshotFullPage ?? true;
				const snapshotOnly = wantsSnapshot && activeModes.length === 0;

				if (activeModes.length === 0 && !snapshotOnly) {
					return {
						content: [textContent("Provide steps, task, plan, or planYaml.")],
						isError: true,
						details: { error: "missing_steps_or_task_or_plan" },
					};
				}
				if (activeModes.length > 1) {
					return {
						content: [textContent("Provide only one of steps, task, plan, or planYaml.")],
						isError: true,
						details: { error: "multiple_inputs", modes: activeModes },
					};
				}

				if (hasSteps) {
					const normalized = normalizeStepsInput(rawSteps);
					if (normalized.errors.length > 0) {
						return {
							content: [textContent(formatStepErrors(normalized.errors))],
							isError: true,
							details: { error: "invalid_steps", errors: normalized.errors },
						};
					}
					normalizedSteps = normalized.steps;
				}

				const planTasks = plan ? normalizePlanTasks(plan) : null;
				if (planTasks && planTasks.errors.length > 0) {
					return {
						content: [textContent(formatPlanErrors(planTasks.errors))],
						isError: true,
						details: { error: "invalid_plan", errors: planTasks.errors },
					};
				}

				const planTarget = resolvePlanTarget(plan?.target);
				if (planTarget.errors.length > 0) {
					return {
						content: [textContent(formatPlanTargetErrors(planTarget.errors))],
						isError: true,
						details: { error: "invalid_plan_target", errors: planTarget.errors },
					};
				}

				const resolvedInput: BrowserToolInput = {
					...input,
					attach: planTarget.attach ?? input.attach,
					url: planTarget.url ?? input.url,
				};

				if (runtime === "playwright") {
					try {
						const status = await ensurePlaywright(playwrightState, resolvedInput);
						const agent = getPlaywrightAgent(playwrightState);
						if (!agent || !getPlaywrightPage(playwrightState)) {
							return {
								content: [textContent("Playwright browser failed to initialize.")],
								isError: true,
								details: { error: "playwright_not_ready" },
							};
						}

						if (snapshotOnly) {
							const content = await buildSnapshotContent(playwrightState, "Browser snapshot.", snapshotFullPage);
							const summary: BrowserRunSummary = {
								connected: status.connected,
								mode: status.mode,
								url: status.url,
								reused: status.reused,
								elapsedMs: Date.now() - startedAt,
								outputs: {},
								steps: [],
							};
							return { content, details: summary };
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
								content: [textContent(message)],
								details: progress,
							});
						};

						if (hasSteps) {
							stepResults.push(
								...(await runBrowserSteps(agent, normalizedSteps, {
									onUpdate: emitUpdate,
									signal,
								})),
							);
							for (const result of stepResults) {
								if (result.saveAs && result.status === "ok") {
									outputs[result.saveAs] = result.output;
								}
							}
						} else if (hasPlan && planTasks) {
							stepResults.push(
								...(await runBrowserPlan(agent, planTasks.tasks, {
									onUpdate: emitUpdate,
									signal,
								})),
							);
							for (const result of stepResults) {
								if (result.saveAs && result.status === "ok") {
									outputs[result.saveAs] = result.output;
								}
							}
						} else if (hasPlanYaml && input.planYaml) {
							emitUpdate("Running YAML plan...");
							const yamlAgent = agent as {
								runYaml?: (script: string) => Promise<{ result?: unknown }>;
							};
							if (!yamlAgent.runYaml) {
								throw new Error("Midscene runYaml is unavailable on this agent.");
							}
							const yamlResult = await yamlAgent.runYaml(input.planYaml);
							outputs.planResult =
								typeof yamlResult === "object" && yamlResult !== null && "result" in yamlResult
									? yamlResult.result
									: yamlResult;
						} else if (hasTask && input.task) {
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

						const content: ToolContent[] = [textContent(formatSuccessMessage(summary))];
						if (wantsSnapshot) {
							content.push(
								...(await buildSnapshotContent(playwrightState, "Browser snapshot.", snapshotFullPage)),
							);
						}

						if (input.closeOnComplete) {
							await destroyPlaywright(playwrightState);
						}

						return {
							content,
							details: summary,
						};
					} catch (error) {
						if (isMissingPlaywrightBrowser(error)) {
							return {
								content: [textContent(formatMissingPlaywrightBrowser())],
								isError: true,
								details: { error: "playwright_browsers_missing" },
							};
						}
						const message = error instanceof Error ? error.message : String(error);
						const content: ToolContent[] = [textContent(`Browser task failed: ${message}`)];
						if (snapshotOnError) {
							content.push(
								...(await buildSnapshotContent(
									playwrightState,
									"Browser snapshot after failure.",
									snapshotFullPage,
								)),
							);
						}
						return {
							content,
							isError: true,
							details: { error: message },
						};
					}
				}

				let lastError: unknown;
				for (let attempt = 0; attempt <= MAX_CONNECTION_RETRIES; attempt += 1) {
					try {
						const status = await ensureBridge(bridgeState, resolvedInput);
						const agent = getBridgeAgent(bridgeState);
						if (!agent) {
							return {
								content: [textContent("Bridge failed to initialize.")],
								isError: true,
								details: { error: "bridge_not_ready" },
							};
						}

						if (snapshotOnly) {
							const content = await buildBridgeSnapshotContent(agent, "Browser snapshot.");
							const summary: BrowserRunSummary = {
								connected: status.connected,
								mode: status.mode,
								url: status.url,
								reused: status.reused,
								elapsedMs: Date.now() - startedAt,
								outputs: {},
								steps: [],
							};
							if (input.closeOnComplete) {
								await destroyBridge(bridgeState);
							}
							return { content, details: summary };
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
								content: [textContent(message)],
								details: progress,
							});
						};

						if (hasSteps) {
							stepResults.push(
								...(await runBrowserSteps(agent, normalizedSteps, {
									onUpdate: emitUpdate,
									signal,
								})),
							);
							for (const result of stepResults) {
								if (result.saveAs && result.status === "ok") {
									outputs[result.saveAs] = result.output;
								}
							}
						} else if (hasPlan && planTasks) {
							stepResults.push(
								...(await runBrowserPlan(agent, planTasks.tasks, {
									onUpdate: emitUpdate,
									signal,
								})),
							);
							for (const result of stepResults) {
								if (result.saveAs && result.status === "ok") {
									outputs[result.saveAs] = result.output;
								}
							}
						} else if (hasPlanYaml && input.planYaml) {
							emitUpdate("Running YAML plan...");
							const yamlAgent = agent as {
								runYaml?: (script: string) => Promise<{ result?: unknown }>;
							};
							if (!yamlAgent.runYaml) {
								throw new Error("Midscene runYaml is unavailable on this agent.");
							}
							const yamlResult = await yamlAgent.runYaml(input.planYaml);
							outputs.planResult =
								typeof yamlResult === "object" && yamlResult !== null && "result" in yamlResult
									? yamlResult.result
									: yamlResult;
						} else if (hasTask && input.task) {
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

						const content: ToolContent[] = [textContent(formatSuccessMessage(summary))];
						if (wantsSnapshot) {
							content.push(...(await buildBridgeSnapshotContent(agent, "Browser snapshot.")));
						}

						if (input.closeOnComplete) {
							await destroyBridge(bridgeState);
						}

						return {
							content,
							details: summary,
						};
					} catch (error) {
						lastError = error;
						if (isNoTabConnected(error)) {
							await destroyBridge(bridgeState);
							if (ctx.hasUI) {
								ctx.ui.notify(formatNoTabConnected(), "warning");
							}
							return {
								content: [textContent(formatNoTabConnected())],
								isError: true,
								details: { error: "no_tab_connected" },
							};
						}
						if (attempt < MAX_CONNECTION_RETRIES && (isConnectionLost(error) || isBridgeCallTimeout(error))) {
							const message = isBridgeCallTimeout(error)
								? "Bridge call timed out. Reconnecting..."
								: "Connection lost. Reconnecting...";
							onUpdate?.(buildProgressUpdate(message, resolvedInput, startedAt));
							await destroyBridge(bridgeState);
							continue;
						}
						throw error;
					}
				}

				throw lastError;
			} catch (error) {
				const addressInUse = getAddressInUse(error);
				if (addressInUse) {
					const portLabel = addressInUse.port ? ` ${addressInUse.port}` : "";
					return {
						content: [
							textContent(
								`Bridge port${portLabel} is already in use. Is another Midscene bridge session running? If yes, stop it or retry with a different port.`,
							),
						],
						isError: true,
						details: { error: "address_in_use", port: addressInUse.port },
					};
				}
				const message = error instanceof Error ? error.message : String(error);
				if (isNoTabConnected(error)) {
					if (ctx.hasUI) {
						ctx.ui.notify(formatNoTabConnected(), "warning");
					}
					return {
						content: [textContent(formatNoTabConnected())],
						isError: true,
						details: { error: "no_tab_connected" },
					};
				}
				if (isBridgeCallTimeout(error)) {
					const content: ToolContent[] = [textContent(formatBridgeCallTimeout(message))];
					if (runtime === "bridge" && snapshotOnError) {
						const agent = getBridgeAgent(bridgeState);
						content.push(...(await buildBridgeSnapshotContent(agent, "Browser snapshot after failure.")));
					}
					return {
						content,
						isError: true,
						details: { error: "bridge_call_timeout", message },
					};
				}
				if (runtime === "bridge" && snapshotOnError) {
					const agent = getBridgeAgent(bridgeState);
					const content: ToolContent[] = [textContent(`Browser task failed: ${message}`)];
					content.push(...(await buildBridgeSnapshotContent(agent, "Browser snapshot after failure.")));
					return {
						content,
						isError: true,
						details: { error: message },
					};
				}
				return {
					content: [textContent(`Browser task failed: ${message}`)],
					isError: true,
					details: { error: message },
				};
			} finally {
				busy = false;
			}
		},
	});

	pi.registerCommand("browser", {
		description: "Manage Midscene browser sessions",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;
			const trimmed = args.trim();
			if (!trimmed || trimmed === "status") {
				const bridgeAgent = getBridgeAgent(bridgeState);
				const bridgeStatus = bridgeAgent ? "connected" : "disconnected";
				const playwrightAgent = getPlaywrightAgent(playwrightState);
				const playwrightStatus = playwrightAgent ? "connected" : "disconnected";
				ctx.ui.notify(`Browser bridge ${bridgeStatus}. Playwright ${playwrightStatus}.`, "info");
				return;
			}
			if (trimmed === "close") {
				await destroyBridge(bridgeState);
				await destroyPlaywright(playwrightState);
				ctx.ui.notify("Browser sessions closed.", "info");
				return;
			}
			ctx.ui.notify("Unknown command. Try /browser status or /browser close.", "warning");
		},
	});

	pi.on("session_shutdown", async () => {
		await destroyBridge(bridgeState);
		await destroyPlaywright(playwrightState);
	});
}
