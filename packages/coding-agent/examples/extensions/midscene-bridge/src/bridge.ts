import { createServer } from "node:net";
import type { BridgeAgent, BridgeAgentOptions } from "./deps.js";
import { getBridgeModule } from "./deps.js";
import type { BrowserCache, BrowserConnectMode, BrowserToolInput } from "./types.js";

const { AgentOverChromeBridge, killRunningServer } = getBridgeModule();

type BridgeConfig = {
	generateReport: boolean;
	forceSameTabNavigation: boolean;
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

type BridgeState = {
	agent: BridgeAgent | null;
	mode: BrowserConnectMode | null;
	url: string | null;
	config: BridgeConfig | null;
};

export type BridgeStatus = {
	connected: boolean;
	mode: BrowserConnectMode;
	url?: string;
	reused: boolean;
};

export type BridgeScreenshot = {
	data: string;
	mimeType: string;
};

export function createBridgeState(): BridgeState {
	return {
		agent: null,
		mode: null,
		url: null,
		config: null,
	};
}

const DEFAULT_CACHE_ID = "pi-bridge-cache";
const DEFAULT_BRIDGE_PORT = 3766;
const DEFAULT_BRIDGE_HOST = "127.0.0.1";
const DEFAULT_WAIT_FOR_NAVIGATION_TIMEOUT = 3000;
const DEFAULT_WAIT_FOR_NETWORK_IDLE_TIMEOUT = 1000;
const DEFAULT_NEW_TAB_URL = "about:blank";
const BRIDGE_SCREENSHOT_TIMEOUT_MS = 5000;

function isDisconnectError(error: unknown): boolean {
	if (!error) return false;
	const message = error instanceof Error ? error.message : String(error);
	const normalized = message.toLowerCase();
	return (
		normalized.includes("connection lost") ||
		normalized.includes("namespace disconnect") ||
		normalized.includes("transport close") ||
		normalized.includes("bridge call timeout")
	);
}

function isTruthy(value?: string): boolean {
	if (!value) return false;
	const normalized = value.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function normalizeCache(input: BrowserToolInput): { cache?: BrowserCache; cacheId?: string } {
	if (input.cache !== undefined) {
		if (input.cache === true) {
			const cacheId = input.cacheId ?? process.env.MIDSCENE_CACHE_ID ?? DEFAULT_CACHE_ID;
			return { cache: { id: cacheId }, cacheId };
		}
		return { cache: input.cache, cacheId: input.cacheId };
	}

	const cacheId = input.cacheId ?? process.env.MIDSCENE_CACHE_ID;
	if (isTruthy(process.env.MIDSCENE_CACHE)) {
		return { cache: { id: cacheId ?? DEFAULT_CACHE_ID }, cacheId };
	}

	if (cacheId) {
		return { cacheId };
	}

	return {};
}

function normalizeConfig(input: BrowserToolInput): BridgeConfig {
	const cache = normalizeCache(input);
	const waitForNavigationTimeout = input.waitForNavigationTimeout ?? DEFAULT_WAIT_FOR_NAVIGATION_TIMEOUT;
	const waitForNetworkIdleTimeout = input.waitForNetworkIdleTimeout ?? DEFAULT_WAIT_FOR_NETWORK_IDLE_TIMEOUT;
	return {
		generateReport: input.generateReport ?? false,
		forceSameTabNavigation: input.forceSameTabNavigation ?? true,
		cache: cache.cache,
		cacheId: cache.cacheId,
		waitForNavigationTimeout,
		waitForNetworkIdleTimeout,
		allowRemoteAccess: input.allowRemoteAccess,
		host: input.host,
		port: input.port,
		closeNewTabsAfterDisconnect: input.closeNewTabsAfterDisconnect,
		closeConflictServer: input.closeConflictServer ?? true,
	};
}

function resolveBridgeHost(config: BridgeConfig): string {
	if (config.host) return config.host;
	if (config.allowRemoteAccess) return "0.0.0.0";
	return DEFAULT_BRIDGE_HOST;
}

function resolveControlHost(config: BridgeConfig): string {
	return config.host ?? DEFAULT_BRIDGE_HOST;
}

async function isPortAvailable(host: string, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();
		let settled = false;
		const finish = (available: boolean) => {
			if (settled) return;
			settled = true;
			resolve(available);
		};
		server.once("error", () => {
			finish(false);
		});
		server.once("listening", () => {
			server.close(() => finish(true));
		});
		try {
			server.listen(port, host);
		} catch {
			finish(false);
		}
	});
}

function cacheMatches(a?: BrowserCache, b?: BrowserCache): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	if (typeof a === "boolean" || typeof b === "boolean") return false;
	return a.id === b.id && a.strategy === b.strategy;
}

function configsMatch(a: BridgeConfig | null, b: BridgeConfig): boolean {
	if (!a) return false;
	return (
		a.generateReport === b.generateReport &&
		a.forceSameTabNavigation === b.forceSameTabNavigation &&
		cacheMatches(a.cache, b.cache) &&
		a.cacheId === b.cacheId &&
		a.waitForNavigationTimeout === b.waitForNavigationTimeout &&
		a.waitForNetworkIdleTimeout === b.waitForNetworkIdleTimeout &&
		a.allowRemoteAccess === b.allowRemoteAccess &&
		a.host === b.host &&
		a.port === b.port &&
		a.closeNewTabsAfterDisconnect === b.closeNewTabsAfterDisconnect &&
		a.closeConflictServer === b.closeConflictServer
	);
}

export async function ensureBridge(state: BridgeState, input: BrowserToolInput): Promise<BridgeStatus> {
	const mode: BrowserConnectMode = input.attach ?? "new_tab";
	const rawUrl = input.url?.trim() || undefined;
	const newTabUrl = rawUrl ?? DEFAULT_NEW_TAB_URL;
	const url = mode === "new_tab" ? newTabUrl : rawUrl;
	const config = normalizeConfig(input);
	const needsReset =
		input.reset === true ||
		!state.agent ||
		!configsMatch(state.config, config) ||
		state.mode !== mode ||
		(state.mode === "new_tab" && state.url !== url);

	if (needsReset) {
		await destroyBridge(state);
		const host = resolveBridgeHost(config);
		const controlHost = resolveControlHost(config);
		const port = config.port ?? DEFAULT_BRIDGE_PORT;
		if (config.closeConflictServer) {
			await killRunningServer(port, controlHost);
		}
		const available = await isPortAvailable(host, port);
		if (!available) {
			throw new Error(`EADDRINUSE: bridge port ${port} is already in use`);
		}
		const agentOptions: BridgeAgentOptions = {
			generateReport: config.generateReport,
			cache: config.cache,
			cacheId: config.cacheId,
			waitForNavigationTimeout: config.waitForNavigationTimeout,
			waitForNetworkIdleTimeout: config.waitForNetworkIdleTimeout,
			allowRemoteAccess: config.allowRemoteAccess,
			host: config.host,
			port: config.port,
			closeNewTabsAfterDisconnect: config.closeNewTabsAfterDisconnect,
			closeConflictServer: config.closeConflictServer,
		};
		const agent = new AgentOverChromeBridge(agentOptions);
		suppressStatusMessageErrors(agent);
		state.agent = agent;
		state.config = config;
		state.mode = mode;
		state.url = url ?? null;

		try {
			if (mode === "new_tab") {
				await agent.connectNewTabWithUrl(newTabUrl, { forceSameTabNavigation: config.forceSameTabNavigation });
			} else {
				await agent.connectCurrentTab({ forceSameTabNavigation: config.forceSameTabNavigation });
			}
		} catch (error) {
			await destroyBridge(state);
			throw error;
		}

		return {
			connected: true,
			mode,
			url,
			reused: false,
		};
	}

	return {
		connected: true,
		mode,
		url,
		reused: true,
	};
}

export async function destroyBridge(state: BridgeState, closeTabsOverride?: boolean): Promise<void> {
	if (!state.agent) return;
	const closeTabs = closeTabsOverride ?? state.config?.closeNewTabsAfterDisconnect ?? false;
	try {
		await state.agent.destroy(closeTabs);
	} catch (error) {
		if (!isDisconnectError(error)) {
			throw error;
		}
	}
	state.agent = null;
	state.mode = null;
	state.url = null;
	state.config = null;
}

export function getBridgeAgent(state: BridgeState): BridgeAgent | null {
	return state.agent;
}

type AgentWithPage = { page?: unknown };
type BridgePageWithScreenshot = { screenshotBase64: () => Promise<string> };
type BridgePageWithStatusMessage = { showStatusMessage: (message: string) => Promise<unknown> };

function getAgentPage(agent: BridgeAgent): unknown {
	return (agent as AgentWithPage).page;
}

function hasShowStatusMessage(page: unknown): page is BridgePageWithStatusMessage {
	return (
		typeof page === "object" &&
		page !== null &&
		typeof (page as { showStatusMessage?: unknown }).showStatusMessage === "function"
	);
}

function hasScreenshotBase64(page: unknown): page is BridgePageWithScreenshot {
	if (typeof page !== "object" || page === null) return false;
	return typeof (page as { screenshotBase64?: unknown }).screenshotBase64 === "function";
}

function suppressStatusMessageErrors(agent: BridgeAgent): void {
	const page = getAgentPage(agent);
	if (!hasShowStatusMessage(page)) return;
	const original = page.showStatusMessage.bind(page);
	page.showStatusMessage = async (message: string) => {
		try {
			await original(message);
		} catch {
			// ignore status update failures
		}
	};
}

function parseScreenshotBase64(snapshot: string): BridgeScreenshot | null {
	if (!snapshot.startsWith("data:")) return null;
	const separator = ";base64,";
	const index = snapshot.indexOf(separator);
	if (index <= 5) return null;
	const mimeType = snapshot.slice(5, index);
	const data = snapshot.slice(index + separator.length);
	if (!mimeType || !data) return null;
	return { data, mimeType };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<null>((resolve) => {
				timeoutId = setTimeout(() => resolve(null), timeoutMs);
			}),
		]);
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
	}
}

export async function takeBridgeScreenshot(agent: BridgeAgent): Promise<BridgeScreenshot | null> {
	const page = getAgentPage(agent);
	if (!hasScreenshotBase64(page)) return null;
	try {
		const snapshot = await withTimeout(
			page.screenshotBase64().catch(() => null),
			BRIDGE_SCREENSHOT_TIMEOUT_MS,
		);
		if (!snapshot) return null;
		const parsed = parseScreenshotBase64(snapshot);
		if (parsed) return parsed;
		if (!snapshot.startsWith("data:") && snapshot.trim()) {
			return { data: snapshot, mimeType: "image/jpeg" };
		}
	} catch {
		return null;
	}
	return null;
}
