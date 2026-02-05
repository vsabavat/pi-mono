import type { Browser, BrowserContext, Page, PlaywrightAgent, PlaywrightAgentOptions } from "./deps.js";
import { getPlaywrightAgentModule, getPlaywrightRuntime } from "./deps.js";
import type { BrowserCache, BrowserConnectMode, BrowserToolInput } from "./types.js";

const { PlaywrightAgent: PlaywrightAgentCtor } = getPlaywrightAgentModule();
const { chromium } = getPlaywrightRuntime();

type PlaywrightConfig = {
	headless: boolean;
	viewport?: { width: number; height: number };
	forceSameTabNavigation: boolean;
	waitForNavigationTimeout: number;
	waitForNetworkIdleTimeout: number;
	generateReport: boolean;
	cache?: BrowserCache;
	cacheId?: string;
};

type PlaywrightState = {
	browser: Browser | null;
	context: BrowserContext | null;
	page: Page | null;
	agent: PlaywrightAgent | null;
	mode: BrowserConnectMode | null;
	url: string | null;
	config: PlaywrightConfig | null;
};

export type PlaywrightStatus = {
	connected: boolean;
	mode: BrowserConnectMode;
	url?: string;
	reused: boolean;
};

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const DEFAULT_WAIT_FOR_NAVIGATION_TIMEOUT = 3000;
const DEFAULT_WAIT_FOR_NETWORK_IDLE_TIMEOUT = 1000;

export function createPlaywrightState(): PlaywrightState {
	return {
		browser: null,
		context: null,
		page: null,
		agent: null,
		mode: null,
		url: null,
		config: null,
	};
}

function isTruthy(value?: string): boolean {
	if (!value) return false;
	const normalized = value.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function normalizeCache(input: BrowserToolInput): { cache?: BrowserCache; cacheId?: string } {
	if (input.cache !== undefined) {
		if (input.cache === true) {
			const cacheId = input.cacheId ?? process.env.MIDSCENE_CACHE_ID ?? "pi-bridge-cache";
			return { cache: { id: cacheId }, cacheId };
		}
		return { cache: input.cache, cacheId: input.cacheId };
	}

	const cacheId = input.cacheId ?? process.env.MIDSCENE_CACHE_ID;
	if (isTruthy(process.env.MIDSCENE_CACHE)) {
		return { cache: { id: cacheId ?? "pi-bridge-cache" }, cacheId };
	}

	if (cacheId) {
		return { cacheId };
	}

	return {};
}

function normalizePlaywrightConfig(input: BrowserToolInput): PlaywrightConfig {
	const cache = normalizeCache(input);
	const viewport =
		input.viewport && Number.isFinite(input.viewport.width) && Number.isFinite(input.viewport.height)
			? { width: input.viewport.width, height: input.viewport.height }
			: DEFAULT_VIEWPORT;

	return {
		headless: input.headless ?? true,
		viewport,
		forceSameTabNavigation: input.forceSameTabNavigation ?? true,
		waitForNavigationTimeout: input.waitForNavigationTimeout ?? DEFAULT_WAIT_FOR_NAVIGATION_TIMEOUT,
		waitForNetworkIdleTimeout: input.waitForNetworkIdleTimeout ?? DEFAULT_WAIT_FOR_NETWORK_IDLE_TIMEOUT,
		generateReport: input.generateReport ?? false,
		cache: cache.cache,
		cacheId: cache.cacheId,
	};
}

function configsMatch(a: PlaywrightConfig | null, b: PlaywrightConfig): boolean {
	if (!a) return false;
	return (
		a.headless === b.headless &&
		a.forceSameTabNavigation === b.forceSameTabNavigation &&
		a.waitForNavigationTimeout === b.waitForNavigationTimeout &&
		a.waitForNetworkIdleTimeout === b.waitForNetworkIdleTimeout &&
		a.generateReport === b.generateReport &&
		a.cacheId === b.cacheId &&
		cacheMatches(a.cache, b.cache) &&
		Boolean(a.viewport?.width === b.viewport?.width && a.viewport?.height === b.viewport?.height)
	);
}

function cacheMatches(a?: BrowserCache, b?: BrowserCache): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	if (typeof a === "boolean" || typeof b === "boolean") return false;
	return a.id === b.id && a.strategy === b.strategy;
}

async function createAgentForPage(page: Page, config: PlaywrightConfig): Promise<PlaywrightAgent> {
	const options: PlaywrightAgentOptions = {
		generateReport: config.generateReport,
		cache: config.cache,
		cacheId: config.cacheId,
		forceSameTabNavigation: config.forceSameTabNavigation,
		waitForNavigationTimeout: config.waitForNavigationTimeout,
		waitForNetworkIdleTimeout: config.waitForNetworkIdleTimeout,
	};
	return new PlaywrightAgentCtor(page, options);
}

export async function ensurePlaywright(state: PlaywrightState, input: BrowserToolInput): Promise<PlaywrightStatus> {
	const mode: BrowserConnectMode = input.attach ?? "new_tab";
	const url = input.url?.trim() || undefined;
	const config = normalizePlaywrightConfig(input);
	const needsReset = input.reset === true || !state.browser || !state.context || !configsMatch(state.config, config);

	if (needsReset) {
		await destroyPlaywright(state);
		const browser = await chromium.launch({ headless: config.headless });
		const context = await browser.newContext(config.viewport ? { viewport: config.viewport } : undefined);
		const page = await context.newPage();
		const agent = await createAgentForPage(page, config);
		state.browser = browser;
		state.context = context;
		state.page = page;
		state.agent = agent;
		state.config = config;
		state.mode = mode;
		state.url = null;
	}

	if (!state.browser || !state.context || !state.page || !state.agent) {
		throw new Error("Failed to initialize Playwright browser");
	}

	if (mode === "new_tab") {
		if (!url) {
			throw new Error("url is required when attach is new_tab");
		}
		if (needsReset || state.mode !== mode) {
			state.page = await state.context.newPage();
			state.agent = await createAgentForPage(state.page, config);
		}
	} else if (mode === "current_tab" && state.mode !== mode) {
		state.agent = await createAgentForPage(state.page, config);
	}

	state.mode = mode;

	if (url) {
		await state.page.goto(url);
		state.url = url;
	}

	return {
		connected: true,
		mode,
		url,
		reused: !needsReset,
	};
}

export async function destroyPlaywright(state: PlaywrightState): Promise<void> {
	if (state.page) {
		try {
			await state.page.close();
		} catch {
			// ignore
		}
	}
	if (state.context) {
		try {
			await state.context.close();
		} catch {
			// ignore
		}
	}
	if (state.browser) {
		try {
			await state.browser.close();
		} catch {
			// ignore
		}
	}
	state.browser = null;
	state.context = null;
	state.page = null;
	state.agent = null;
	state.mode = null;
	state.url = null;
	state.config = null;
}

export function getPlaywrightAgent(state: PlaywrightState): PlaywrightAgent | null {
	return state.agent;
}

export function getPlaywrightPage(state: PlaywrightState): Page | null {
	return state.page;
}

export async function takePlaywrightScreenshot(
	state: PlaywrightState,
	fullPage: boolean,
): Promise<{ data: string; mimeType: string } | null> {
	if (!state.page) return null;
	const buffer = await state.page.screenshot({ type: "png", fullPage });
	return { data: buffer.toString("base64"), mimeType: "image/png" };
}
