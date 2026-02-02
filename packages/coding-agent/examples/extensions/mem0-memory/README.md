# Mem0 Memory Extension

Logs system/user/assistant messages to Mem0 and injects relevant memories into each prompt.

## Setup

```bash
cd packages/coding-agent/examples/extensions/mem0-memory
npm install
```

Create a `.env` in this folder (auto-loaded) or export variables in your shell. Mem0 defaults to OpenAI:

```bash
export OPENAI_API_KEY="..."
```

## Loading

```bash
pi --extension examples/extensions/mem0-memory
```

Or copy the folder under `~/.pi/agent/extensions/` or `.pi/extensions/`.

## Environment

- `MEM0_USER_ID`: Override user ID (default: project-based hash)
- `MEM0_HISTORY_DIR`: Base directory for per-project history DBs (hashed filename). If unset (and no `MEM0_HISTORY_DB`), mem0 uses `./memory.db` in the current working directory.
- `MEM0_HISTORY_DB`: Full path override for history DB (single file)
- `MEM0_MAX_RESULTS`: Max memories to inject (default: 5)
- `MEM0_MIN_SCORE`: Minimum score threshold (default: 0.2)
- `MEM0_MAX_CONTEXT_CHARS`: Max injected context size (default: 1600)
- `MEM0_MAX_MEMORY_CHARS`: Max chars per memory line (default: 280)
- `MEM0_MAX_LOG_CHARS`: Max chars stored per message (default: 4000)
- `MEM0_EMBEDDER_MODEL`: OpenAI embedder model (e.g. `text-embedding-3-large`)
- `MEM0_EMBEDDER_DIMS`: Embedding dimensions override (number)
- `MEM0_VECTOR_STORE_DIMS`: Vector store dimension override (defaults to `MEM0_EMBEDDER_DIMS`, must match embedding size; delete `./vector_store.db` if you change it)
- `MEM0_LLM_MODEL`: OpenAI-compatible LLM model for memory extraction
- `MEM0_LLM_TEMPERATURE`: LLM temperature override (number)
- `MEM0_LLM_MAX_TOKENS`: LLM max tokens override (number)
- `MEM0_OPENAI_BASE_URL`: OpenAI-compatible base URL (applies to embedder + LLM)
- `MEM0_INCLUDE_SCORES`: Include scores in prompt (`1`/`true`)
- `MEM0_DISABLED`: Disable all Mem0 calls (`1`/`true`)

## Behavior

- On each prompt: searches Mem0 and appends a `<mem0_memory>` block to the system prompt.
- On agent end: logs system prompt, user prompt, and assistant response to Mem0.

Based on the Mem0 Node SDK quickstart: https://docs.mem0.ai/open-source/node-quickstart
