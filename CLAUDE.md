# OpenViking Hooks Fork — CLAUDE.md

## Was ist das
Fork von Castor6/openviking-plugins. Ziel: Production-grade Auto-Recall + Auto-Capture Hooks fuer ALLE AI Clients (Claude Code, Codex, Gemini CLI, OpenClaw).

## Tech-Stack
- TypeScript/Node.js (Castor6 Original)
- OpenViking REST API (localhost:1933)
- Gemini Embeddings fuer Vektorisierung
- Hook-Systeme: Claude Code Plugins, Codex hooks.json, Gemini hooks.json, OC Plugin-Hooks

## Entscheidungen
- 2026-04-26: Fork von Castor6/openviking-plugins statt Eigenentwicklung
- 2026-04-26: Multi-Agent via OPENVIKING_AGENT_ID Env-Variable statt separater Codebases
- 2026-05-02: Shared Modules unter /root/.openviking/ (scope-resolver.mjs, compaction.mjs, scope-config.json) — Single Source of Truth fuer alle CLIs
- 2026-05-02: Knowledge-Scope always active, recallLimit 10, Caveman Compaction
- 2026-05-02: gbrain Patterns uebernommen: Record Used, Content Merge, Auto-Linking, Hybrid Search
- 2026-05-02: markitdown als Multi-Format Preprocessor (MCP Tool + CLI Script)

## Status
- Phase: Production — Hooks fuer alle 4 CLIs deployed + getestet
- Claude Code: Plugin deployed, scope-aware, Record Used + Content Merge + Auto-Linking
- Codex: Local Marketplace Plugin, getestet
- Gemini: Extension aktiviert, getestet
- OpenClaw: Native Plugin, recallLimit 10

## File-Map
- scripts/ — Hook-Scripts (auto-recall.mjs, auto-capture.mjs, config.mjs, etc.)
- hooks/ — Hook-Definitionen (hooks.json)
- servers/ — MCP Server (memory-server)
- src/ — TypeScript Source
- tests/ — Tests
