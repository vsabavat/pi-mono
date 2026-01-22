/**
 * Memory Protocol Extension
 *
 * Implements a hierarchical memory model with three layers:
 * 1. Session Log - Unbounded, append-only raw conversation (uses existing session JSONL)
 * 2. Session Summary - Per-session structured summary (stored in .pi/memory/summaries/)
 * 3. Project Memory - Rolling, hierarchical memory (stored in .pi/memory/project_current.md)
 *
 * Memory Protocol:
 * - RESUME: On session start, reads project memory and generates resume brief
 * - WORK: Injects project memory into system prompt for context
 * - FINALIZE: On session end, generates summary and memory patch
 *
 * Commands:
 * - /end - Explicitly end and finalize the session
 * - /checkpoint - Save a checkpoint without ending
 * - /summarize - Generate and display current session summary
 * - /memory - View or edit project memory
 *
 * Usage:
 *   pi --extension examples/extensions/memory-protocol.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { completeSimple } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// =============================================================================
// Types
// =============================================================================

interface SessionState {
	activeSessionId: string | null;
	sessionFile: string | null;
	lastEventTs: number;
	finalized: boolean;
}

interface SessionSummary {
	sessionId: string;
	timestamp: string;
	summary: string;
	memoryPatch: MemoryPatch;
	retrievalTags: string[];
	nextSteps: string[];
}

interface MemoryPatch {
	invariants?: string[];
	contracts?: string[];
	decisions?: string[];
	activeWorkstreams?: string[];
	knownIssues?: string[];
	debugPlaybook?: string[];
}

interface FinalizationOutput {
	sessionSummary: string;
	memoryPatch: MemoryPatch;
	retrievalTags: string[];
	nextSteps: string[];
}

// =============================================================================
// Constants
// =============================================================================

const MEMORY_DIR = ".pi/memory";
const SUMMARIES_DIR = ".pi/memory/summaries";
const PROJECT_MEMORY_FILE = "project_current.md";
const ARCHIVE_DIR = ".pi/memory/archive";
const SESSION_STATE_FILE = "session_state.json";
const IDLE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const PROJECT_MEMORY_MAX_TOKENS = 4000; // ~16KB
const CHUNK_SIZE_CHARS = 30000; // ~7.5k tokens per chunk
const MAX_DIRECT_SUMMARIZE_CHARS = 50000; // Above this, use chunked summarization

const PROJECT_MEMORY_TEMPLATE = `# Project Memory

## Invariants
<!-- Core assumptions that must remain true -->

## Contracts
<!-- Interface contracts and API boundaries -->

## Decisions
<!-- Architectural decisions with rationale -->

## Active Workstreams
<!-- Current work in progress -->

## Known Issues
<!-- Bugs, limitations, and technical debt -->

## Debug Playbook
<!-- Solutions to recurring problems -->
`;

const FINALIZATION_PROMPT = `You are generating a session finalization output. Analyze the conversation and produce a structured JSON response.

The output must be valid JSON with this exact structure:
{
  "sessionSummary": "string (250-400 tokens max): What changed, what was learned, unresolved items, key file references",
  "memoryPatch": {
    "invariants": ["items to add/update in Invariants section"],
    "contracts": ["items to add/update in Contracts section"],
    "decisions": ["items to add/update in Decisions section"],
    "activeWorkstreams": ["items to add/update in Active Workstreams section"],
    "knownIssues": ["items to add/update in Known Issues section"],
    "debugPlaybook": ["items to add/update in Debug Playbook section"]
  },
  "retrievalTags": ["keywords for future search"],
  "nextSteps": ["actionable prioritized next steps"]
}

Rules:
- sessionSummary: Focus on outcomes and learnings, not play-by-play
- memoryPatch: Only include sections that need updates. Each item should include "why it matters" context
- retrievalTags: 3-5 specific keywords (file names, concepts, error types)
- nextSteps: 2-4 concrete, actionable items

Return ONLY valid JSON, no markdown code blocks or extra text.`;

const RESUME_PROMPT = `Based on the project memory and previous session summary below, generate a brief resume statement.

Format:
## Resume Brief
**Current Goals**: [What we're working on]
**Key Constraints**: [Important limitations or requirements]
**Open Problems**: [Unresolved issues]
**Next 3 Actions**: [Immediate next steps]

Keep it concise (100-150 words). Focus on actionable context.`;

const CHUNK_SUMMARY_PROMPT = `Summarize this conversation chunk concisely. Focus on:
- What tasks were attempted or completed
- Key decisions made
- Files modified or created
- Errors encountered and how they were resolved
- Important context for understanding later chunks

Output a concise summary (150-250 words). Do not include JSON formatting.`;

const MERGE_SUMMARIES_PROMPT = `You have multiple chunk summaries from a long session. Merge them into a single coherent finalization output.

The output must be valid JSON with this exact structure:
{
  "sessionSummary": "string (250-400 tokens max): Unified summary of what changed, what was learned, unresolved items, key file references",
  "memoryPatch": {
    "invariants": ["items to add/update in Invariants section"],
    "contracts": ["items to add/update in Contracts section"],
    "decisions": ["items to add/update in Decisions section"],
    "activeWorkstreams": ["items to add/update in Active Workstreams section"],
    "knownIssues": ["items to add/update in Known Issues section"],
    "debugPlaybook": ["items to add/update in Debug Playbook section"]
  },
  "retrievalTags": ["keywords for future search"],
  "nextSteps": ["actionable prioritized next steps"]
}

Rules:
- Merge overlapping information, don't duplicate
- Preserve the chronological flow of work
- Focus on final outcomes, not intermediate steps
- Include all unique file references and decisions

Return ONLY valid JSON, no markdown code blocks or extra text.`;

// =============================================================================
// File Helpers
// =============================================================================

function getMemoryDir(cwd: string): string {
	return join(cwd, MEMORY_DIR);
}

function getSummariesDir(cwd: string): string {
	return join(cwd, SUMMARIES_DIR);
}

function getProjectMemoryPath(cwd: string): string {
	return join(getMemoryDir(cwd), PROJECT_MEMORY_FILE);
}

function getSessionStatePath(cwd: string): string {
	return join(getMemoryDir(cwd), SESSION_STATE_FILE);
}

function getArchiveDir(cwd: string): string {
	return join(cwd, ARCHIVE_DIR);
}

function ensureMemoryDirs(cwd: string): void {
	const dirs = [getMemoryDir(cwd), getSummariesDir(cwd), getArchiveDir(cwd)];
	for (const dir of dirs) {
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
	}
}

function readProjectMemory(cwd: string): string {
	const path = getProjectMemoryPath(cwd);
	if (!existsSync(path)) {
		return PROJECT_MEMORY_TEMPLATE;
	}
	return readFileSync(path, "utf-8");
}

function writeProjectMemory(cwd: string, content: string): void {
	ensureMemoryDirs(cwd);
	writeFileSync(getProjectMemoryPath(cwd), content);
}

function readSessionState(cwd: string): SessionState {
	const path = getSessionStatePath(cwd);
	if (!existsSync(path)) {
		return { activeSessionId: null, sessionFile: null, lastEventTs: 0, finalized: true };
	}
	try {
		const state = JSON.parse(readFileSync(path, "utf-8"));
		// Handle old format without sessionFile
		return { sessionFile: null, ...state };
	} catch {
		return { activeSessionId: null, sessionFile: null, lastEventTs: 0, finalized: true };
	}
}

function writeSessionState(cwd: string, state: SessionState): void {
	ensureMemoryDirs(cwd);
	writeFileSync(getSessionStatePath(cwd), JSON.stringify(state, null, 2));
}

function readSessionSummary(cwd: string, sessionId: string): SessionSummary | null {
	const path = join(getSummariesDir(cwd), `${sessionId}.json`);
	if (!existsSync(path)) {
		return null;
	}
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return null;
	}
}

function writeSessionSummary(cwd: string, summary: SessionSummary): void {
	ensureMemoryDirs(cwd);
	const path = join(getSummariesDir(cwd), `${summary.sessionId}.json`);
	writeFileSync(path, JSON.stringify(summary, null, 2));
}

// =============================================================================
// Memory Operations
// =============================================================================

function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function applyMemoryPatch(currentMemory: string, patch: MemoryPatch): string {
	let memory = currentMemory;

	const sections: { key: keyof MemoryPatch; header: string }[] = [
		{ key: "invariants", header: "## Invariants" },
		{ key: "contracts", header: "## Contracts" },
		{ key: "decisions", header: "## Decisions" },
		{ key: "activeWorkstreams", header: "## Active Workstreams" },
		{ key: "knownIssues", header: "## Known Issues" },
		{ key: "debugPlaybook", header: "## Debug Playbook" },
	];

	for (const { key, header } of sections) {
		const items = patch[key];
		if (!items || items.length === 0) continue;

		const sectionStart = memory.indexOf(header);
		if (sectionStart === -1) continue;

		// Find the next section or end
		let sectionEnd = memory.length;
		for (const { header: otherHeader } of sections) {
			if (otherHeader === header) continue;
			const otherStart = memory.indexOf(otherHeader, sectionStart + header.length);
			if (otherStart !== -1 && otherStart < sectionEnd) {
				sectionEnd = otherStart;
			}
		}

		// Extract current section content
		const sectionContent = memory.slice(sectionStart, sectionEnd);
		const existingItems = new Set<string>();

		// Parse existing items (lines starting with -)
		for (const line of sectionContent.split("\n")) {
			const trimmed = line.trim();
			if (trimmed.startsWith("-")) {
				// Extract first sentence/phrase for deduplication
				const itemText = trimmed.slice(1).trim().split(".")[0].toLowerCase();
				existingItems.add(itemText);
			}
		}

		// Add new items that don't exist
		const newItems: string[] = [];
		for (const item of items) {
			const itemKey = item.split(".")[0].toLowerCase();
			if (!existingItems.has(itemKey)) {
				newItems.push(`- ${item}`);
			}
		}

		if (newItems.length > 0) {
			// Insert after the section header and comment
			const insertPoint = sectionContent.indexOf("\n\n") + sectionStart + 2;
			memory = `${memory.slice(0, insertPoint) + newItems.join("\n")}\n${memory.slice(insertPoint)}`;
		}
	}

	return memory;
}

/**
 * Get the agent's current model and API key.
 */
async function getModelWithKey(
	ctx: ExtensionContext,
): Promise<{ model: NonNullable<typeof ctx.model>; apiKey: string } | null> {
	if (!ctx.model) return null;
	const apiKey = await ctx.modelRegistry.getApiKey(ctx.model);
	if (!apiKey) return null;
	return { model: ctx.model, apiKey };
}

async function checkAndCompactMemory(cwd: string, ctx: ExtensionContext): Promise<void> {
	const memory = readProjectMemory(cwd);
	const tokens = estimateTokens(memory);

	if (tokens <= PROJECT_MEMORY_MAX_TOKENS) return;

	// Archive current memory
	const archiveDir = getArchiveDir(cwd);
	const epochNum = (existsSync(archiveDir) ? readdirSync(archiveDir).length : 0) + 1;
	const archivePath = join(archiveDir, `epoch-${String(epochNum).padStart(3, "0")}.md`);

	// Generate compacted version
	const modelWithKey = await getModelWithKey(ctx);
	if (!modelWithKey) {
		ctx.ui.notify("No model/API key available for memory compaction", "warning");
		return;
	}
	const { model, apiKey } = modelWithKey;

	const compactionPrompt = `Compact this project memory while preserving essential information.

Current memory:
${memory}

Rules:
- Keep critical invariants and contracts
- Summarize older decisions, keep recent ones detailed
- Archive resolved workstreams (just mention they were completed)
- Keep active known issues and debug playbook entries
- Target ~2000 tokens

Output the compacted memory in the same markdown format.`;

	try {
		const response = await completeSimple(
			model,
			{
				systemPrompt: "You are a memory compaction assistant. Output only the compacted markdown.",
				messages: [{ role: "user", content: [{ type: "text", text: compactionPrompt }], timestamp: Date.now() }],
			},
			{ maxTokens: 4096, apiKey },
		);

		const compacted = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");

		// Archive old memory
		writeFileSync(archivePath, memory);

		// Write compacted memory
		writeProjectMemory(cwd, compacted);

		ctx.ui.notify(`Memory compacted. Epoch ${epochNum} archived.`, "info");
	} catch (error) {
		ctx.ui.notify(`Memory compaction failed: ${error}`, "error");
	}
}

// Import for archive check
import { readdirSync } from "node:fs";

// =============================================================================
// Session Serialization
// =============================================================================

function getSessionMessages(ctx: ExtensionContext): string {
	const entries = ctx.sessionManager.getEntries();
	const messages: { role: string; content: string }[] = [];

	for (const entry of entries) {
		if (entry.type === "message") {
			const msg = entry.message;
			if (msg.role === "user") {
				const content =
					typeof msg.content === "string"
						? msg.content
						: msg.content
								.filter((c): c is { type: "text"; text: string } => c.type === "text")
								.map((c) => c.text)
								.join("\n");
				messages.push({ role: "user", content });
			} else if (msg.role === "assistant") {
				const content = msg.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("\n");
				messages.push({ role: "assistant", content });
			} else if (msg.role === "toolResult") {
				const content =
					typeof msg.content === "string"
						? msg.content
						: msg.content
								.filter((c): c is { type: "text"; text: string } => c.type === "text")
								.map((c) => c.text)
								.join("\n");
				messages.push({ role: "tool", content: content.slice(0, 500) }); // Truncate tool results
			}
		}
	}

	return messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n---\n\n");
}

/**
 * Load messages from a session file for finalization of previous sessions.
 */
function getMessagesFromSessionFile(sessionFile: string): string {
	if (!existsSync(sessionFile)) {
		return "";
	}

	try {
		const content = readFileSync(sessionFile, "utf-8");
		const lines = content.trim().split("\n");
		const messages: { role: string; content: string }[] = [];

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line);
				if (entry.type === "message" && entry.message) {
					const msg = entry.message;
					if (msg.role === "user") {
						const msgContent =
							typeof msg.content === "string"
								? msg.content
								: (msg.content || [])
										.filter((c: { type: string; text?: string }) => c.type === "text")
										.map((c: { text: string }) => c.text)
										.join("\n");
						messages.push({ role: "user", content: msgContent });
					} else if (msg.role === "assistant") {
						const msgContent = (msg.content || [])
							.filter((c: { type: string; text?: string }) => c.type === "text")
							.map((c: { text: string }) => c.text)
							.join("\n");
						messages.push({ role: "assistant", content: msgContent });
					}
				}
			} catch {
				// Skip malformed lines
			}
		}

		return messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n---\n\n");
	} catch {
		return "";
	}
}

// =============================================================================
// Finalization
// =============================================================================

/**
 * Split conversation into chunks at message boundaries.
 */
function splitIntoChunks(conversation: string, chunkSize: number): string[] {
	const chunks: string[] = [];
	const separator = "\n\n---\n\n";
	const messages = conversation.split(separator);

	let currentChunk = "";
	for (const message of messages) {
		if (currentChunk.length + message.length + separator.length > chunkSize && currentChunk.length > 0) {
			chunks.push(currentChunk);
			currentChunk = message;
		} else {
			currentChunk = currentChunk ? currentChunk + separator + message : message;
		}
	}
	if (currentChunk) {
		chunks.push(currentChunk);
	}

	return chunks;
}

/**
 * Summarize a single chunk of conversation.
 */
async function summarizeChunk(
	chunk: string,
	chunkIndex: number,
	totalChunks: number,
	model: NonNullable<ExtensionContext["model"]>,
	apiKey: string,
): Promise<string> {
	const prompt = `${CHUNK_SUMMARY_PROMPT}

Chunk ${chunkIndex + 1} of ${totalChunks}:
${chunk}`;

	const response = await completeSimple(
		model,
		{
			systemPrompt: "You are a conversation summarizer. Be concise and factual.",
			messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
		},
		{ maxTokens: 1024, apiKey },
	);

	return response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}

/**
 * Merge chunk summaries into final finalization output.
 */
async function mergeChunkSummaries(
	chunkSummaries: string[],
	projectMemory: string,
	model: NonNullable<ExtensionContext["model"]>,
	apiKey: string,
): Promise<FinalizationOutput> {
	const summariesText = chunkSummaries.map((s, i) => `### Chunk ${i + 1}\n${s}`).join("\n\n");

	const prompt = `${MERGE_SUMMARIES_PROMPT}

Current Project Memory:
${projectMemory}

Chunk Summaries:
${summariesText}`;

	const response = await completeSimple(
		model,
		{
			systemPrompt: "You are a session finalization assistant. Output only valid JSON.",
			messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
		},
		{ maxTokens: 2048, apiKey },
	);

	const text = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");

	let jsonText = text;
	if (text.includes("```")) {
		const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
		if (match) jsonText = match[1];
	}

	return JSON.parse(jsonText.trim()) as FinalizationOutput;
}

async function generateFinalizationFromConversation(
	conversation: string,
	projectMemory: string,
	ctx: ExtensionContext,
): Promise<FinalizationOutput | null> {
	if (conversation.length < 100) {
		return null;
	}

	const modelWithKey = await getModelWithKey(ctx);
	if (!modelWithKey) {
		ctx.ui.notify("No model/API key available for finalization", "warning");
		return null;
	}
	const { model, apiKey } = modelWithKey;

	try {
		// Use chunked summarization for large conversations
		if (conversation.length > MAX_DIRECT_SUMMARIZE_CHARS) {
			ctx.ui.setStatus("memory", ctx.ui.theme.fg("warning", "chunked summarization..."));

			const chunks = splitIntoChunks(conversation, CHUNK_SIZE_CHARS);
			const chunkSummaries: string[] = [];

			for (let i = 0; i < chunks.length; i++) {
				ctx.ui.setStatus("memory", ctx.ui.theme.fg("warning", `summarizing ${i + 1}/${chunks.length}...`));
				const summary = await summarizeChunk(chunks[i], i, chunks.length, model, apiKey);
				chunkSummaries.push(summary);
			}

			ctx.ui.setStatus("memory", ctx.ui.theme.fg("warning", "merging summaries..."));
			return await mergeChunkSummaries(chunkSummaries, projectMemory, model, apiKey);
		}

		// Direct summarization for smaller conversations
		const prompt = `${FINALIZATION_PROMPT}

Current Project Memory:
${projectMemory}

Conversation to summarize:
${conversation}`;

		const response = await completeSimple(
			model,
			{
				systemPrompt: "You are a session finalization assistant. Output only valid JSON.",
				messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
			},
			{ maxTokens: 2048, apiKey },
		);

		const text = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");

		let jsonText = text;
		if (text.includes("```")) {
			const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
			if (match) jsonText = match[1];
		}

		return JSON.parse(jsonText.trim()) as FinalizationOutput;
	} catch (error) {
		ctx.ui.notify(`Finalization failed: ${error}`, "error");
		return null;
	}
}

async function generateFinalization(ctx: ExtensionContext): Promise<FinalizationOutput | null> {
	const conversation = getSessionMessages(ctx);
	const projectMemory = readProjectMemory(ctx.cwd);
	return generateFinalizationFromConversation(conversation, projectMemory, ctx);
}

async function finalizeSession(ctx: ExtensionContext, sessionId: string): Promise<void> {
	ctx.ui.setStatus("memory", ctx.ui.theme.fg("warning", "finalizing..."));

	const output = await generateFinalization(ctx);
	if (!output) {
		ctx.ui.setStatus("memory", undefined);
		return;
	}

	// Save session summary
	const summary: SessionSummary = {
		sessionId,
		timestamp: new Date().toISOString(),
		summary: output.sessionSummary,
		memoryPatch: output.memoryPatch,
		retrievalTags: output.retrievalTags,
		nextSteps: output.nextSteps,
	};
	writeSessionSummary(ctx.cwd, summary);

	// Apply memory patch
	const currentMemory = readProjectMemory(ctx.cwd);
	const updatedMemory = applyMemoryPatch(currentMemory, output.memoryPatch);
	writeProjectMemory(ctx.cwd, updatedMemory);

	// Check if compaction needed
	await checkAndCompactMemory(ctx.cwd, ctx);

	// Update session state
	writeSessionState(ctx.cwd, {
		activeSessionId: null,
		sessionFile: null,
		lastEventTs: Date.now(),
		finalized: true,
	});

	ctx.ui.setStatus("memory", undefined);
	ctx.ui.notify("Session finalized and memory updated", "info");
}

// =============================================================================
// Resume
// =============================================================================

async function generateResumeBrief(
	ctx: ExtensionContext,
	projectMemory: string,
	previousSummary: SessionSummary | null,
): Promise<string> {
	const modelWithKey = await getModelWithKey(ctx);
	if (!modelWithKey) return "";
	const { model, apiKey } = modelWithKey;

	const previousContext = previousSummary
		? `\nPrevious Session Summary:\n${previousSummary.summary}\n\nNext Steps from previous session:\n${previousSummary.nextSteps.map((s) => `- ${s}`).join("\n")}`
		: "";

	const prompt = `${RESUME_PROMPT}

Project Memory:
${projectMemory}
${previousContext}`;

	try {
		const response = await completeSimple(
			model,
			{
				systemPrompt: "You are a session resume assistant. Be concise and actionable.",
				messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
			},
			{ maxTokens: 512, apiKey },
		);

		return response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");
	} catch {
		return "";
	}
}

// =============================================================================
// Previous Session Finalization
// =============================================================================

async function finalizePreviousSession(prevState: SessionState, ctx: ExtensionContext): Promise<SessionSummary | null> {
	if (!prevState.sessionFile || !existsSync(prevState.sessionFile)) {
		return null;
	}

	ctx.ui.setStatus("memory", ctx.ui.theme.fg("warning", "finalizing prev..."));

	const conversation = getMessagesFromSessionFile(prevState.sessionFile);
	if (conversation.length < 100) {
		ctx.ui.setStatus("memory", undefined);
		return null;
	}

	const projectMemory = readProjectMemory(ctx.cwd);
	const output = await generateFinalizationFromConversation(conversation, projectMemory, ctx);

	if (!output) {
		ctx.ui.setStatus("memory", undefined);
		return null;
	}

	// Save session summary
	const summary: SessionSummary = {
		sessionId: prevState.activeSessionId!,
		timestamp: new Date().toISOString(),
		summary: output.sessionSummary,
		memoryPatch: output.memoryPatch,
		retrievalTags: output.retrievalTags,
		nextSteps: output.nextSteps,
	};
	writeSessionSummary(ctx.cwd, summary);

	// Apply memory patch
	const currentMemory = readProjectMemory(ctx.cwd);
	const updatedMemory = applyMemoryPatch(currentMemory, output.memoryPatch);
	writeProjectMemory(ctx.cwd, updatedMemory);

	// Check if compaction needed
	await checkAndCompactMemory(ctx.cwd, ctx);

	ctx.ui.notify("Previous session finalized", "info");
	ctx.ui.setStatus("memory", undefined);

	return summary;
}

// =============================================================================
// Extension
// =============================================================================

export default function memoryProtocolExtension(pi: ExtensionAPI) {
	let currentSessionId: string | null = null;
	let currentSessionFile: string | null = null;
	let resumeBrief: string = "";

	// Initialize on session start
	pi.on("session_start", async (_event, ctx) => {
		ensureMemoryDirs(ctx.cwd);

		const sessionId = ctx.sessionManager.getSessionId();
		currentSessionId = sessionId;
		currentSessionFile = ctx.sessionManager.getSessionFile() ?? null;

		// Check previous session state and finalize if needed
		const prevState = readSessionState(ctx.cwd);
		let previousSummary: SessionSummary | null = null;

		if (prevState.activeSessionId && !prevState.finalized && prevState.activeSessionId !== sessionId) {
			// Previous session wasn't finalized - finalize it now
			const timeSinceLastEvent = Date.now() - prevState.lastEventTs;

			if (timeSinceLastEvent > IDLE_THRESHOLD_MS) {
				// Auto-finalize after idle threshold
				previousSummary = await finalizePreviousSession(prevState, ctx);
			} else {
				// Recent session - just warn
				ctx.ui.notify("Previous session still active. Use /checkpoint to save progress.", "info");
			}
		}

		// If no summary from finalization, check for existing summary
		if (!previousSummary && prevState.activeSessionId) {
			previousSummary = readSessionSummary(ctx.cwd, prevState.activeSessionId);
		}

		// Load project memory and generate resume brief
		const projectMemory = readProjectMemory(ctx.cwd);

		if (projectMemory !== PROJECT_MEMORY_TEMPLATE || previousSummary) {
			resumeBrief = await generateResumeBrief(ctx, projectMemory, previousSummary);
		}

		// Update session state with current session
		writeSessionState(ctx.cwd, {
			activeSessionId: sessionId,
			sessionFile: currentSessionFile,
			lastEventTs: Date.now(),
			finalized: false,
		});

		ctx.ui.setStatus("memory", ctx.ui.theme.fg("dim", "mem"));
	});

	// Inject project memory into system prompt
	pi.on("before_agent_start", async (event, ctx) => {
		const projectMemory = readProjectMemory(ctx.cwd);

		let memoryContext = "";

		// Add project memory if non-empty
		if (projectMemory !== PROJECT_MEMORY_TEMPLATE) {
			memoryContext += `\n\n<project_memory>\n${projectMemory}\n</project_memory>`;
		}

		// Add resume brief on first turn
		if (resumeBrief) {
			memoryContext += `\n\n<resume_brief>\n${resumeBrief}\n</resume_brief>`;
			resumeBrief = ""; // Only show once
		}

		if (memoryContext) {
			return {
				systemPrompt:
					event.systemPrompt +
					memoryContext +
					"\n\nUse the project_memory as your source of truth for project context, constraints, and decisions.",
			};
		}
	});

	// Update last event timestamp on each turn
	pi.on("turn_end", async (_event, ctx) => {
		const state = readSessionState(ctx.cwd);
		state.lastEventTs = Date.now();
		writeSessionState(ctx.cwd, state);
	});

	// Finalize on shutdown
	pi.on("session_shutdown", async (_event, ctx) => {
		if (currentSessionId) {
			const state = readSessionState(ctx.cwd);
			if (!state.finalized) {
				await finalizeSession(ctx, currentSessionId);
			}
		}
	});

	// /end command - explicitly end and finalize
	pi.registerCommand("end", {
		description: "End and finalize the current session",
		handler: async (_args, ctx) => {
			if (!currentSessionId) {
				ctx.ui.notify("No active session", "warning");
				return;
			}
			await finalizeSession(ctx, currentSessionId);
			ctx.shutdown();
		},
	});

	// /checkpoint command - save progress without ending
	pi.registerCommand("checkpoint", {
		description: "Save a checkpoint of the current session",
		handler: async (_args, ctx) => {
			if (!currentSessionId) {
				ctx.ui.notify("No active session", "warning");
				return;
			}

			ctx.ui.setStatus("memory", ctx.ui.theme.fg("warning", "checkpoint..."));

			const output = await generateFinalization(ctx);
			if (output) {
				// Save session summary
				const summary: SessionSummary = {
					sessionId: currentSessionId,
					timestamp: new Date().toISOString(),
					summary: output.sessionSummary,
					memoryPatch: output.memoryPatch,
					retrievalTags: output.retrievalTags,
					nextSteps: output.nextSteps,
				};
				writeSessionSummary(ctx.cwd, summary);

				// Apply memory patch
				const currentMemory = readProjectMemory(ctx.cwd);
				const updatedMemory = applyMemoryPatch(currentMemory, output.memoryPatch);
				writeProjectMemory(ctx.cwd, updatedMemory);

				ctx.ui.notify("Checkpoint saved", "info");
			}

			ctx.ui.setStatus("memory", ctx.ui.theme.fg("dim", "mem"));
		},
	});

	// /summarize command - generate and display summary
	pi.registerCommand("summarize", {
		description: "Generate and display current session summary",
		handler: async (_args, ctx) => {
			ctx.ui.setStatus("memory", ctx.ui.theme.fg("warning", "summarizing..."));

			const output = await generateFinalization(ctx);
			if (output) {
				const summaryText = `## Session Summary\n\n${output.sessionSummary}\n\n### Next Steps\n${output.nextSteps.map((s) => `- ${s}`).join("\n")}\n\n### Tags\n${output.retrievalTags.join(", ")}`;

				// Show in editor for viewing
				await ctx.ui.editor("Session Summary", summaryText);
			}

			ctx.ui.setStatus("memory", ctx.ui.theme.fg("dim", "mem"));
		},
	});

	// /memory command - view or edit project memory
	pi.registerCommand("memory", {
		description: "View or edit project memory",
		handler: async (args, ctx) => {
			const memory = readProjectMemory(ctx.cwd);

			if (args?.trim() === "edit") {
				const edited = await ctx.ui.editor("Project Memory", memory);
				if (edited && edited !== memory) {
					writeProjectMemory(ctx.cwd, edited);
					ctx.ui.notify("Project memory updated", "info");
				}
			} else {
				await ctx.ui.editor("Project Memory (read-only)", memory);
			}
		},
	});
}
