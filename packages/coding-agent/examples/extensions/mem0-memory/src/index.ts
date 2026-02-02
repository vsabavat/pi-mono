/// <reference path="./mem0ai-oss.d.ts" />
/// <reference path="./dotenv.d.ts" />

import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import * as os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { config as loadEnv } from "dotenv";
import { Memory } from "mem0ai/oss";

type Mem0MessageRole = "system" | "user" | "assistant";

interface Mem0Message {
	role: Mem0MessageRole;
	content: string;
}

interface Mem0SearchEntry {
	memory?: string;
	score?: number;
	metadata?: Record<string, unknown>;
}

interface Mem0Config {
	enabled: boolean;
	userId: string;
	historyDbPath: string;
	maxResults: number;
	minScore: number;
	maxContextChars: number;
	maxMemoryChars: number;
	maxLogChars: number;
	includeScores: boolean;
}

interface OpenAIEmbedderConfig {
	model?: string;
	embeddingDims?: number;
	apiKey?: string;
	openaiBaseUrl?: string;
}

interface OpenAILlmConfig {
	model?: string;
	apiKey?: string;
	openaiBaseUrl?: string;
	temperature?: number;
	maxTokens?: number;
}

interface MemoryInitConfig extends Record<string, unknown> {
	historyDbPath: string;
	embedder?: { provider: "openai"; config: OpenAIEmbedderConfig };
	llm?: { provider: "openai"; config: OpenAILlmConfig };
}

interface ActivePrompt {
	id: number;
	prompt: string;
	systemPrompt: string;
	timestamp: number;
	userId: string;
}

type Mem0MetadataValue = string | number | boolean;
type Mem0Metadata = Record<string, Mem0MetadataValue>;

const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_MIN_SCORE = 0.2;
const DEFAULT_MAX_CONTEXT_CHARS = 1600;
const DEFAULT_MAX_MEMORY_CHARS = 280;
const DEFAULT_MAX_LOG_CHARS = 4000;
const STATUS_KEY = "mem0";

const extensionDir = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(extensionDir, "..", ".env") });

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseIntEnv(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? fallback : parsed;
}

function parseOptionalIntEnv(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? undefined : parsed;
}

function parseFloatEnv(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number.parseFloat(value);
	return Number.isNaN(parsed) ? fallback : parsed;
}

function parseOptionalFloatEnv(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number.parseFloat(value);
	return Number.isNaN(parsed) ? undefined : parsed;
}

function parseBoolEnv(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined) return fallback;
	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
	return fallback;
}

function normalizeWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function readEnv(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function truncate(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars).trim()}...`;
}

function ensureDir(path: string): void {
	if (!existsSync(path)) {
		mkdirSync(path, { recursive: true });
	}
}

function hashString(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function resolveProjectId(cwd: string): string {
	return hashString(cwd);
}

function resolveUserId(cwd: string): string {
	const envId = process.env.MEM0_USER_ID?.trim();
	return envId && envId.length > 0 ? envId : `pi:${resolveProjectId(cwd)}`;
}

function resolveHistoryDbPath(cwd: string): string {
	const envPath = process.env.MEM0_HISTORY_DB?.trim();
	if (envPath) return envPath;
	const baseDir = process.env.MEM0_HISTORY_DIR?.trim() || join(os.homedir(), ".pi", "mem0");
	ensureDir(baseDir);
	return join(baseDir, `${resolveProjectId(cwd)}.db`);
}

function buildConfig(cwd: string): Mem0Config {
	const enabled = !parseBoolEnv(process.env.MEM0_DISABLED, false);
	return {
		enabled,
		userId: resolveUserId(cwd),
		historyDbPath: resolveHistoryDbPath(cwd),
		maxResults: Math.max(1, parseIntEnv(process.env.MEM0_MAX_RESULTS, DEFAULT_MAX_RESULTS)),
		minScore: parseFloatEnv(process.env.MEM0_MIN_SCORE, DEFAULT_MIN_SCORE),
		maxContextChars: Math.max(200, parseIntEnv(process.env.MEM0_MAX_CONTEXT_CHARS, DEFAULT_MAX_CONTEXT_CHARS)),
		maxMemoryChars: Math.max(80, parseIntEnv(process.env.MEM0_MAX_MEMORY_CHARS, DEFAULT_MAX_MEMORY_CHARS)),
		maxLogChars: Math.max(200, parseIntEnv(process.env.MEM0_MAX_LOG_CHARS, DEFAULT_MAX_LOG_CHARS)),
		includeScores: parseBoolEnv(process.env.MEM0_INCLUDE_SCORES, false),
	};
}

function buildOpenAIEmbedderConfig(): OpenAIEmbedderConfig | null {
	const config: OpenAIEmbedderConfig = {};
	const model = readEnv(process.env.MEM0_EMBEDDER_MODEL);
	const embeddingDims = parseOptionalIntEnv(process.env.MEM0_EMBEDDER_DIMS);
	const openaiBaseUrl = readEnv(process.env.MEM0_OPENAI_BASE_URL);

	if (model) config.model = model;
	if (embeddingDims !== undefined) config.embeddingDims = embeddingDims;
	if (openaiBaseUrl) config.openaiBaseUrl = openaiBaseUrl;

	return Object.keys(config).length > 0 ? config : null;
}

function buildOpenAILlmConfig(): OpenAILlmConfig | null {
	const config: OpenAILlmConfig = {};
	const model = readEnv(process.env.MEM0_LLM_MODEL);
	const temperature = parseOptionalFloatEnv(process.env.MEM0_LLM_TEMPERATURE);
	const maxTokens = parseOptionalIntEnv(process.env.MEM0_LLM_MAX_TOKENS);
	const openaiBaseUrl = readEnv(process.env.MEM0_OPENAI_BASE_URL);

	if (model) config.model = model;
	if (temperature !== undefined) config.temperature = temperature;
	if (maxTokens !== undefined) config.maxTokens = maxTokens;
	if (openaiBaseUrl) config.openaiBaseUrl = openaiBaseUrl;

	return Object.keys(config).length > 0 ? config : null;
}

function buildMemoryInitConfig(config: Mem0Config): MemoryInitConfig {
	const init: MemoryInitConfig = { historyDbPath: config.historyDbPath };
	const embedderConfig = buildOpenAIEmbedderConfig();
	const llmConfig = buildOpenAILlmConfig();

	if (embedderConfig) {
		init.embedder = { provider: "openai", config: embedderConfig };
	}
	if (llmConfig) {
		init.llm = { provider: "openai", config: llmConfig };
	}

	return init;
}

function extractSearchEntries(response: unknown): Mem0SearchEntry[] {
	if (!isRecord(response)) return [];
	const results = response.results;
	if (!Array.isArray(results)) return [];

	const entries: Mem0SearchEntry[] = [];
	for (const item of results) {
		if (!isRecord(item)) continue;
		const memory = typeof item.memory === "string" ? item.memory : undefined;
		const score = typeof item.score === "number" ? item.score : undefined;
		const metadata = isRecord(item.metadata) ? item.metadata : undefined;
		if (memory && memory.trim().length > 0) {
			entries.push({ memory, score, metadata });
		}
	}
	return entries;
}

function limitLines(lines: string[], maxChars: number): string | null {
	if (lines.length === 0) return null;
	const result: string[] = [];
	let total = 0;
	for (const line of lines) {
		const nextTotal = total + line.length + (result.length > 0 ? 1 : 0);
		if (nextTotal > maxChars) {
			if (result.length === 0) {
				result.push(truncate(line, maxChars));
			}
			break;
		}
		result.push(line);
		total = nextTotal;
	}
	return result.length > 0 ? result.join("\n") : null;
}

function formatMemoryContext(entries: Mem0SearchEntry[], config: Mem0Config): string | null {
	const lines: string[] = [];
	for (const entry of entries) {
		if (!entry.memory) continue;
		if (typeof entry.score === "number" && entry.score < config.minScore) continue;
		const memory = truncate(normalizeWhitespace(entry.memory), config.maxMemoryChars);
		const scoreSuffix =
			config.includeScores && typeof entry.score === "number" ? ` (score ${entry.score.toFixed(2)})` : "";
		lines.push(`- ${memory}${scoreSuffix}`);
		if (lines.length >= config.maxResults) break;
	}
	return limitLines(lines, config.maxContextChars);
}

function buildMem0Prompt(memoryContext: string): string {
	return [
		"<mem0_memory>",
		memoryContext,
		"</mem0_memory>",
		"Use mem0_memory only when relevant. If it conflicts with the user's latest request, ignore it.",
	].join("\n");
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
	return message.role === "assistant";
}

function extractAssistantText(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();
}

function getLastAssistantText(messages: AgentMessage[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const msg = messages[i];
		if (isAssistantMessage(msg)) {
			const text = extractAssistantText(msg);
			return text.length > 0 ? text : undefined;
		}
	}
	return undefined;
}

function buildMem0Messages(prompt: ActivePrompt, assistantText: string | undefined, config: Mem0Config): Mem0Message[] {
	const messages: Mem0Message[] = [];
	const systemText = truncate(prompt.systemPrompt.trim(), config.maxLogChars);
	const userText = truncate(prompt.prompt.trim(), config.maxLogChars);
	if (systemText) messages.push({ role: "system", content: systemText });
	if (userText) messages.push({ role: "user", content: userText });
	if (assistantText && assistantText.trim().length > 0) {
		messages.push({ role: "assistant", content: truncate(assistantText, config.maxLogChars) });
	}
	return messages;
}

function buildMetadata(ctx: ExtensionContext, prompt: ActivePrompt, assistantText: string | undefined): Mem0Metadata {
	const metadata: Mem0Metadata = {
		sessionId: ctx.sessionManager.getSessionId(),
		projectId: resolveProjectId(ctx.cwd),
		promptId: prompt.id,
		promptHash: hashString(prompt.prompt),
		systemPromptHash: hashString(prompt.systemPrompt),
		promptChars: prompt.prompt.length,
		timestamp: new Date(prompt.timestamp).toISOString(),
	};
	if (assistantText !== undefined) {
		metadata.assistantChars = assistantText.length;
	}
	if (ctx.model) {
		metadata.model = `${ctx.model.provider}/${ctx.model.id}`;
	}
	return metadata;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

let memoryClient: Memory | null = null;
let promptCounter = 0;
let activePrompt: ActivePrompt | null = null;
let activeMemoryContext: string | null = null;
let lastErrorAt = 0;
let writeQueue: Promise<void> = Promise.resolve();

async function ensureMemory(ctx: ExtensionContext, config: Mem0Config): Promise<Memory | null> {
	if (!config.enabled) return null;
	if (memoryClient) return memoryClient;
	try {
		memoryClient = new Memory(buildMemoryInitConfig(config));
		return memoryClient;
	} catch (error) {
		notifyOnce(ctx, "init", error);
		memoryClient = null;
		return null;
	}
}

async function searchMem0(memory: Memory, query: string, config: Mem0Config): Promise<Mem0SearchEntry[]> {
	const trimmed = query.trim();
	if (!trimmed) return [];
	const response: unknown = await memory.search(trimmed, { userId: config.userId, limit: config.maxResults });
	return extractSearchEntries(response);
}

function notifyOnce(ctx: ExtensionContext, label: string, error: unknown): void {
	const now = Date.now();
	if (now - lastErrorAt < 60_000) return;
	lastErrorAt = now;
	const message = `Mem0 ${label} failed: ${errorMessage(error)}`;
	if (ctx.hasUI) {
		ctx.ui.notify(message, "warning");
	} else {
		console.warn(message);
	}
}

function enqueueWrite(task: () => Promise<unknown>, ctx: ExtensionContext): void {
	writeQueue = writeQueue
		.then(async () => {
			await task();
		})
		.catch((error) => {
			notifyOnce(ctx, "write", error);
		});
}

export default function mem0MemoryExtension(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const config = buildConfig(ctx.cwd);
		activePrompt = null;
		activeMemoryContext = null;
		if (!config.enabled) {
			if (ctx.hasUI) {
				ctx.ui.setStatus(STATUS_KEY, undefined);
			}
			return;
		}
		await ensureMemory(ctx, config);
		if (ctx.hasUI) {
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", "mem0"));
		}
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const config = buildConfig(ctx.cwd);
		const memory = await ensureMemory(ctx, config);
		if (!memory) return;

		promptCounter += 1;
		const promptId = promptCounter;
		activePrompt = {
			id: promptId,
			prompt: event.prompt,
			systemPrompt: event.systemPrompt,
			timestamp: Date.now(),
			userId: config.userId,
		};

		try {
			const results = await searchMem0(memory, event.prompt, config);
			activeMemoryContext = formatMemoryContext(results, config);
		} catch (error) {
			activeMemoryContext = null;
			notifyOnce(ctx, "search", error);
		}

		if (!activeMemoryContext) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${buildMem0Prompt(activeMemoryContext)}`,
		};
	});

	pi.on("agent_end", async (event, ctx) => {
		const config = buildConfig(ctx.cwd);
		const memory = await ensureMemory(ctx, config);
		if (!memory || !activePrompt) return;

		const assistantText = getLastAssistantText(event.messages);
		const messages = buildMem0Messages(activePrompt, assistantText, config);
		if (messages.length === 0) {
			activePrompt = null;
			activeMemoryContext = null;
			return;
		}

		const metadata = buildMetadata(ctx, activePrompt, assistantText);
		const userId = activePrompt.userId;
		enqueueWrite(() => memory.add(messages, { userId, metadata }), ctx);

		activePrompt = null;
		activeMemoryContext = null;
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		await writeQueue;
		if (ctx.hasUI) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
		}
	});
}
