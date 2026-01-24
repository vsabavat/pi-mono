import { AgentOverChromeBridge } from "@midscene/web/bridge-mode";
import type { BrowserCache, BrowserConnectMode, BrowserToolInput } from "./types.js";

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
};

type BridgeState = {
	agent: AgentOverChromeBridge | null;
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

export function createBridgeState(): BridgeState {
	return {
		agent: null,
		mode: null,
		url: null,
		config: null,
	};
}

const DEFAULT_CACHE_ID = "pi-bridge-cache";
const DEFAULT_WAIT_FOR_NAVIGATION_TIMEOUT = 3000;
const DEFAULT_WAIT_FOR_NETWORK_IDLE_TIMEOUT = 1000;

function isDisconnectError(error: unknown): boolean {
	if (!error) return false;
	const message = error instanceof Error ? error.message : String(error);
	const normalized = message.toLowerCase();
	return (
		normalized.includes("connection lost") ||
		normalized.includes("namespace disconnect") ||
		normalized.includes("transport close")
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
	const waitForNavigationTimeout =
		input.waitForNavigationTimeout ?? DEFAULT_WAIT_FOR_NAVIGATION_TIMEOUT;
	const waitForNetworkIdleTimeout =
		input.waitForNetworkIdleTimeout ?? DEFAULT_WAIT_FOR_NETWORK_IDLE_TIMEOUT;
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
	};
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
		a.closeNewTabsAfterDisconnect === b.closeNewTabsAfterDisconnect
	);
}

export async function ensureBridge(state: BridgeState, input: BrowserToolInput): Promise<BridgeStatus> {
	const mode: BrowserConnectMode = input.attach ?? "current_tab";
	const url = input.url?.trim() || undefined;
	const config = normalizeConfig(input);
	const needsReset =
		input.reset === true ||
		!state.agent ||
		!configsMatch(state.config, config) ||
		state.mode !== mode ||
		(state.mode === "new_tab" && state.url !== url);

	if (needsReset) {
		await destroyBridge(state);
		const agentOptions = {
			generateReport: config.generateReport,
			cache: config.cache,
			cacheId: config.cacheId,
			waitForNavigationTimeout: config.waitForNavigationTimeout,
			waitForNetworkIdleTimeout: config.waitForNetworkIdleTimeout,
			allowRemoteAccess: config.allowRemoteAccess,
			host: config.host,
			port: config.port,
			closeNewTabsAfterDisconnect: config.closeNewTabsAfterDisconnect,
		} as ConstructorParameters<typeof AgentOverChromeBridge>[0];
		const agent = new AgentOverChromeBridge(agentOptions);
		state.agent = agent;
		state.config = config;
		state.mode = mode;
		state.url = url ?? null;

		if (mode === "new_tab") {
			if (!url) {
				throw new Error("url is required when attach is new_tab");
			}
			await agent.connectNewTabWithUrl(url, { forceSameTabNavigation: config.forceSameTabNavigation });
		} else {
			await agent.connectCurrentTab({ forceSameTabNavigation: config.forceSameTabNavigation });
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
	const closeTabs =
		closeTabsOverride ??
		state.config?.closeNewTabsAfterDisconnect ??
		false;
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

export function getBridgeAgent(state: BridgeState): AgentOverChromeBridge | null {
	return state.agent;
}
