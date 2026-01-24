import { StringEnum } from "@mariozechner/pi-ai";
import { Type, type Static } from "@sinclair/typebox";

export const BrowserConnectModeSchema = StringEnum(["current_tab", "new_tab"] as const);
export type BrowserConnectMode = Static<typeof BrowserConnectModeSchema>;

export const BrowserStepTypeSchema = StringEnum(
	[
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
	] as const,
);
export type BrowserStepType = Static<typeof BrowserStepTypeSchema>;

export const BrowserInputModeSchema = StringEnum(["replace", "append", "clear"] as const);
export type BrowserInputMode = Static<typeof BrowserInputModeSchema>;

export const BrowserScrollDirectionSchema = StringEnum(["up", "down", "left", "right"] as const);
export type BrowserScrollDirection = Static<typeof BrowserScrollDirectionSchema>;

export const BrowserScrollTypeSchema = StringEnum(
	[
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
	] as const,
);
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
		mode: Type.Optional(BrowserInputModeSchema),
		direction: Type.Optional(BrowserScrollDirectionSchema),
		scrollType: Type.Optional(BrowserScrollTypeSchema),
		url: Type.Optional(Type.String({ description: "URL to navigate to" })),
		ms: Type.Optional(Type.Number({ description: "Sleep duration in milliseconds" })),
		saveAs: Type.Optional(Type.String({ description: "Key to store any output" })),
	},
	{ additionalProperties: false },
);
export type BrowserStep = Static<typeof BrowserStepSchema>;

export const BrowserToolInputSchema = Type.Object(
	{
		attach: Type.Optional(BrowserConnectModeSchema),
		url: Type.Optional(Type.String({ description: "URL to open when attaching a new tab" })),
		task: Type.Optional(Type.String({ description: "High-level instruction for the agent" })),
		steps: Type.Optional(Type.Array(BrowserStepSchema, { minItems: 1 })),
		cache: Type.Optional(BrowserCacheSchema),
		cacheId: Type.Optional(Type.String({ description: "Legacy cache ID for MIDSCENE_CACHE compatibility" })),
		forceSameTabNavigation: Type.Optional(
			Type.Boolean({ description: "Keep navigation in the same tab for stability" }),
		),
		generateReport: Type.Optional(Type.Boolean({ description: "Enable Midscene report generation" })),
	waitForNavigationTimeout: Type.Optional(
		Type.Number({ description: "Navigation wait timeout in milliseconds" }),
	),
	waitForNetworkIdleTimeout: Type.Optional(
		Type.Number({ description: "Network idle wait timeout in milliseconds" }),
	),
		closeOnComplete: Type.Optional(Type.Boolean({ description: "Close bridge after completion" })),
		reset: Type.Optional(Type.Boolean({ description: "Reset bridge before running" })),
		allowRemoteAccess: Type.Optional(Type.Boolean({ description: "Allow remote bridge connections" })),
		host: Type.Optional(Type.String({ description: "Bridge server host (overrides allowRemoteAccess)" })),
		port: Type.Optional(Type.Number({ description: "Bridge server port" })),
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
