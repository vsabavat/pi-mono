declare module "mem0ai/oss" {
	export interface MemoryConfig extends Record<string, unknown> {
		historyDbPath?: string;
		disableHistory?: boolean;
	}

	export type MemoryRole = "system" | "user" | "assistant";

	export interface MemoryMessage {
		role: MemoryRole;
		content: string;
	}

	export type MemoryMetadataValue = string | number | boolean;
	export type MemoryMetadata = Record<string, MemoryMetadataValue>;

	export interface MemoryAddOptions {
		userId: string;
		metadata?: MemoryMetadata;
	}

	export interface MemorySearchOptions {
		userId: string;
		limit?: number;
	}

	export class Memory {
		constructor(config?: MemoryConfig);
		add(messages: MemoryMessage[], options: MemoryAddOptions): Promise<unknown>;
		search(query: string, options: MemorySearchOptions): Promise<unknown>;
	}
}
