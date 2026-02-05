import { createRequire } from "node:module";
import type { BrowserCache } from "./types.js";

const require = createRequire(import.meta.url);

export type MidsceneInputMode = "replace" | "typeOnly" | "clear";
export type MidsceneScrollDirection = "up" | "down" | "left" | "right";
export type MidsceneScrollType = "singleAction" | "scrollToBottom" | "scrollToTop" | "scrollToRight" | "scrollToLeft";

export type MidsceneAgent = {
	aiAct: (prompt: string) => Promise<unknown>;
	aiWaitFor: (prompt: string) => Promise<unknown>;
	aiAssert: (prompt: string) => Promise<unknown>;
	aiTap: (target: string) => Promise<unknown>;
	aiHover: (target: string) => Promise<unknown>;
	aiInput: (target: string, options: { value: string; mode?: MidsceneInputMode }) => Promise<unknown>;
	aiScroll: (
		target?: string,
		options?: { direction?: MidsceneScrollDirection; scrollType?: MidsceneScrollType },
	) => Promise<unknown>;
	aiNumber: (prompt: string) => Promise<unknown>;
	aiString: (prompt: string) => Promise<unknown>;
	aiBoolean: (prompt: string) => Promise<unknown>;
	aiQuery: (prompt: string) => Promise<unknown>;
	runYaml?: (script: string) => Promise<{ result?: unknown }>;
};

export type BridgeAgentOptions = {
	generateReport: boolean;
	cache?: BrowserCache;
	cacheId?: string;
	waitForNavigationTimeout: number;
	waitForNetworkIdleTimeout: number;
	allowRemoteAccess?: boolean;
	host?: string;
	port?: number;
	closeNewTabsAfterDisconnect?: boolean;
	closeConflictServer: boolean;
};

export type BridgeAgent = MidsceneAgent & {
	connectNewTabWithUrl: (url: string, options: { forceSameTabNavigation?: boolean }) => Promise<void>;
	connectCurrentTab: (options: { forceSameTabNavigation?: boolean }) => Promise<void>;
	destroy: (closeTabs?: boolean) => Promise<void>;
	page?: unknown;
};

export type BridgeModule = {
	AgentOverChromeBridge: new (options: BridgeAgentOptions) => BridgeAgent;
	killRunningServer: (port: number, host: string) => Promise<void>;
};

let cachedBridgeModule: BridgeModule | null = null;

export function getBridgeModule(): BridgeModule {
	if (!cachedBridgeModule) {
		cachedBridgeModule = require("@midscene/web/bridge-mode") as BridgeModule;
	}
	return cachedBridgeModule;
}

export type ScreenshotBuffer = {
	toString: (encoding: "base64") => string;
};

export type Page = {
	close: () => Promise<void>;
	goto: (url: string) => Promise<void>;
	screenshot: (options: { type: "png"; fullPage: boolean }) => Promise<ScreenshotBuffer>;
};

export type BrowserContext = {
	newPage: () => Promise<Page>;
	close: () => Promise<void>;
};

export type Browser = {
	newContext: (options?: { viewport?: { width: number; height: number } }) => Promise<BrowserContext>;
	close: () => Promise<void>;
};

export type ChromiumLauncher = {
	launch: (options: { headless: boolean }) => Promise<Browser>;
};

export type PlaywrightRuntimeModule = {
	chromium: ChromiumLauncher;
};

let cachedPlaywrightRuntime: PlaywrightRuntimeModule | null = null;

export function getPlaywrightRuntime(): PlaywrightRuntimeModule {
	if (!cachedPlaywrightRuntime) {
		cachedPlaywrightRuntime = require("playwright") as PlaywrightRuntimeModule;
	}
	return cachedPlaywrightRuntime;
}

export type PlaywrightAgentOptions = {
	generateReport: boolean;
	cache?: BrowserCache;
	cacheId?: string;
	forceSameTabNavigation: boolean;
	waitForNavigationTimeout: number;
	waitForNetworkIdleTimeout: number;
};

export type PlaywrightAgent = MidsceneAgent;

export type PlaywrightAgentModule = {
	PlaywrightAgent: new (page: Page, options: PlaywrightAgentOptions) => PlaywrightAgent;
};

let cachedPlaywrightAgentModule: PlaywrightAgentModule | null = null;

export function getPlaywrightAgentModule(): PlaywrightAgentModule {
	if (!cachedPlaywrightAgentModule) {
		cachedPlaywrightAgentModule = require("@midscene/web/playwright") as PlaywrightAgentModule;
	}
	return cachedPlaywrightAgentModule;
}

export type ImageInfo = { width: number; height: number };
export type ParsedBase64 = { body: string; mimeType: string };

export type ImageModule = {
	createImgBase64ByFormat: (format: string, data: string) => string;
	imageInfoOfBase64: (base64: string) => Promise<ImageInfo>;
	parseBase64: (base64: string) => ParsedBase64;
	resizeImgBase64: (base64: string, size: { width: number; height: number }) => Promise<string>;
};

let cachedImageModule: ImageModule | null = null;

export function getImageModule(): ImageModule {
	if (!cachedImageModule) {
		cachedImageModule = require("@midscene/shared/img") as ImageModule;
	}
	return cachedImageModule;
}
