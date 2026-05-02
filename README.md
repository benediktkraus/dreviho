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
              │      OpenViking Server       │
              │      (localhost:1933)        │
              │                              │
              │  ┌─ viking://resources/ ──┐  │
              │  │  system/    infra/     │  │
              │  │  projects/  knowledge/ │  │
              │  │  tool-docs/           │  │
              │  └────────────────────────┘  │
              │  ┌─ viking://user/ ───────┐  │
              │  │  memories/ (shared)    │  │
              │  └────────────────────────┘  │
              │                              │
              │  APIs used:                  │
              │  /search/find  (semantic)    │
              │  /search/grep  (keyword)     │
              │  /content/write (capture)    │
              │  /sessions/extract (AI)      │
              │  /relations/link (graph)     │
              │  /stats/memories (monitor)   │
              │  /pack/export  (backup)      │
              └──────────────────────────────┘
                        │
          ┌─────────────┼─────────────────┐
          ▼             ▼                 ▼
    ┌──────────┐  ┌──────────┐  ┌──────────────┐
    │ Cron Jobs│  │ MCP Tools│  │  Next Recall  │
    │          │  │          │  │              │
    │ backup   │  │ recall   │  │ Memories     │
    │ sync     │  │ store    │  │ injected via │
    │ maintain │  │ search   │  │ <relevant-   │
    │ stats    │  │ convert  │  │  memories>   │
    └──────────┘  └──────────┘  └──────────────┘
```

## vs Castor6 Original

| | Castor6 | This fork |
|---|---|---|
| CLIs | Claude Code | + Codex, Gemini, OpenClaw |
| Search | Semantic only | + grep + RRF merge |
| Scoping | None | 5 scopes, CWD-based |
| Dedup | None | Content merge (>0.85 → append) |
| Ranking | Score only | + source authority + backlink boost |
| Compaction | None | Caveman (~30% token reduction) |
| Relations | None | Auto-link to projects |
| Feedback | None | Record Used tracking |
| MCP Tools | 4 | 6 (+search, +markitdown) |
| Session Start | Runtime bootstrap | + project content check + on-demand sync |

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

## OpenClaw

OC uses OV as a **native context engine** — not through these hooks. OC's plugin has 8 lifecycle methods (bootstrap, assemble, ingest, afterTurn, compact, maintain, subagent spawn/end) that run deeper than hook-based recall/capture.

These hooks are for Claude Code, Codex, and Gemini. OC doesn't need them.

OC config (`openclaw config set`):
```bash
openclaw config set plugins.entries.openviking.enabled true
openclaw config set plugins.entries.openviking.config.agentId ralph
openclaw config set plugins.entries.openviking.config.recallLimit 10
openclaw config set plugins.slots.contextEngine openviking
```

OC env vars (gateway.service): `OPENVIKING_URL`, `OPENVIKING_API_KEY`, `OPENVIKING_AGENT_PREFIX`.

See `config/openclaw-plugin.json` for the full reference.

## License

Apache-2.0
