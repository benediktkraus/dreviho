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

## How it works

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ Claude Code │  │  Codex CLI  │  │ Gemini CLI  │  │  OpenClaw   │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │                │
       │  UserPrompt    │  UserPrompt    │  BeforeAgent   │  before_prompt
       ▼                ▼                ▼                ▼
┌──────────────────────────────────────────────────────────────────┐
│                     auto-recall.mjs                              │
│                                                                  │
│  CWD ──► scope-resolver ──► 5 target URIs                       │
│          │                                                       │
│          ├──► /search/find (semantic, per scope)  ──┐            │
│          └──► /search/grep (keywords)             ──┤            │
│                                                     ▼            │
│                                              RRF Merge           │
│                                                     │            │
│                              ranking.mjs ◄──────────┘            │
│                              (source authority + backlinks)      │
│                                     │                            │
│                              compaction.mjs                      │
│                              (~30% token reduction)              │
│                                     │                            │
│                              scope hints                         │
│                                     ▼                            │
│                          <relevant-memories>                     │
└──────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              Agent works         On session end
                    │                   │
                    │                   ▼
                    │     ┌─────────────────────────┐
                    │     │    auto-capture.mjs      │
                    │     │                          │
                    │     │  Content Merge (>0.85?)  │
                    │     │    ├─ yes: append         │
                    │     │    └─ no: extract new     │
                    │     │                          │
                    │     │  Record Used (feedback)  │
                    │     │  Auto-Link (project)     │
                    │     └────────────┬─────────────┘
                    │                  │
                    ▼                  ▼
              ┌──────────────────────────────┐
              │     OpenViking Server        │
              │     (localhost:1933)          │
              │                              │
              │  viking://resources/         │
              │    ├── system/               │
              │    ├── infra/                │
              │    ├── projects/<slug>/      │
              │    ├── knowledge/            │
              │    └── tool-docs/            │
              │  viking://user/memories/     │
              └──────────────────────────────┘
```

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

## vs Castor6 Original

| | Castor6 | This fork |
|---|---|---|
| CLIs | Claude Code | + Codex, Gemini, OpenClaw |
| Search | Semantic only | + grep + RRF merge |
| Scoping | None | 5 scopes, CWD-based |
| Dedup | None | Content merge (>0.85) |
| Ranking | Score only | + source authority + backlinks |
| Compaction | None | Caveman (~30% reduction) |
| Relations | None | Auto-link to projects |
| Feedback | None | Record Used |
| MCP Tools | 4 | 6 |

## Install

```bash
./install.sh all          # all CLIs
./install.sh claude-code  # just Claude Code
./install.sh codex        # just Codex
./install.sh gemini       # just Gemini
./install.sh openclaw     # just OpenClaw
```

Then edit `~/.openviking/<cli>-memory-plugin/config.json` — set API key, account, user.

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
