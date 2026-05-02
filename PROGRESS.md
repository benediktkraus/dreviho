# OpenViking Hooks Fork — PROGRESS

## 2026-04-26
- Castor6/openviking-plugins gecloned als Basis
- config.mjs angepasst: OPENVIKING_AGENT_ID Env-Variable fuer Multi-Agent Config-Dir
- Hooks fuer Codex + Gemini CLI angelegt (hooks.json)
- OC Hook als execSync Hack erstellt (NICHT production-ready)
- Projekt-Setup mit Standard-Files

## 2026-05-02 — OV Expansion (Session)
### Wave 0: CLI Fixes + Infra
- Gemini extension-enablement.json: overrides Format gefixt (was: bare `true`)
- Codex OV Plugin: via Local Marketplace installiert (`/root/local-marketplace/`)
- OC recallLimit: 6→10 via `openclaw config set`
- ov-backup.sh: Pack Export, getestet (111KB), Timer So 03:00
- ov-health-check.sh: Observer/Queue/Stats Check, getestet
- ov-stats-report.sh: Wöchentlicher Stats Report via Telegram, Timer Mo 08:00
- ov-maintenance.sh: Nightly Dream Cycle (Duplikate, Orphans, Scope Coverage), Timer 04:00
- WebDAV: davfs2 installiert, aber OV braucht Custom Headers → nicht machbar ohne Proxy
### Wave 1: Scoping + Recall
- scope-resolver.mjs: Knowledge-Scope always active hinzugefügt
- scope-config.json: knowledge always_active: true
- Alle 4 CLI Configs: recallLimit 6→10
- Fork ↔ Plugin synced (scope-aware auto-recall + auto-capture)
- Record Used: auto-recall trackt URIs → auto-capture meldet an OV
- Content Merge: Duplikat-Check (score >0.85) vor Extract → append statt neues Memory
- Auto-Linking: CWD→Projekt-Slug Regex → POST /relations/link nach Capture
- MCP Server: memory_search (glob/grep) + convert_to_markdown (markitdown) Tools
### Wave 2: Projekt-Schema Sync
- ov-project-sync.sh: content/write API, create/replace, retry on busy, Timer 06:00
- Tested: openclaw CLAUDE.md + KNOWN-ISSUES.md synced
### Wave 3: Knowledge
- ov-knowledge-add.sh: URL + lokale Files, markitdown als Preprocessor
- markitdown v0.1.5 installiert
- TOOLS.md in ov-learnings-sync.sh eingebaut
### Hooks Live Test
- Codex auto-recall: 10 Memories, scope-aware, compacted ✅
- Gemini auto-recall: 10 Memories, scope-aware, compacted ✅
- Claude Code: bereits produktiv (seit Wochen) ✅

### Wave 4: Migration
- ov-scope-migration.sh: fs/mv API, analyze + migrate Modes
- 34 Top-Level Resources migriert → system (21), infra (1), knowledge (2), tool-docs (19)
- 1 flat Resource verbleibend
- OV nach Migration restartet (war unhealthy nach 500+ mv Ops)
### Hybrid Search (gbrain Pattern)
- Keyword-Extraction aus User-Prompt (Stoppwort-Filter, max 8 Keywords)
- `/search/grep` parallel zu `/search/find` (semantisch)
- RRF (Reciprocal Rank Fusion) Merge: k=60, Score = Σ 1/(k+rank)
- Bug-Fix: abstract/overview als non-String bei grep-Ergebnissen → String-Coercion
- Getestet: "openclaw gateway port 18789" → Top-Score 1.40, alle 10 Treffer relevant
- Deployed auf alle 3 CLIs (Claude Code, Codex, Gemini)

## Ausstehend
- Fork auf GitHub veröffentlichen
- Scope-resolver Fallback entfernen (1 flat Resource noch übrig)
- Session-Start Content-Check (bootstrap-runtime.mjs)
- Live-Monitoring Hybrid Search über Tage
- OC OV Plugin Scoping prüfen
