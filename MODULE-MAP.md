# OpenViking Hooks Fork — MODULE-MAP

## Overview
```
openviking-hooks-fork/
├── scripts/          Hook scripts (runtime, recalled via Claude Code hook system)
├── servers/          Compiled MCP server (runtime, spawned via start-memory-server.mjs)
├── src/              TypeScript source (build-time only)
├── hooks/            Hook definitions (read by Claude Code plugin loader)
├── tests/            Unit tests
└── /root/.openviking/  Shared modules (external, used by all 4 CLIs)
```

## scripts/ — Hook Scripts
All scripts are ESM (.mjs), executed by Node.js via the Claude Code hook system defined in `hooks/hooks.json`.

| File | Hook Trigger | Purpose |
|------|-------------|---------|
| **auto-recall.mjs** | UserPromptSubmit | Core recall pipeline. Reads user prompt from stdin, resolves CWD to scopes, runs semantic search across scoped target URIs + grep hybrid search (RRF merge), ranks with query-aware scoring (base + leaf + event + pref + overlap + authority boosts), deduplicates, reads full content for leaf memories, applies Caveman compaction, injects via systemMessage. Writes recalled URIs to temp file for Record Used tracking. |
| **auto-capture.mjs** | Stop | Core capture pipeline. Reads transcript path from stdin, parses JSON/JSONL transcript, extracts user/assistant turns, applies incremental tracking (only new turns since last capture), runs shouldCapture decision (semantic or keyword mode), performs Content Merge (dupe check >0.85 → append), creates OV temp session → extract memories, reports Record Used URIs, creates Auto-Link relations to active project. |
| **bootstrap-runtime.mjs** | SessionStart | Ensures MCP runtime dependencies are installed (delegates to runtime-common.mjs). Checks if active project content exists in OV and triggers on-demand sync via external script ov-project-sync.sh. |
| **config.mjs** | (imported) | Shared configuration loader. Multi-agent aware via OPENVIKING_AGENT_ID env. Reads client config from `~/.openviking/{agentId}-memory-plugin/config.json` and server config from `~/.openviking/ov.conf`. Supports local/remote mode, env var expansion (`${VAR}`), field validation with clamping and defaults. Exports `loadConfig()`. |
| **runtime-common.mjs** | (imported) | Runtime path resolution, source state hashing (SHA-256 of package.json + package-lock.json + memory-server.js), install state persistence, file sync from plugin source to runtime directory, directory-based install lock with stale detection (10 min), npm ci execution. Exports `getRuntimePaths()`, `computeSourceState()`, `ensureRuntimeInstalled()`, etc. |
| **start-memory-server.mjs** | (MCP launcher) | Ensures runtime, then spawns `servers/memory-server.js` as child process with signal forwarding. Exit code passthrough. |
| **debug-recall.mjs** | (manual) | Standalone diagnostic. Walks through every recall pipeline stage with ANSI-colored verbose output. Duplicates ranking logic from auto-recall.mjs (no shared import). |
| **debug-capture.mjs** | (manual) | Standalone diagnostic. Supports file mode and stdin mode. Shows every capture pipeline stage with verbose output. Duplicates capture logic from auto-capture.mjs. |
| **debug-log.mjs** | (imported) | JSON Lines structured logger. Active when `debug: true` in config or `OPENVIKING_DEBUG=1`. Zero-cost no-ops when disabled. Logs to `~/.openviking/logs/cc-hooks.log`. Exports `createLogger(hookName)`. |

### Dependency graph (scripts/)
```
auto-recall.mjs
  ├── config.mjs
  ├── debug-log.mjs
  ├── /root/.openviking/scope-resolver.mjs
  └── /root/.openviking/compaction.mjs

auto-capture.mjs
  ├── config.mjs
  └── debug-log.mjs

bootstrap-runtime.mjs
  ├── runtime-common.mjs
  ├── config.mjs
  └── /root/.openviking/scope-resolver.mjs

start-memory-server.mjs
  └── runtime-common.mjs

debug-recall.mjs
  └── config.mjs (standalone, no shared ranking imports)

debug-capture.mjs
  └── config.mjs (standalone, no shared capture imports)

debug-log.mjs
  └── config.mjs (lazy-loaded)
```

## servers/ — MCP Server
| File | Purpose |
|------|---------|
| **memory-server.js** | Compiled MCP server. Stdio transport via @modelcontextprotocol/sdk. Contains full OpenVikingClient class with HTTP client, scope resolution, URI normalization, session management. 6 tools registered. |

### MCP Tools (memory-server.js)
| Tool | Description | Source |
|------|-------------|--------|
| `memory_recall` | Semantic search across user + agent memories. Query-aware ranking, content read, formatted output. | Castor6 original |
| `memory_store` | Store text as memory. Creates temp session → add message → extract → delete session. | Castor6 original |
| `memory_forget` | Delete memory by exact URI or search query. Safety: only deletes `viking://user/*/memories/` or `viking://agent/*/memories/` URIs. Auto-deletes single strong match (>0.85), otherwise lists candidates. | Castor6 original |
| `memory_health` | Health check against OV server. | Castor6 original |
| `memory_search` | Structural search via glob/grep patterns. Bypasses semantic search for exact matches. | Fork addition (JS only) |
| `convert_to_markdown` | File conversion via markitdown CLI. Supports PDF, DOCX, XLSX, PPTX, HTML, images, audio. | Fork addition (JS only) |

## hooks/ — Hook Definitions
| File | Purpose |
|------|---------|
| **hooks.json** | Declares three Claude Code plugin hooks with their triggers, commands, and timeouts. SessionStart→bootstrap (120s), UserPromptSubmit→auto-recall (8s), Stop→auto-capture (45s). |

## src/ — TypeScript Source
| File | Purpose |
|------|---------|
| **memory-server.ts** | TypeScript source for MCP server. Contains 4 original Castor6 tools. NOTE: out of sync with compiled JS — JS has 2 additional tools (memory_search, convert_to_markdown) and expanded OpenVikingClient constructor (account, user fields). |

## tests/
| File | Purpose |
|------|---------|
| **config.test.mjs** | 5 unit tests for config.mjs using node:test. Covers local mode with ov.conf, remote mode, missing ov.conf fallback, env var expansion, remote baseUrl validation. |

## Shared Modules at /root/.openviking/
External modules shared across all 4 CLI hooks (Claude Code, Codex, Gemini CLI, OpenClaw). Single Source of Truth — changes here affect all clients.

| File | Purpose | Imported By |
|------|---------|-------------|
| **scope-resolver.mjs** | CWD → scope resolution. Maps working directory to active scopes (system, project, infra, knowledge, personal) and their target URIs. Also provides `sourceAuthorityMultiplier()` for trust-tier scoring and `getCompactionConfig()`. | auto-recall.mjs, bootstrap-runtime.mjs |
| **compaction.mjs** | Caveman compaction. Regex-based text compression (~30% token reduction, $0 cost). Strips markdown formatting, code blocks, tables, HTML comments, collapses whitespace. Preserves content and structure. | auto-recall.mjs |
| **scope-config.json** | Configuration for scope resolver. Defines project base paths, infra patterns, personal projects, scope URI prefixes and tiers (holy/volatile), source authority multipliers (user_verified: 2.0, user_input: 1.5, agent_verified: 1.2, auto_captured: 1.0), compaction settings. | (loaded by scope-resolver.mjs) |

### Scope Resolution Logic
```
CWD = /mnt/onedrive/Workspace/projects/openclaw/src/
  → system (always)
  → project:openclaw (matched via project_base_paths)
  → infra (active when no project, or CWD matches infra_patterns)
  → knowledge (always)

Target URIs searched:
  viking://resources/system/
  viking://user/memories/
  viking://agent/memories/
  viking://agent/skills/
  viking://resources/projects/openclaw/
  viking://resources/infra/        (if infra scope active)
  viking://resources/knowledge/
```

## Data Flow

### Auto-Recall (UserPromptSubmit)
```
User types prompt
  → Claude Code fires UserPromptSubmit hook
  → stdin: { prompt: "..." }
  → auto-recall.mjs
    → resolveScopes(cwd) → target URIs
    → parallel: semantic search (N scopes) + grep search (keywords)
    → RRF merge (if grep returned results)
    → postProcess (leaf-only, score threshold, dedup)
    → rank with query profile (leaf/event/pref/overlap/authority boosts)
    → pickMemories (top K, prefer leaves)
    → readMemoryContent (full text for leaf items)
    → cavemanCompact (strip formatting, ~30% smaller)
    → write recalled URIs to /tmp/openviking-cc-recall-tracking/
  → stdout: { decision: "approve", hookSpecificOutput: { additionalContext: "<relevant-memories>..." } }
  → Claude sees memories as system context
```

### Auto-Capture (Stop)
```
Claude finishes response
  → Claude Code fires Stop hook
  → stdin: { transcript_path: "/path/to/transcript", session_id: "..." }
  → auto-capture.mjs
    → read transcript file (JSON array or JSONL)
    → extractAllTurns (user + assistant)
    → loadState → skip already-captured turns
    → filter to user turns only (unless captureAssistantTurns=true)
    → shouldCapture decision (semantic=always, keyword=trigger patterns)
    → Content Merge: search for similar (>0.85) → append instead of new
    → captureToOpenViking: create session → add message → extract → delete session
    → Record Used: read recalled URIs from /tmp/ → POST to session/used
    → Auto-Link: detect project slug from CWD → POST relations/link
    → saveState (incremental turn count)
  → stdout: { decision: "approve" }
```
