# Task Guide — openviking-enhanced (OC ContextEngine Plugin)

## Projektseele
Metapher: Das eingebaute OV Plugin ist ein Briefkasten. Unser Plugin ist ein Postamt.
User: "OC braucht die gleichen Features wie alle anderen CLIs", "das interne Plugin deaktivieren und ein eigenes schreiben"
Archetype: Library/SDK (OC Plugin)
Basis: auto-recall.mjs + auto-capture.mjs + shared/ Module — Port nach TypeScript + ContextEngine Interface

## Dependency Graph
```
T-001 [Scaffold + OV Client]
  └─► T-002 [Core Methods: assemble + ingest + bootstrap]
        └─► T-003 [Lifecycle + Security + Deploy]
```
3 Tasks, 1 Titan Session.

## Tasks

---

### Task 1: CANVAS+BRAIN — Scaffold + OV Client

**Depends on:** none
**Produces:** Plugin structure, OV client, shared module imports

#### Spawn-Prompt:
```
SCOPE: OC ContextEngine Plugin Scaffold + OV HTTP Client.

OBJECTIVE: Plugin-Grundstruktur die sich in OC einklinkt. definePluginEntry + registerContextEngine + OV HTTP Client.

CONTEXT:
  Project: /mnt/onedrive/Workspace/projects/openviking-hooks-fork/openclaw-plugin/
  OC Plugin SDK: definePluginEntry aus openclaw/plugin-sdk/core, registerContextEngine aus openclaw/plugin-sdk
  ContextEngine Interface: /usr/lib/node_modules/openclaw/dist/plugin-sdk/src/context-engine/types.d.ts
  Shared modules: ../shared/ (scope-resolver.mjs, compaction.mjs, ranking.mjs)
  Bestehende Logik: ../scripts/auto-recall.mjs (OV Client Pattern), ../scripts/config.mjs (Config Loader)

EXISTING CODE: Shared modules unter ../shared/. Kein Plugin-Code.

FORBIDDEN:
  - Kein execSync (nur execFileSync mit Array)
  - Keine hardcoded /root/ Pfade (OPENVIKING_HOME env)
  - Kein axios — nur native fetch

DELIVERABLES:
  - package.json, tsconfig.json
  - src/index.ts — Plugin Entry
  - src/context-engine.ts — Klasse mit allen 8 Methoden als Stubs
  - src/ov-client.ts — OV HTTP Client (fetch + auth headers + timeout)
  - src/config.ts — Config aus env (OPENVIKING_URL, OPENVIKING_API_KEY, OPENVIKING_AGENT_PREFIX)

DoD:
  - [ ] tsc compiles
  - [ ] Plugin Entry hat korrektes Format
  - [ ] OV Client kann /health aufrufen
```

---

### Task 2: BRAIN — Core Methods (assemble + ingest + bootstrap)

**Depends on:** T-001
**Produces:** Die 3 wichtigsten ContextEngine Methoden

#### Spawn-Prompt:
```
SCOPE: assemble() mit Hybrid Search + Scoping + Scope Hints. ingest() mit Content Merge + Record Used + Auto-Link. bootstrap() mit Project-Content-Check.

OBJECTIVE: Port der bestehenden auto-recall.mjs und auto-capture.mjs Logik in die ContextEngine Methoden. KEIN neuer Code — nur Restructuring.

CONTEXT:
  Lies ZUERST: ../scripts/auto-recall.mjs (→ wird assemble), ../scripts/auto-capture.mjs (→ wird ingest), ../scripts/bootstrap-runtime.mjs (→ wird bootstrap)
  ContextEngine Interface Params:
    assemble({sessionId, messages, tokenBudget, prompt, model}) → {messages, estimatedTokens, systemPromptAddition}
    ingest({sessionId, message, isHeartbeat}) → {ingested: boolean}
    bootstrap({sessionId, sessionFile}) → {bootstrapped, importedMessages?, reason?}

EXISTING CODE:
  - src/ov-client.ts — OV HTTP Client (WORKING)
  - src/config.ts — Config (WORKING)
  - ../shared/scope-resolver.mjs — resolveScopes(cwd) (WORKING, importieren)
  - ../shared/compaction.mjs — cavemanCompact(text) (WORKING, importieren)
  - ../shared/ranking.mjs — pickMemories, postProcess, getRankingBreakdown (WORKING, importieren)

FORBIDDEN:
  - NICHT neu erfinden — Logik 1:1 aus auto-recall.mjs + auto-capture.mjs portieren
  - Kein execSync
  - isHeartbeat=true → ingest() returnt {ingested: false}
  - Messages Array in assemble() NICHT mutieren

DELIVERABLES:
  - src/context-engine.ts — assemble(), ingest(), bootstrap() implementiert
  - src/hybrid-search.ts — extractKeywords + grepSearch + rrfMerge (aus auto-recall.mjs extrahiert)
  - src/scope-hints.ts — Scope Hint Builder → systemPromptAddition String

DoD:
  - [ ] assemble() → scope-resolver → hybrid search → RRF → ranking → compaction → systemPromptAddition mit Scope Hints
  - [ ] ingest() → Content Merge (>0.85 append) → Session/Extract → Record Used → Auto-Link
  - [ ] bootstrap() → CWD→Slug → /fs/stat → ov-project-sync.sh wenn leer
  - [ ] tsc compiles
```

---

### Task 3: GLUE — Lifecycle + Security + Deploy

**Depends on:** T-002
**Produces:** Komplettes, deployed Plugin

#### Spawn-Prompt:
```
SCOPE: afterTurn, compact, maintain, subagent methods. Security Hardening. Build + Deploy nach /opt/openclaw/plugins/.

OBJECTIVE: Die letzten 5 Methoden implementieren, Security-Audit, bauen, deployen, testen.

CONTEXT:
  afterTurn(): Background-Compaction Decision + Log Turn-Stats
  compact(): Caveman Compaction (shared/compaction.mjs) + Token-Budget prüfen
  maintain(): Transcript-Cleanup via runtimeContext.rewriteTranscriptEntries()
  prepareSubagentSpawn(): Neue OV Session für Child erstellen
  onSubagentEnded(): Child OV Session aufräumen
  dispose(): Cleanup

EXISTING CODE:
  - src/context-engine.ts — assemble(), ingest(), bootstrap() (WORKING)
  - src/ov-client.ts, src/config.ts, src/hybrid-search.ts (WORKING)

FORBIDDEN:
  - openclaw.json NICHT direkt editieren — NUR openclaw config set
  - Kein execSync
  - Keine API Keys in Logs
  - Gateway NICHT starten ohne openclaw doctor --fix

DELIVERABLES:
  - src/context-engine.ts — alle 8 Methoden komplett
  - dist/ — Compiled Plugin (npm run build)
  - /opt/openclaw/plugins/openviking-enhanced/ — Deployed

DoD:
  - [ ] npm run build → 0 errors
  - [ ] grep -r "execSync" src/ → 0 Treffer
  - [ ] grep -r "console.log.*Key" src/ → 0 Treffer
  - [ ] openclaw doctor --fix → clean
  - [ ] Gateway startet mit "openviking-enhanced: registered context-engine" in Logs
  - [ ] Telegram-Nachricht → Ralph antwortet mit OV Memories im Kontext
  - [ ] Scope Hints in Gateway Debug-Log sichtbar

INSTALL:
  openclaw config set plugins.slots.contextEngine openviking-enhanced
  openclaw config set plugins.entries.openviking.enabled false
  systemctl --user daemon-reload && systemctl --user restart openclaw-gateway
```

---

## Effort Summary

| Wave | Tasks | Effort | Titan Model |
|------|-------|--------|-------------|
| 1 | T-001 Scaffold | 1-2h | Codex 5.5 |
| 2 | T-002 Core Methods | 2-3h | Opus (port-heavy) |
| 3 | T-003 Lifecycle + Deploy | 1-2h | Codex 5.5 |
| **Total** | **3 tasks** | **4-6h** | **1 Titan Session** |
