import type { AgentOverChromeBridge } from "@midscene/web/bridge-mode";
import type { BrowserStep, BrowserStepResult } from "./types.js";

type MidsceneAgent = Pick<
	AgentOverChromeBridge,
	| "aiAct"
	| "aiWaitFor"
	| "aiAssert"
	| "aiTap"
	| "aiHover"
	| "aiInput"
	| "aiScroll"
	| "aiNumber"
	| "aiString"
	| "aiBoolean"
	| "aiQuery"
>;

type RunOptions = {
	onUpdate?: (message: string) => void;
	signal?: AbortSignal;
};

type ScrollType = NonNullable<BrowserStep["scrollType"]>;

const scrollTypeMap: Record<ScrollType, "singleAction" | "scrollToBottom" | "scrollToTop" | "scrollToRight" | "scrollToLeft"> =
	{
		singleAction: "singleAction",
		scrollToBottom: "scrollToBottom",
		scrollToTop: "scrollToTop",
		scrollToRight: "scrollToRight",
		scrollToLeft: "scrollToLeft",
		once: "singleAction",
		page: "singleAction",
		toBottom: "scrollToBottom",
		toTop: "scrollToTop",
		toRight: "scrollToRight",
		toLeft: "scrollToLeft",
	};

const stepPrompts: Record<BrowserStep["type"], (step: BrowserStep) => string> = {
	act: (s) => s.prompt ?? "",
	wait_for: (s) => s.prompt ?? "",
	assert: (s) => s.prompt ?? "",
	tap: (s) => s.target ?? "",
	input: (s) => s.target ?? "",
	scroll: (s) => s.direction ?? "down",
	hover: (s) => s.target ?? "",
	number: (s) => s.prompt ?? "",
	string: (s) => s.prompt ?? "",
	boolean: (s) => s.prompt ?? "",
	query: (s) => s.prompt ?? "",
	navigate: (s) => s.url ?? "",
	reload: () => "reload",
	back: () => "back",
	sleep: (s) => `${s.ms ?? 0}ms`,
};

function requiredField(step: BrowserStep, field: keyof BrowserStep): string | undefined {
	const value = step[field];
	if (value === undefined || value === null || value === "") {
		return `${step.type} requires ${field}`;
	}
	return undefined;
}

export function validateSteps(steps: BrowserStep[]): string[] {
	const errors: string[] = [];
	for (const step of steps) {
		switch (step.type) {
			case "act":
			case "wait_for":
			case "assert":
			case "number":
			case "string":
			case "boolean":
			case "query": {
				const err = requiredField(step, "prompt");
				if (err) errors.push(err);
				break;
			}
			case "tap":
			case "hover": {
				const err = requiredField(step, "target");
				if (err) errors.push(err);
				break;
			}
			case "input": {
				const err = requiredField(step, "target");
				if (err) errors.push(err);
				if (step.mode !== "clear") {
					const textErr = requiredField(step, "text");
					if (textErr) errors.push(textErr);
				}
				break;
			}
			case "scroll": {
				break;
			}
			case "navigate": {
				const err = requiredField(step, "url");
				if (err) errors.push(err);
				break;
			}
			case "sleep": {
				const err = requiredField(step, "ms");
				if (err) errors.push(err);
				break;
			}
			case "reload":
			case "back": {
				break;
			}
			default: {
				break;
			}
		}
	}
	return errors;
}

function stepLabel(step: BrowserStep): string {
	const prompt = stepPrompts[step.type]?.(step);
	return prompt ? `${step.type}: ${prompt}` : step.type;
}

function normalizeScrollType(scrollType?: BrowserStep["scrollType"]): "singleAction" | "scrollToBottom" | "scrollToTop" | "scrollToRight" | "scrollToLeft" | undefined {
	if (!scrollType) return undefined;
	return scrollTypeMap[scrollType];
}

async function runStep(agent: MidsceneAgent, step: BrowserStep): Promise<unknown> {
	switch (step.type) {
		case "act":
			return agent.aiAct(step.prompt ?? "");
		case "wait_for":
			return agent.aiWaitFor(step.prompt ?? "");
		case "assert":
			return agent.aiAssert(step.prompt ?? "");
		case "tap":
			return agent.aiTap(step.target ?? "");
		case "hover":
			return agent.aiHover(step.target ?? "");
		case "input": {
			const mode = step.mode ?? "replace";
			const text = step.text ?? "";
			return agent.aiInput(step.target ?? "", text, { mode });
		}
		case "scroll": {
			const direction = step.direction ?? "down";
			const scrollType = normalizeScrollType(step.scrollType);
			return agent.aiScroll(scrollType ? { direction, scrollType } : { direction });
		}
		case "number":
			return agent.aiNumber(step.prompt ?? "");
		case "string":
			return agent.aiString(step.prompt ?? "");
		case "boolean":
			return agent.aiBoolean(step.prompt ?? "");
		case "query":
			return agent.aiQuery(step.prompt ?? "");
		case "navigate":
			return agent.aiAct(`navigate to ${step.url ?? ""}`);
		case "reload":
			return agent.aiAct("reload the page");
		case "back":
			return agent.aiAct("go back");
		case "sleep":
			await new Promise((resolve) => setTimeout(resolve, step.ms ?? 0));
			return undefined;
		default:
			return undefined;
	}
}

export async function runBrowserSteps(
	agent: MidsceneAgent,
	steps: BrowserStep[],
	options: RunOptions,
): Promise<BrowserStepResult[]> {
	const results: BrowserStepResult[] = [];
	for (let i = 0; i < steps.length; i += 1) {
		if (options.signal?.aborted) {
			throw new Error("Browser run aborted");
		}
		const step = steps[i];
		options.onUpdate?.(`Step ${i + 1}/${steps.length} - ${stepLabel(step)}`);
		try {
			const output = await runStep(agent, step);
			results.push({
				type: step.type,
				status: "ok",
				output,
				saveAs: step.saveAs,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			results.push({
				type: step.type,
				status: "error",
				message,
				saveAs: step.saveAs,
			});
			throw error;
		}
	}
	return results;
}
