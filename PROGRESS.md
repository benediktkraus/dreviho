# Progress

## 2026-05-02 — Initial Release
- Fork of Castor6/openviking-plugins
- Multi-CLI support: Claude Code, Codex, Gemini CLI, OpenClaw
- 5-scope system with CWD-based resolution
- Hybrid search (semantic + grep + RRF merge)
- Content merge, Record Used, Auto-Linking
- Caveman compaction, Source Authority ranking
- 6 MCP tools (recall, store, forget, health, search, convert_to_markdown)
- Session-start project content check
- Security audit: command injection fixed (execFileSync), path traversal sanitized
- install.sh for one-command setup per CLI
- Scope migration complete (0 flat resources remaining, fallback removed)
- Ranking logic extracted to shared/ranking.mjs (single source of truth)
- All personal data stripped from repo

## 2026-05-03 — OC ContextEngine Plugin + Hook Parity
- OC ContextEngine Plugin "openviking-enhanced" built (7 TS files, all methods: initialize, onSessionStart, onSessionEnd, onSubagentStart, onSubagentStop, onPreCompact, maintain, getContext, search, health)
- Full specs compiled: CLAUDE.md, PRD.md, TASK-GUIDE.md, 5 ADRs, specs/ directory
- 3 Knowledge sources ingested into OV (adk-samples, awesome-marketing, agency-agents)
- Stale recall dedup added to hooks + plugin (prevents repeated surfacing of same memories)
- Hook parity: SubagentStart/Stop hooks for Claude Code, PreCompact hooks for CC + Gemini
- Plugin deployed to /opt/openclaw/plugins/openviking-enhanced/
- Weekly sync script expanded to 11 sources (ov-doc-sync.sh)
- Not yet activated — pending OC update + config set + gateway restart
