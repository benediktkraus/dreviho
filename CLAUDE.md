# OpenViking Hooks Fork — CLAUDE.md

## Was ist das
Fork von Castor6/openviking-plugins. Production-grade Auto-Recall + Auto-Capture Hooks fuer ALLE AI Clients (Claude Code, Codex, Gemini CLI, OpenClaw). Plus: Custom OC ContextEngine Plugin "openviking-enhanced".

## Projekt-Typ
internal

## Tech-Stack
- TypeScript/Node.js (ESM, target ES2022, strict)
- OpenViking REST API (localhost:1933) — Semantic Search, Sessions, Content
- Gemini Embeddings fuer Vektorisierung (server-side)
- OC Plugin SDK: definePluginEntry + registerContextEngine + ContextEngine Interface
- OC Helpers: delegateCompactionToRuntime, buildMemorySystemPromptAddition
- Shared Modules: scope-resolver.mjs, compaction.mjs, ranking.mjs (unter ~/.openviking/)
- Native fetch (kein axios, kein node-fetch)
- Hook-Systeme: Claude Code Plugins, Codex hooks.json, Gemini hooks.json, OC Plugin-Hooks

## Entscheidungen
- [2026-04-26]: Fork von Castor6/openviking-plugins statt Eigenentwicklung — bewährte Basis
- [2026-04-26]: Multi-Agent via OPENVIKING_AGENT_ID Env-Variable — eine Codebase für alle CLIs
- [2026-05-02]: Shared Modules unter ~/.openviking/ — Single Source of Truth für alle 4 CLIs
- [2026-05-02]: Knowledge-Scope always active, recallLimit 10, Caveman Compaction
- [2026-05-02]: gbrain Patterns übernommen: Record Used, Content Merge, Auto-Linking, Hybrid Search
- [2026-05-02]: markitdown als Multi-Format Preprocessor (MCP Tool + CLI Script)
- [2026-05-03]: OC Plugin "openviking-enhanced" als Custom ContextEngine — ersetzt eingebautes OV Plugin
- [2026-05-03]: ownsCompaction=false — compact() delegiert an OC Runtime via delegateCompactionToRuntime()
- [2026-05-03]: turnMaintenanceMode="background" — Maintenance non-blocking
- [2026-05-03]: maintain() strippt stale <relevant-memories> Blöcke — Token-Hygiene
- [2026-05-03]: onSubagentEnded() = Cleanup in allen Fällen — shared OV, kein Memory-Merge nötig
- [2026-05-03]: ingestBatch() als Loop über ingest() — best-effort
- [2026-05-03]: Plugin nach /opt/openclaw/plugins/openviking-enhanced/ (OC Convention)

## Status
- Phase: Hooks Production — OC Plugin in Entwicklung
- Claude Code: Plugin deployed, scope-aware, alle Features
- Codex: Local Marketplace Plugin, getestet
- Gemini: Extension aktiviert, getestet
- OpenClaw: Eingebautes Plugin aktiv, wird durch openviking-enhanced ersetzt

## File-Map
| Pfad | Inhalt |
|------|--------|
| scripts/ | Hook-Scripts (auto-recall.mjs, auto-capture.mjs, config.mjs, bootstrap, debug) |
| hooks/ | Hook-Definitionen (hooks.json für Claude Code) |
| servers/ | Compiled MCP Server (memory-server.js, 6 Tools) |
| src/ | TypeScript Source (memory-server.ts) |
| shared/ | Shared Modules (scope-resolver, compaction, ranking) — SSoT |
| tests/ | Unit Tests (config.test.mjs) |
| openclaw-plugin/ | OC ContextEngine Plugin Source (openviking-enhanced) |
| openclaw-plugin/src/ | Plugin TS: index.ts, context-engine.ts, ov-client.ts, config.ts, hybrid-search.ts, scope-hints.ts, text-utils.ts |
| openclaw-plugin/dist/ | Compiled Plugin Output |
| TASK-GUIDE.md | 3 Tasks für OC Plugin Build |
| PRD.md | Product Requirements |
| specs/ | Temporal Flow |
| adr/ | Architecture Decision Records |

## Regeln
- `openclaw config set` für OC Config — NIEMALS openclaw.json direkt editieren
- Kein execSync — nur execFileSync mit Array-Args
- Keine hardcoded /root/ Pfade — OPENVIKING_HOME env (default ~/.openviking)
- Shared Modules sind SSoT — Änderungen betreffen alle 4 CLIs
- OC Gateway als ROOT: `sudo XDG_RUNTIME_DIR=/run/user/0 openclaw gateway start`
