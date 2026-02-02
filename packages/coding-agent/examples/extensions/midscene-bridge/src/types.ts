import { StringEnum } from "@mariozechner/pi-ai";
import { type Static, Type } from "@sinclair/typebox";

export const BrowserConnectModeSchema = StringEnum(["current_tab", "new_tab"] as const);
export type BrowserConnectMode = Static<typeof BrowserConnectModeSchema>;

export const BrowserRuntimeSchema = StringEnum(["bridge", "playwright"] as const);
export type BrowserRuntime = Static<typeof BrowserRuntimeSchema>;

export const BrowserStepTypeSchema = StringEnum([
	"act",
	"wait_for",
	"assert",
	"tap",
	"input",
	"scroll",
	"hover",
	"number",
	"string",
	"boolean",
	"query",
	"navigate",
	"reload",
	"back",
	"sleep",
] as const);
export type BrowserStepType = Static<typeof BrowserStepTypeSchema>;

export const BrowserInputModeSchema = StringEnum(["replace", "append", "clear", "typeOnly"] as const);
export type BrowserInputMode = Static<typeof BrowserInputModeSchema>;

export const BrowserScrollDirectionSchema = StringEnum(["up", "down", "left", "right"] as const);
export type BrowserScrollDirection = Static<typeof BrowserScrollDirectionSchema>;

export const BrowserScrollTypeSchema = StringEnum([
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
] as const);
export type BrowserScrollType = Static<typeof BrowserScrollTypeSchema>;

export const BrowserCacheStrategySchema = StringEnum(["read-only", "read-write", "write-only"] as const);
export type BrowserCacheStrategy = Static<typeof BrowserCacheStrategySchema>;

export const BrowserCacheConfigSchema = Type.Object(
	{
		id: Type.String({ description: "Cache ID for planning and locate results" }),
		strategy: Type.Optional(BrowserCacheStrategySchema),
	},
	{ additionalProperties: false },
);
export const BrowserCacheSchema = Type.Union([Type.Boolean(), BrowserCacheConfigSchema]);
export type BrowserCache = Static<typeof BrowserCacheSchema>;

export const BrowserStepSchema = Type.Object(
	{
		type: BrowserStepTypeSchema,
		prompt: Type.Optional(Type.String({ description: "Instruction or query text" })),
		target: Type.Optional(Type.String({ description: "Target element or UI label" })),
		text: Type.Optional(Type.String({ description: "Input text for input steps" })),
		value: Type.Optional(Type.String({ description: "Input text alias for input steps" })),
		mode: Type.Optional(BrowserInputModeSchema),
		direction: Type.Optional(BrowserScrollDirectionSchema),
		scrollType: Type.Optional(BrowserScrollTypeSchema),
		url: Type.Optional(Type.String({ description: "URL to navigate to" })),
		ms: Type.Optional(Type.Number({ description: "Sleep duration in milliseconds" })),
		saveAs: Type.Optional(Type.String({ description: "Key to store any output" })),
		expect: Type.Optional(Type.String({ description: "Assertion to validate after the step" })),
	},
	{ additionalProperties: false },
);
export type BrowserStep = Static<typeof BrowserStepSchema>;

export const BrowserPlanBridgeModeSchema = StringEnum(["currentTab", "newTabWithUrl"] as const);
export type BrowserPlanBridgeMode = Static<typeof BrowserPlanBridgeModeSchema>;

export const BrowserPlanTargetSchema = Type.Object(
	{
		url: Type.Optional(Type.String({ description: "Target URL for bridge mode" })),
		bridgeMode: Type.Optional(BrowserPlanBridgeModeSchema),
	},
	{ additionalProperties: false },
);
export type BrowserPlanTarget = Static<typeof BrowserPlanTargetSchema>;

const BrowserPlanInputParamsSchema = Type.Object(
	{
		target: Type.Optional(Type.String()),
		prompt: Type.Optional(Type.String()),
		text: Type.Optional(Type.String()),
		value: Type.Optional(Type.String()),
		mode: Type.Optional(BrowserInputModeSchema),
	},
	{ additionalProperties: false },
);

const BrowserPlanScrollParamsSchema = Type.Object(
	{
		direction: Type.Optional(BrowserScrollDirectionSchema),
		scrollType: Type.Optional(BrowserScrollTypeSchema),
		target: Type.Optional(Type.String()),
		prompt: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const BrowserPlanSleepSchema = Type.Union([
	Type.Number(),
	Type.Object({ ms: Type.Number() }, { additionalProperties: false }),
]);

export const BrowserPlanStepSchema = Type.Union([
	BrowserStepSchema,
	Type.Object(
		{
			ai: Type.String(),
			saveAs: Type.Optional(Type.String()),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			aiAct: Type.String(),
			saveAs: Type.Optional(Type.String()),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			aiAssert: Type.String(),
			saveAs: Type.Optional(Type.String()),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			aiWaitFor: Type.String(),
			saveAs: Type.Optional(Type.String()),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			aiTap: Type.String(),
			saveAs: Type.Optional(Type.String()),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			aiHover: Type.String(),
			saveAs: Type.Optional(Type.String()),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			aiInput: BrowserPlanInputParamsSchema,
			saveAs: Type.Optional(Type.String()),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			aiScroll: Type.Union([BrowserScrollDirectionSchema, BrowserPlanScrollParamsSchema]),
			saveAs: Type.Optional(Type.String()),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			aiQuery: Type.String(),
			saveAs: Type.Optional(Type.String()),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			aiNumber: Type.String(),
			saveAs: Type.Optional(Type.String()),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			aiString: Type.String(),
			saveAs: Type.Optional(Type.String()),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			aiBoolean: Type.String(),
			saveAs: Type.Optional(Type.String()),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			sleep: BrowserPlanSleepSchema,
			saveAs: Type.Optional(Type.String()),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			navigate: Type.String(),
			saveAs: Type.Optional(Type.String()),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			reload: Type.Boolean(),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			back: Type.Boolean(),
		},
		{ additionalProperties: false },
	),
]);
export type BrowserPlanStep = Static<typeof BrowserPlanStepSchema>;

export const BrowserPlanTaskSchema = Type.Object(
	{
		name: Type.Optional(Type.String()),
		flow: Type.Array(BrowserPlanStepSchema, { minItems: 1 }),
	},
	{ additionalProperties: false },
);
export type BrowserPlanTask = Static<typeof BrowserPlanTaskSchema>;

export const BrowserPlanSchema = Type.Object(
	{
		target: Type.Optional(BrowserPlanTargetSchema),
		tasks: Type.Array(BrowserPlanTaskSchema, { minItems: 1 }),
	},
	{ additionalProperties: false },
);
export type BrowserPlan = Static<typeof BrowserPlanSchema>;

export const BrowserToolInputSchema = Type.Object(
	{
		runtime: Type.Optional(BrowserRuntimeSchema),
		attach: Type.Optional(BrowserConnectModeSchema),
		url: Type.Optional(Type.String({ description: "URL to open when attaching a new tab" })),
		task: Type.Optional(Type.String({ description: "High-level instruction for the agent" })),
		steps: Type.Optional(
			Type.Array(BrowserPlanStepSchema, {
				minItems: 1,
				description:
					"Steps can use { type, target, prompt, text/value } or ai* shorthand (aiTap, aiInput, aiAssert, aiWaitFor, aiQuery, aiNumber, aiString, aiBoolean, aiHover, aiScroll, aiAct).",
			}),
		),
		plan: Type.Optional(BrowserPlanSchema),
		planYaml: Type.Optional(Type.String({ description: "YAML plan for agent.runYaml" })),
		cache: Type.Optional(BrowserCacheSchema),
		cacheId: Type.Optional(Type.String({ description: "Legacy cache ID for MIDSCENE_CACHE compatibility" })),
		forceSameTabNavigation: Type.Optional(
			Type.Boolean({ description: "Keep navigation in the same tab for stability" }),
		),
		generateReport: Type.Optional(Type.Boolean({ description: "Enable Midscene report generation" })),
		waitForNavigationTimeout: Type.Optional(Type.Number({ description: "Navigation wait timeout in milliseconds" })),
		waitForNetworkIdleTimeout: Type.Optional(
			Type.Number({ description: "Network idle wait timeout in milliseconds" }),
		),
		headless: Type.Optional(Type.Boolean({ description: "Playwright headless mode" })),
		viewport: Type.Optional(
			Type.Object(
				{
					width: Type.Number({ description: "Viewport width in pixels" }),
					height: Type.Number({ description: "Viewport height in pixels" }),
				},
				{ additionalProperties: false },
			),
		),
		snapshot: Type.Optional(
			Type.Boolean({ description: "Include a screenshot in the tool result (bridge captures viewport)" }),
		),
		snapshotOnError: Type.Optional(
			Type.Boolean({ description: "Include a screenshot when a run fails (bridge captures viewport)" }),
		),
		snapshotFullPage: Type.Optional(Type.Boolean({ description: "Capture full-page screenshots (Playwright only)" })),
		closeOnComplete: Type.Optional(Type.Boolean({ description: "Close browser session after completion" })),
		reset: Type.Optional(Type.Boolean({ description: "Reset browser session before running" })),
		allowRemoteAccess: Type.Optional(Type.Boolean({ description: "Allow remote bridge connections" })),
		host: Type.Optional(Type.String({ description: "Bridge server host (overrides allowRemoteAccess)" })),
		port: Type.Optional(Type.Number({ description: "Bridge server port" })),
		closeConflictServer: Type.Optional(
			Type.Boolean({ description: "Close an existing bridge server on the same port before listening" }),
		),
		closeNewTabsAfterDisconnect: Type.Optional(
			Type.Boolean({ description: "Close bridge-created tabs on disconnect" }),
		),
	},
	{ additionalProperties: false },
);
export type BrowserToolInput = Static<typeof BrowserToolInputSchema>;

export type BrowserStepResult = {
	type: BrowserStepType;
	status: "ok" | "error";
	message?: string;
	output?: unknown;
	saveAs?: string;
};

export type BrowserRunSummary = {
	connected: boolean;
	mode: BrowserConnectMode;
	url?: string;
	reused: boolean;
	elapsedMs: number;
	outputs: Record<string, unknown>;
	steps: BrowserStepResult[];
};
