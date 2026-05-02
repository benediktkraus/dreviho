# OpenViking Memory Hooks

Auto-recall + auto-capture hooks for [OpenViking](https://github.com/volcengine/OpenViking). Works with Claude Code, Codex CLI, Gemini CLI, and OpenClaw.

Fork of [Castor6/openviking-plugins](https://github.com/Castor6/openviking-plugins). Added scoping, hybrid search, dedup, and multi-CLI support.

## CLIs

| CLI | Recall | Capture |
|-----|--------|---------|
| Claude Code | UserPromptSubmit | Stop |
| Codex CLI | UserPromptSubmit | Stop |
| Gemini CLI | BeforeAgent | AfterAgent |
| OpenClaw | before_prompt_build | afterTurn |

All share one OV instance, one user, one memory pool. Agent-ID is just a tag.

## What this adds over Castor6

- **Scoping** — 5 scopes (project, system, infra, knowledge, personal), CWD-based
- **Hybrid Search** — semantic + grep + RRF merge
- **Content Merge** — score >0.85 → append to existing memory instead of duplicate
- **Record Used** — tracks which recalls were useful, ranking improves over time
- **Auto-Linking** — new memories get linked to active project
- **Compaction** — regex-based, ~30% fewer tokens
- **Source Authority** — verified memories rank higher
- **2 extra MCP tools** — `memory_search` (glob/grep), `convert_to_markdown` (markitdown)
- **Session-Start Check** — syncs project context to OV on first visit

## Setup

### 1. Shared modules

```bash
cp shared/* ~/.openviking/
```

### 2. Per-CLI config

```bash
cp config/claude-code.json ~/.openviking/claude-code-memory-plugin/config.json
# Edit: set API key, account, user
```

### 3. Install hooks

**Claude Code** — via plugin marketplace or copy `hooks/claude-code.json`
**Codex** — `codex plugin marketplace add` with local marketplace pointing here
**Gemini** — copy to `~/.gemini/extensions/openviking-memory/`
**OpenClaw** — `openclaw config set plugins.entries.openviking.enabled true`

See `hooks/` for per-CLI hook definitions, `config/` for config templates.

## Scopes

| Scope | URI | Active when |
|-------|-----|-------------|
| system | `viking://resources/system/` | Always |
| infra | `viking://resources/infra/` | No project, or infra CWD |
| project | `viking://resources/projects/<slug>/` | CWD in project dir |
| knowledge | `viking://resources/knowledge/` | Always |
| personal | `viking://user/memories/personal/` | Personal projects only |

Config: `shared/scope-config.json`

## Repo structure

```
shared/    — scope-resolver, compaction, scope-config (all CLIs import these)
scripts/   — hook scripts (auto-recall, auto-capture, bootstrap, config, debug)
servers/   — MCP server (6 tools)
hooks/     — hook definitions per CLI
config/    — config templates per CLI (placeholder keys)
src/       — TypeScript source
```

## Config

`~/.openviking/<cli>-memory-plugin/config.json`:

| Field | Default | What |
|-------|---------|------|
| `mode` | `local` | `local` or `remote` |
| `agentId` | `claude-code` | Tag, not namespace |
| `recallLimit` | `10` | Max memories per recall |
| `captureMode` | `semantic` | `semantic` or `keyword` |
| `debug` | `false` | Hook debug logging |

Override shared module path: `export OPENVIKING_HOME=/path/to/.openviking`

## License

Apache-2.0
