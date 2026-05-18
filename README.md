# OpenViking Memory Hooks

Auto-recall + auto-capture for AI coding assistants. One memory pool, four CLIs, zero config drift.

Works with [Claude Code](https://github.com/anthropics/claude-code) · [Codex CLI](https://github.com/openai/codex) · [Gemini CLI](https://github.com/google-gemini/gemini-cli) · [OpenClaw](https://github.com/openclaw/openclaw)

Backed by [OpenViking](https://github.com/volcengine/OpenViking) — semantic memory server with embeddings, sessions, and content extraction.

## What it does

Every prompt you send gets enriched with relevant memories. Every session captures what matters. All four CLIs share the same brain.

```
You type a prompt
       │
       ▼
┌──────────────────────────────────────────┐
│            auto-recall.mjs               │
│                                          │
│  1. Resolve scopes from CWD              │
│  2. Hybrid search (semantic + grep)      │
│  3. RRF merge + 7-dim ranking            │
│  4. MMR diversity filter                 │
│  5. Temporal decay (30d half-life)       │
│  6. Caveman compaction (-30% tokens)     │
│  7. Citations + scope hints              │
│                                          │
│  → <relevant-memories> injected          │
└──────────────────────────────────────────┘
       │
       ▼
  Agent works with context
       │
       ▼
┌──────────────────────────────────────────┐
│           auto-capture.mjs               │
│                                          │
│  1. Pre-process (strip code, tags)       │
│  2. Substance filter (skip noise)        │
│  3. Content merge (>0.85 → append)       │
│  4. Extract via OV sessions              │
│  5. Record Used (feedback loop)          │
│  6. Auto-link (project + tool + error)   │
└──────────────────────────────────────────┘
       │
       ▼
   OpenViking Server
```

## Features

**Recall pipeline:**
- **Hybrid search** — semantic vectors + keyword grep, merged via Reciprocal Rank Fusion
- **5-scope system** — system, infra, project, knowledge, personal — resolved from CWD
- **7-dimension ranking** — base score, leaf boost, event boost, preference boost, lexical overlap, source authority, temporal decay
- **MMR diversity** — Jaccard similarity filter, reduces near-duplicates (lambda 0.7)
- **Temporal decay** — 30-day half-life for memories, evergreen exceptions for resources
- **Citations** — `[Source: uri | type | score]` on every injected memory
- **Stale dedup** — >80% URI overlap with previous recall → short-circuit (saves ~500 tokens)
- **Caveman compaction** — regex-based ~30% token reduction before injection

**Capture pipeline:**
- **Substance filter** — skips greetings, CLI commands, short messages, low-entropy text
- **Pre-processing** — strips code blocks, tool outputs, system tags before extraction
- **Content merge** — similarity >0.85 appends to existing memory instead of creating duplicates
- **Record Used** — reports which recalled URIs were actually in context (OV feedback loop)
- **Auto-link** — project relations + tool mentions (docker, n8n, openclaw, etc.) + incident tagging
- **Incremental capture** — state tracking per session, no duplicate turns

**Infrastructure:**
- **Retry with backoff** — 2 retries on 5xx/timeout/ECONNREFUSED, exponential delay
- **CF Access ready** — optional `cfAccessClientId` + `cfAccessClientSecret` headers
- **Remote mode** — connect from any machine to a remote OV instance via HTTPS
- **Shared modules** — scope-resolver, ranking, compaction, decay-cache under `~/.openviking/`

## Quick start

```bash
# Clone
git clone https://github.com/benediktkraus/openviking-hooks.git
cd openviking-hooks

# Install (local OV server)
./install.sh all

# Install (remote OV, e.g. from a Mac connecting to your server)
./install-mac.sh all

# Set your API key
nano ~/.openviking/claude-code-memory-plugin/config.json
```

Per-CLI install: `./install.sh claude-code`, `./install.sh codex`, `./install.sh gemini`, `./install.sh openclaw`

## CLI support

| CLI | Recall hook | Capture hook | Extra hooks |
|-----|------------|-------------|-------------|
| Claude Code | UserPromptSubmit | Stop | SessionStart (bootstrap), SubagentStart/Stop, PreCompact |
| Codex CLI | UserPromptSubmit | Stop | — |
| Gemini CLI | BeforeAgent | AfterAgent | PreCompress |
| OpenClaw | ContextEngine.assemble | ContextEngine.ingest | 8 lifecycle methods (bootstrap, compact, maintain, subagent) |

All CLIs share one OV instance, one memory pool. `agentId` tags writes per-CLI.

## Scopes

Scopes are resolved from your current working directory:

| Scope | URI prefix | When active |
|-------|-----------|-------------|
| system | `viking://resources/system/` | Always |
| infra | `viking://resources/infra/` | Always (infra CWD boost) |
| project | `viking://resources/projects/<slug>/` | CWD inside a project |
| knowledge | `viking://resources/knowledge/` | Always |
| personal | `viking://user/memories/personal/` | Personal project dirs |

Configure in `shared/scope-config.json`.

## vs upstream (Castor6)

| | [Castor6/openviking-plugins](https://github.com/Castor6/openviking-plugins) | This fork |
|---|---|---|
| CLIs | Claude Code only | + Codex, Gemini, OpenClaw |
| Search | Semantic only | + grep + RRF merge |
| Ranking | Raw score | 7 dimensions + MMR diversity + temporal decay |
| Scoping | None | 5 scopes, CWD-based |
| Capture filter | None | Substance signals, skip patterns, code ratio |
| Dedup | None | Content merge (>0.85 → append) + stale recall dedup |
| Relations | None | Auto-link (project + tool + incident) |
| Compaction | None | Caveman (-30% tokens) |
| Resilience | No retry | 2 retries, exponential backoff |
| Remote | No | HTTPS + CF Access headers |
| MCP tools | 4 | 6 (+search, +markitdown) |
| OC integration | None | Full ContextEngine plugin (8 methods) |
| Subagent hooks | None | SubagentStart/Stop, scope isolation |

## OpenClaw Context Engine

The `openclaw-plugin/` directory contains a full **ContextEngine** plugin that replaces OC's built-in OV plugin. It implements all 8 lifecycle methods with the features above.

```bash
# Install
cp -r openclaw-plugin /opt/openclaw/plugins/openviking-enhanced
cd /opt/openclaw/plugins/openviking-enhanced && npm install

# Activate
openclaw config set plugins.slots.contextEngine openviking-enhanced
openclaw config set plugins.entries.openviking.enabled false
```

| Method | What |
|--------|------|
| `bootstrap()` | Project content check + on-demand sync |
| `assemble()` | Hybrid search → ranking → compaction → `systemPromptAddition` |
| `ingest()` | Content merge + session/extract + record used + auto-link |
| `compact()` | Delegates to OC runtime |
| `maintain()` | Strip stale `<relevant-memories>` blocks |
| `prepareSubagentSpawn()` / `onSubagentEnded()` | Subagent scope isolation + cleanup |

## Config

`~/.openviking/claude-code-memory-plugin/config.json`:

```json
{
  "mode": "local",
  "agentId": "claude-code",
  "recallLimit": 10,
  "scoreThreshold": 0.1,
  "captureMode": "semantic",
  "autoRecall": true,
  "autoCapture": true,
  "debug": false
}
```

Remote mode (e.g. from a Mac):
```json
{
  "mode": "remote",
  "baseUrl": "https://your-ov-server.example.com",
  "apiKey": "your-api-key",
  "account": "your-account",
  "user": "your-user"
}
```

## Repo structure

```
scripts/          — auto-recall.mjs, auto-capture.mjs, config.mjs, bootstrap, subagent, debug
shared/           — scope-resolver, ranking, compaction, decay-cache, scope-config (SSoT for all CLIs)
servers/          — MCP server (6 tools: recall, store, forget, health, search, markitdown)
src/              — TypeScript source for MCP server
hooks/            — Hook definitions per CLI (JSON)
config/           — Config templates with placeholder keys
openclaw-plugin/  — OC ContextEngine (TypeScript, 7 source files)
install.sh        — Local install for all CLIs
install-mac.sh    — Remote install for macOS (Claude.app, Codex desktop)
```

## Requirements

- [OpenViking](https://github.com/volcengine/OpenViking) server (local or remote)
- Node.js 18+
- One of: Claude Code, Codex CLI, Gemini CLI, OpenClaw

## License

Apache-2.0
