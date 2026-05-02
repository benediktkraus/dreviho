# OpenViking Memory Hooks — Multi-CLI

Long-term semantic memory for **all AI CLI clients**, powered by [OpenViking](https://github.com/volcengine/OpenViking).

Fork of [Castor6/openviking-plugins](https://github.com/Castor6/openviking-plugins) with production-grade extensions: scoping, hybrid search, content merge, auto-linking, and multi-CLI support.

## Supported CLIs

| CLI | Recall Hook | Capture Hook | Status |
|-----|-------------|--------------|--------|
| [Claude Code](https://claude.com/claude-code) | UserPromptSubmit | Stop | Production |
| [Codex CLI](https://github.com/openai/codex) | UserPromptSubmit | Stop | Production |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | BeforeAgent | AfterAgent | Production |
| [OpenClaw](https://github.com/openclaw/openclaw) | before_prompt_build | afterTurn | Native Plugin |

All CLIs share the same user, same memory pool, same scoping logic. One OV, four clients.

## Features

**Core (from Castor6 original):**
- Auto-Recall — transparent memory injection before every prompt
- Auto-Capture — transparent memory extraction after every response
- MCP Server — 4 tools (recall, store, forget, health)

**Fork extensions:**
- **5-Scope System** — project, system, infra, knowledge, personal (CWD-based)
- **Hybrid Search** — semantic (`/search/find`) + keyword (`/search/grep`) + RRF merge
- **Content Merge** — duplicate check (score >0.85) → append instead of creating new memory
- **Record Used** — tracks which memories were actually useful → ranking improves over time
- **Auto-Linking** — captured memories automatically linked to active project via Relations API
- **Scope Hints** — agents see what scopes are active and what's in them
- **Caveman Compaction** — ~30% token reduction via regex stripping ($0 cost)
- **Source Authority** — trust-tier ranking (user_verified 2x, user_input 1.5x, agent_verified 1.2x)
- **MCP Tools** — 2 additional: `memory_search` (glob/grep), `convert_to_markdown` (markitdown)
- **Session-Start Check** — on-demand project sync if OV has no content for current project
- **`OPENVIKING_HOME` env** — configurable shared module path (default: `~/.openviking/`)

## Architecture

```
User Prompt → auto-recall.mjs
                ├── resolveScopes(CWD) → 5 target URIs
                ├── /search/find (semantic, parallel per scope)
                ├── /search/grep (keyword, parallel)
                ├── RRF Merge → unified ranking
                ├── Source Authority + Backlink Boosting
                ├── Caveman Compaction
                ├── Scope Hints injection
                └── <relevant-memories> → Agent context

Agent Response → auto-capture.mjs
                  ├── Content Merge check (score >0.85 → append)
                  ├── Session/Extract pipeline (new memories)
                  ├── Record Used (which recalls were helpful)
                  ├── Auto-Link (project relations)
                  └── Incremental state tracking
```

## Quick Start

### 1. Install OpenViking

```bash
pip install openviking
openviking-server
```

### 2. Install Shared Modules

```bash
mkdir -p ~/.openviking
cp shared/scope-resolver.mjs ~/.openviking/
cp shared/compaction.mjs ~/.openviking/
cp shared/scope-config.json ~/.openviking/
```

### 3. Create Client Config

```bash
mkdir -p ~/.openviking/claude-code-memory-plugin
cp config/claude-code.json ~/.openviking/claude-code-memory-plugin/config.json
# Edit: set your API key
```

### 4. Install per CLI

**Claude Code:**
```bash
/plugin marketplace add <this-repo>
/plugin install claude-code-memory-plugin@openviking-plugin
```

**Codex CLI:**
```bash
# Copy plugin to local marketplace
mkdir -p ~/local-marketplace/plugins/openviking-memory/.codex-plugin
cp hooks/codex-plugin.json ~/local-marketplace/plugins/openviking-memory/.codex-plugin/plugin.json
cp hooks/codex-cli.json ~/local-marketplace/plugins/openviking-memory/hooks.json
cp scripts/auto-recall.mjs scripts/auto-capture.mjs ~/local-marketplace/plugins/openviking-memory/scripts/
codex plugin marketplace add ~/local-marketplace
```

**Gemini CLI:**
```bash
# Copy extension
mkdir -p ~/.gemini/extensions/openviking-memory/scripts
cp hooks/gemini-cli.json ~/.gemini/extensions/openviking-memory/hooks/hooks.json
cp scripts/auto-recall.mjs scripts/auto-capture.mjs ~/.gemini/extensions/openviking-memory/scripts/
# Enable in extension-enablement.json
```

**OpenClaw:**
```bash
openclaw config set plugins.entries.openviking.enabled true
openclaw config set plugins.entries.openviking.config.recallLimit 10
openclaw config set plugins.slots.contextEngine openviking
```

## Scoping

| Scope | URI Prefix | When Active |
|-------|-----------|-------------|
| system | `viking://resources/system/` | Always |
| infra | `viking://resources/infra/` | No project CWD, or infra patterns |
| project:\<slug\> | `viking://resources/projects/<slug>/` | CWD in `/projects/<slug>/` |
| knowledge | `viking://resources/knowledge/` | Always |
| personal | `viking://user/memories/personal/` | Personal projects only |

Configure in `shared/scope-config.json`:
- `personal_projects` — list of project slugs that activate personal scope
- `infra_patterns` — CWD patterns that activate infra scope
- `project_base_paths` — where to detect project slugs from CWD

## Configuration

Per-CLI config in `~/.openviking/<cli>-memory-plugin/config.json`:

| Field | Default | Description |
|-------|---------|-------------|
| `mode` | `local` | `local` or `remote` |
| `agentId` | `claude-code` | Agent identity tag (not a namespace) |
| `recallLimit` | `10` | Max memories per recall |
| `captureMode` | `semantic` | `semantic` or `keyword` |
| `scoreThreshold` | `0.01` | Min relevance score |
| `debug` | `false` | Enable hook debug logging |

All CLIs share the same `account` + `user` → one memory pool.

## Repo Structure

```
hooks/           ← Hook definitions per CLI
config/          ← Config templates per CLI (API key placeholder)
shared/          ← Scope resolver + compaction (Single Source of Truth)
scripts/         ← Hook scripts (identical on all CLIs)
servers/         ← MCP Server (6 tools)
src/             ← TypeScript source
```

## Differences from Castor6 Original

| Feature | Castor6 | This Fork |
|---------|---------|-----------|
| CLIs | Claude Code only | Claude Code + Codex + Gemini + OpenClaw |
| Search | Semantic only | Hybrid (semantic + grep + RRF) |
| Scoping | None | 5 scopes, CWD-based |
| Dedup | None | Content Merge (score >0.85) |
| Ranking | Basic | Source Authority + Backlink Boosting |
| Compaction | None | Caveman (~30% reduction) |
| Relations | None | Auto-Linking to projects |
| Feedback | None | Record Used tracking |
| MCP Tools | 4 | 6 (+memory_search, +convert_to_markdown) |
| Session Start | Runtime bootstrap | + Project content check + on-demand sync |

## License

Apache-2.0 — same as [OpenViking](https://github.com/volcengine/OpenViking).
