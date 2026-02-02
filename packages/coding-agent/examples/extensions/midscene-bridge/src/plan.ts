import { runBrowserSteps, validateSteps } from "./actions.js";
import type {
	BrowserConnectMode,
	BrowserInputMode,
	BrowserPlan,
	BrowserPlanStep,
	BrowserPlanTarget,
	BrowserScrollDirection,
	BrowserScrollType,
	BrowserStep,
	BrowserStepResult,
} from "./types.js";

type PlanTask = {
	name?: string;
	steps: BrowserStep[];
};

type PlanNormalizationResult = {
	tasks: PlanTask[];
	errors: string[];
};

type PlanTargetResolution = {
	attach?: BrowserConnectMode;
	url?: string;
	errors: string[];
};

const planStepNames = [
	"ai",
	"aiAct",
	"aiAssert",
	"aiWaitFor",
	"aiTap",
	"aiHover",
	"aiInput",
	"aiScroll",
	"aiQuery",
	"aiNumber",
	"aiString",
	"aiBoolean",
	"sleep",
	"navigate",
	"reload",
	"back",
] as const;

const inputModes = new Set<BrowserInputMode>(["replace", "append", "clear", "typeOnly"]);
const scrollDirections = new Set<BrowserScrollDirection>(["up", "down", "left", "right"]);
const scrollTypes = new Set<BrowserScrollType>([
	"singleAction",
	"scrollToBottom",
	"scrollToTop",
	"scrollToRight",
	"scrollToLeft",
	"once",
	"page",
	"toBottom",
	"toTop",
	"toRight",
	"toLeft",
]);

function formatPlanStepList(): string {
	return planStepNames.join(", ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isBrowserStep(step: BrowserPlanStep): step is BrowserStep {
	if (!isRecord(step)) return false;
	return typeof (step as Record<string, unknown>).type === "string";
}

function getSaveAs(step: BrowserPlanStep): string | undefined {
	if (!isRecord(step)) return undefined;
	const saveAs = (step as Record<string, unknown>).saveAs;
	return typeof saveAs === "string" ? saveAs : undefined;
}

function getString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeInputMode(value: unknown): BrowserInputMode | undefined {
	if (typeof value !== "string") return undefined;
	if (value === "append") return "typeOnly";
	return inputModes.has(value as BrowserInputMode) ? (value as BrowserInputMode) : undefined;
}

function normalizeScrollDirection(value: unknown): BrowserScrollDirection | undefined {
	if (typeof value !== "string") return undefined;
	return scrollDirections.has(value as BrowserScrollDirection) ? (value as BrowserScrollDirection) : undefined;
}

function normalizeScrollType(value: unknown): BrowserScrollType | undefined {
	if (typeof value !== "string") return undefined;
	return scrollTypes.has(value as BrowserScrollType) ? (value as BrowserScrollType) : undefined;
}

function normalizeBrowserStep(step: BrowserStep): BrowserStep {
	let normalized = step;
	if (
		(step.type === "tap" || step.type === "hover" || step.type === "input" || step.type === "scroll") &&
		!step.target
	) {
		const promptTarget = step.prompt?.trim();
		if (promptTarget) {
			normalized = { ...normalized, target: promptTarget };
		}
	}
	if (step.type === "input" && step.text === undefined && step.value !== undefined) {
		if (normalized === step) {
			normalized = { ...normalized };
		}
		normalized.text = step.value;
	}
	return normalized;
}

function convertPlanStep(step: BrowserPlanStep): { step?: BrowserStep; error?: string } {
	if (isBrowserStep(step)) {
		return { step: normalizeBrowserStep(step) };
	}

	const saveAs = getSaveAs(step);

	if ("aiAct" in step) {
		const prompt = getString(step.aiAct);
		if (!prompt) return { error: "aiAct must be a non-empty string" };
		return { step: { type: "act", prompt, saveAs } };
	}
	if ("ai" in step) {
		const prompt = getString(step.ai);
		if (!prompt) return { error: "ai must be a non-empty string" };
		return { step: { type: "act", prompt, saveAs } };
	}
	if ("aiAssert" in step) {
		const prompt = getString(step.aiAssert);
		if (!prompt) return { error: "aiAssert must be a non-empty string" };
		return { step: { type: "assert", prompt, saveAs } };
	}
	if ("aiWaitFor" in step) {
		const prompt = getString(step.aiWaitFor);
		if (!prompt) return { error: "aiWaitFor must be a non-empty string" };
		return { step: { type: "wait_for", prompt, saveAs } };
	}
	if ("aiTap" in step) {
		const target = getString(step.aiTap);
		if (!target) return { error: "aiTap must be a non-empty string" };
		return { step: { type: "tap", target, saveAs } };
	}
	if ("aiHover" in step) {
		const target = getString(step.aiHover);
		if (!target) return { error: "aiHover must be a non-empty string" };
		return { step: { type: "hover", target, saveAs } };
	}
	if ("aiInput" in step) {
		const payload = step.aiInput;
		if (!isRecord(payload)) {
			return { error: "aiInput must be an object with target/text or prompt/value" };
		}
		const target = getString(payload.target) ?? getString(payload.prompt);
		const text = getString(payload.text) ?? getString(payload.value);
		if (!target || !text) {
			return { error: "aiInput requires target and text (or prompt and value)" };
		}
		const mode = normalizeInputMode(payload.mode);
		return { step: { type: "input", target, text, mode, saveAs } };
	}
	if ("aiScroll" in step) {
		const payload = step.aiScroll;
		if (typeof payload === "string") {
			return { step: { type: "scroll", direction: normalizeScrollDirection(payload), saveAs } };
		}
		if (!isRecord(payload)) {
			return { error: "aiScroll must be a string or object" };
		}
		const direction = normalizeScrollDirection(payload.direction);
		const scrollType = normalizeScrollType(payload.scrollType);
		const target = getString(payload.target) ?? getString(payload.prompt);
		return { step: { type: "scroll", direction, scrollType, target, saveAs } };
	}
	if ("aiQuery" in step) {
		const prompt = getString(step.aiQuery);
		if (!prompt) return { error: "aiQuery must be a non-empty string" };
		return { step: { type: "query", prompt, saveAs } };
	}
	if ("aiNumber" in step) {
		const prompt = getString(step.aiNumber);
		if (!prompt) return { error: "aiNumber must be a non-empty string" };
		return { step: { type: "number", prompt, saveAs } };
	}
	if ("aiString" in step) {
		const prompt = getString(step.aiString);
		if (!prompt) return { error: "aiString must be a non-empty string" };
		return { step: { type: "string", prompt, saveAs } };
	}
	if ("aiBoolean" in step) {
		const prompt = getString(step.aiBoolean);
		if (!prompt) return { error: "aiBoolean must be a non-empty string" };
		return { step: { type: "boolean", prompt, saveAs } };
	}
	if ("sleep" in step) {
		const payload = step.sleep;
		const ms = typeof payload === "number" ? payload : isRecord(payload) ? payload.ms : undefined;
		if (typeof ms !== "number") return { error: "sleep must be a number or { ms: number }" };
		return { step: { type: "sleep", ms, saveAs } };
	}
	if ("navigate" in step) {
		const url = getString(step.navigate);
		if (!url) return { error: "navigate must be a non-empty string" };
		return { step: { type: "navigate", url, saveAs } };
	}
	if ("reload" in step) {
		return { step: { type: "reload", saveAs } };
	}
	if ("back" in step) {
		return { step: { type: "back", saveAs } };
	}

	return {
		error: `Unsupported plan step. Use one of: ${formatPlanStepList()}`,
	};
}

function formatTaskLabel(task: PlanTask, index: number, total: number): string {
	const name = task.name?.trim();
	if (name) return `Task ${index + 1}/${total} (${name})`;
	return `Task ${index + 1}/${total}`;
}

export function normalizeStepsInput(steps: BrowserPlanStep[]): { steps: BrowserStep[]; errors: string[] } {
	const errors: string[] = [];
	const normalized: BrowserStep[] = [];
	steps.forEach((step, index) => {
		const converted = convertPlanStep(step);
		if (converted.error) {
			errors.push(`step ${index + 1}: ${converted.error}`);
			return;
		}
		if (converted.step) {
			normalized.push(normalizeBrowserStep(converted.step));
		}
	});
	const stepErrors = validateSteps(normalized);
	for (const error of stepErrors) {
		errors.push(error);
	}
	return { steps: normalized, errors };
}

export function normalizePlanTasks(plan: BrowserPlan): PlanNormalizationResult {
	const errors: string[] = [];
	const tasks: PlanTask[] = [];
	plan.tasks.forEach((task, taskIndex) => {
		const label = task.name ? `task "${task.name}"` : `task ${taskIndex + 1}`;
		const steps: BrowserStep[] = [];
		task.flow.forEach((flowStep, stepIndex) => {
			const converted = convertPlanStep(flowStep);
			if (converted.error) {
				errors.push(`${label} step ${stepIndex + 1}: ${converted.error}`);
				return;
			}
			if (converted.step) {
				steps.push(normalizeBrowserStep(converted.step));
			}
		});
		const stepErrors = validateSteps(steps);
		for (const error of stepErrors) {
			errors.push(`${label}: ${error}`);
		}
		tasks.push({ name: task.name, steps });
	});
	return { tasks, errors };
}

export function resolvePlanTarget(target?: BrowserPlanTarget): PlanTargetResolution {
	const errors: string[] = [];
	if (!target) return { errors };
	const attachMap: Record<NonNullable<BrowserPlanTarget["bridgeMode"]>, BrowserConnectMode> = {
		currentTab: "current_tab",
		newTabWithUrl: "new_tab",
	};
	const attach = target.bridgeMode ? attachMap[target.bridgeMode] : undefined;
	const url = target.url?.trim() || undefined;
	const resolvedAttach = attach ?? (url ? "new_tab" : undefined);
	if (resolvedAttach === "new_tab" && !url) {
		errors.push("plan.target.url is required when bridgeMode is newTabWithUrl");
	}
	return { attach: resolvedAttach, url, errors };
}

export async function runBrowserPlan(
	agent: Parameters<typeof runBrowserSteps>[0],
	tasks: PlanTask[],
	options: Parameters<typeof runBrowserSteps>[2],
): Promise<BrowserStepResult[]> {
	const results: BrowserStepResult[] = [];
	for (let i = 0; i < tasks.length; i += 1) {
		if (options.signal?.aborted) {
			throw new Error("Browser run aborted");
		}
		const task = tasks[i];
		const taskLabel = formatTaskLabel(task, i, tasks.length);
		const onUpdate = options.onUpdate
			? (message: string) => {
					options.onUpdate?.(`${taskLabel} - ${message}`);
				}
			: undefined;
		results.push(
			...(await runBrowserSteps(agent, task.steps, {
				onUpdate,
				signal: options.signal,
			})),
		);
	}
	return results;
}
