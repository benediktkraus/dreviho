# Task Guide — openviking-enhanced (OC ContextEngine Plugin)

## Projektseele
Metapher: Das eingebaute OV Plugin ist ein Briefkasten. Unser Plugin ist ein Postamt.
User: "OC braucht die gleichen Features wie alle anderen CLIs", "das interne Plugin deaktivieren und ein eigenes schreiben"
Archetype: Library/SDK (OC Plugin)
Basis: auto-recall.mjs + auto-capture.mjs + shared/ Module — Port nach TypeScript + ContextEngine Interface

## SDK Reference (OC Plugin SDK v2026.4.29)
- **Entry:** `definePluginEntry()` aus `openclaw/plugin-sdk/core`
- **Registration:** `registerContextEngine(id, factory)` aus `openclaw/plugin-sdk` context-engine/registry
- **Interface:** `ContextEngine` aus context-engine/types — 8 Methoden (2 required, 6 optional + info)
- **Helpers:** `delegateCompactionToRuntime()` — delegiert compact() an OC Runtime (kein eigener Summarizer nötig)
- **Helpers:** `buildMemorySystemPromptAddition()` — Memory/Wiki Guidance für systemPromptAddition
- **Message Type:** `AgentMessage` aus `@mariozechner/pi-agent-core`
- **Alle Methoden haben `sessionKey?: string`** zusätzlich zu sessionId — OC nutzt sessionKey für Multi-Account Routing

## Dependency Graph
```
T-001 [Scaffold + OV Client + Plugin Entry]
  └─► T-002 [Core Methods: assemble + ingest + bootstrap]
        └─► T-003 [Lifecycle + Security + Deploy]
```
3 Tasks, 1 Titan Session.

## Tasks

---

### Task 1: CANVAS+BRAIN — Scaffold + OV Client

**Depends on:** none
**Produces:** Plugin structure, OV client, shared module imports, registered context engine

#### Spawn-Prompt:
```
SCOPE: OC ContextEngine Plugin Scaffold + OV HTTP Client.

OBJECTIVE: Plugin-Grundstruktur die sich in OC einklinkt. definePluginEntry + registerContextEngine + OV HTTP Client.

CONTEXT:
  Project: /mnt/onedrive/Workspace/projects/openviking-hooks-fork/openclaw-plugin/
  OC Plugin SDK:
    - definePluginEntry aus openclaw/plugin-sdk/core
    - registerContextEngine aus openclaw/plugin-sdk (context-engine/registry)
    - ContextEngine Interface: /usr/lib/node_modules/openclaw/dist/plugin-sdk/src/context-engine/types.d.ts
    - delegateCompactionToRuntime aus openclaw/plugin-sdk/core (context-engine/delegate)
    - buildMemorySystemPromptAddition aus openclaw/plugin-sdk/core (context-engine/delegate)
    - AgentMessage aus @mariozechner/pi-agent-core
  Shared modules: ../shared/ (scope-resolver.mjs, compaction.mjs, ranking.mjs)
  Bestehende Logik: ../scripts/auto-recall.mjs (OV Client Pattern), ../scripts/config.mjs (Config Loader)

EXISTING CODE: Shared modules unter ../shared/. Kein Plugin-Code vorhanden.

FORBIDDEN:
  - Kein execSync (nur execFileSync mit Array-Args wenn nötig)
  - Keine hardcoded /root/ Pfade (OPENVIKING_HOME env, default ~/.openviking)
  - Keine externen HTTP-libs — nur native fetch
  - Kein axios, kein node-fetch, kein got

DELIVERABLES:
  - package.json — name: openviking-enhanced, dependencies: openclaw peer deps
  - tsconfig.json — target ES2022, ESNext modules, strict
  - src/index.ts — Plugin Entry: definePluginEntry + registerContextEngine
  - src/context-engine.ts — OpenVikingContextEngine Klasse mit allen Methoden als Stubs
  - src/ov-client.ts — OV HTTP Client (native fetch, auth headers, timeout, abort controller)
  - src/config.ts — Config aus env vars (OPENVIKING_URL, OPENVIKING_API_KEY, OPENVIKING_AGENT_PREFIX)

ARCHITECTURE:
  info: {
    id: "openviking-enhanced",
    name: "OpenViking Enhanced Context Engine",
    version: "1.0.0",
    ownsCompaction: false,        // delegiert an OC Runtime via delegateCompactionToRuntime()
    turnMaintenanceMode: "background"  // OV Maintenance braucht kein foreground
  }

DoD:
  - [ ] tsc compiles ohne Fehler
  - [ ] Plugin Entry hat korrektes definePluginEntry Format (id, name, description, register)
  - [ ] register() ruft registerContextEngine("openviking-enhanced", factory) auf
  - [ ] OV Client kann /health aufrufen und Ergebnis zurückgeben
  - [ ] Config liest OPENVIKING_URL, OPENVIKING_API_KEY, OPENVIKING_AGENT_PREFIX aus env
  - [ ] Alle 8 ContextEngine Methoden als Stubs vorhanden (richtige Signaturen aus types.d.ts)
```

---

### Task 2: BRAIN — Core Methods (assemble + ingest + bootstrap)

**Depends on:** T-001
**Produces:** Die 3 wichtigsten ContextEngine Methoden — vollständig portiert

#### Spawn-Prompt:
```
SCOPE: assemble() mit Hybrid Search + Scoping + Scope Hints. ingest() mit Content Merge + Record Used + Auto-Link. bootstrap() mit Project-Content-Check.

OBJECTIVE: Port der bestehenden auto-recall.mjs und auto-capture.mjs Logik in die ContextEngine Methoden. KEIN neuer Code — nur Restructuring bestehender, getesteter Logik.

CONTEXT:
  Lies ZUERST diese Dateien (Source zum Portieren):
    ../scripts/auto-recall.mjs → wird assemble()
    ../scripts/auto-capture.mjs → wird ingest()
    ../scripts/bootstrap-runtime.mjs → wird bootstrap()
  ContextEngine Interface Params (EXAKT aus types.d.ts):
    assemble({sessionId, sessionKey?, messages, tokenBudget?, availableTools?, citationsMode?, model?, prompt?})
      → {messages: AgentMessage[], estimatedTokens: number, systemPromptAddition?: string}
    ingest({sessionId, sessionKey?, message: AgentMessage, isHeartbeat?})
      → {ingested: boolean}
    bootstrap({sessionId, sessionKey?, sessionFile})
      → {bootstrapped: boolean, importedMessages?: number, reason?: string}
  SDK Helpers:
    buildMemorySystemPromptAddition({availableTools, citationsMode?}) → string|undefined
      Liefert Memory/Wiki Guidance — in systemPromptAddition NACH unseren Scope Hints anhängen

EXISTING CODE:
  - src/ov-client.ts — OV HTTP Client (WORKING, aus T-001)
  - src/config.ts — Config (WORKING, aus T-001)
  - ../shared/scope-resolver.mjs — resolveScopes(cwd) (WORKING, importieren)
  - ../shared/compaction.mjs — cavemanCompact(text) (WORKING, importieren)
  - ../shared/ranking.mjs — pickMemories, postProcess, getRankingBreakdown (WORKING, importieren)

FORBIDDEN:
  - NICHT neu erfinden — Logik 1:1 aus auto-recall.mjs + auto-capture.mjs portieren
  - Kein execSync
  - isHeartbeat=true → ingest() returnt {ingested: false} sofort
  - Messages Array in assemble() NICHT mutieren — Kopie machen
  - assemble() MUSS messages unverändert zurückgeben (OC erwartet das)
  - params.prompt nutzen als Search-Query (NICHT aus messages extrahieren)

DELIVERABLES:
  - src/context-engine.ts — assemble(), ingest(), bootstrap() implementiert
  - src/hybrid-search.ts — extractKeywords + grepSearch + rrfMerge (aus auto-recall.mjs extrahiert)
  - src/scope-hints.ts — Scope Hint Builder → systemPromptAddition String
  - src/text-utils.ts — shouldCapture, sanitize, parseTranscript (aus auto-capture.mjs)

KEY MAPPING (auto-recall.mjs → assemble):
  - params.prompt = User Query (was vorher aus stdin kam)
  - params.messages = bestehender Kontext (NICHT mutieren, unverändert zurückgeben)
  - params.tokenBudget = Kontext-Budget (für Recall-Limit Skalierung)
  - params.model = Model-ID (optional, für Format-Anpassung)
  - Return: {messages: params.messages, estimatedTokens: roughEstimate, systemPromptAddition: memoryBlock + scopeHints}

KEY MAPPING (auto-capture.mjs → ingest):
  - params.message = einzelne AgentMessage (NICHT ganzes Transcript)
  - params.message.role = "user"|"assistant"|"system"
  - Nur user messages capturen (wie captureAssistantTurns=false default)
  - Content Merge: search OV für similar (>0.85) → append statt neu
  - Record Used + Auto-Link wie in auto-capture.mjs

DoD:
  - [ ] assemble() → resolveScopes → hybrid search → RRF → ranking → compaction → systemPromptAddition mit Scope Hints + buildMemorySystemPromptAddition()
  - [ ] assemble() gibt params.messages UNVERÄNDERT zurück (kein Mutieren)
  - [ ] ingest() → Content Merge (>0.85 append) → Session/Extract → Record Used → Auto-Link
  - [ ] ingest(isHeartbeat=true) → sofort {ingested: false}
  - [ ] ingest() ignoriert system messages (nur user/assistant relevant)
  - [ ] bootstrap() → CWD→Slug → /fs/stat → ov-project-sync.sh wenn leer
  - [ ] tsc compiles ohne Fehler
```

---

### Task 3: GLUE — Lifecycle + Security + Deploy

**Depends on:** T-002
**Produces:** Komplettes, deployed Plugin mit allen Methoden

#### Spawn-Prompt:
```
SCOPE: afterTurn, compact, maintain, subagent methods, dispose. Security Hardening. Build + Deploy.

OBJECTIVE: Die letzten Methoden implementieren, Security-Audit, bauen, deployen, testen.

CONTEXT:
  ContextEngine Lifecycle Methods (aus types.d.ts):
    afterTurn({sessionId, sessionKey?, sessionFile, messages, prePromptMessageCount, autoCompactionSummary?, isHeartbeat?, tokenBudget?, runtimeContext?}) → void
    compact({sessionId, sessionKey?, sessionFile, tokenBudget?, force?, currentTokenCount?, compactionTarget?, customInstructions?, runtimeContext?}) → CompactResult
    maintain({sessionId, sessionKey?, sessionFile, runtimeContext?}) → ContextEngineMaintenanceResult (= TranscriptRewriteResult)
    prepareSubagentSpawn({parentSessionKey, childSessionKey, contextMode?, parentSessionId?, parentSessionFile?, childSessionId?, childSessionFile?, ttlMs?}) → SubagentSpawnPreparation|undefined
    onSubagentEnded({childSessionKey, reason: SubagentEndReason}) → void
    dispose() → void
  SDK Helpers:
    delegateCompactionToRuntime(params) → CompactResult
      Wir delegieren compact() an OC Runtime — kein eigener Summarizer.
      Unser compact() ruft delegateCompactionToRuntime(params) auf + optional OV-spezifische Cleanup.
  SubagentEndReason = "deleted"|"completed"|"swept"|"released"

EXISTING CODE:
  - src/context-engine.ts — assemble(), ingest(), bootstrap() (WORKING, aus T-002)
  - src/ov-client.ts, src/config.ts, src/hybrid-search.ts, src/scope-hints.ts (WORKING)

IMPLEMENTATION NOTES:
  afterTurn():
    - Wenn isHeartbeat=true → skip
    - Log Turn-Stats (messages count, new messages since prePromptMessageCount)
    - Record Used: welche Memories wurden in diesem Turn genutzt
    - Background: keine blocking I/O
  compact():
    - return delegateCompactionToRuntime(params) — OC macht die schwere Arbeit
    - Kein eigener Summarizer, kein LLM-Call
  maintain():
    - runtimeContext.rewriteTranscriptEntries() nutzen um stale <relevant-memories> Blöcke zu entfernen
    - Return: {changed: boolean, bytesFreed: number, rewrittenEntries: number}
  prepareSubagentSpawn():
    - Neuen OV Agent-Scope für Child erstellen (viking://agent/{childSessionKey}/)
    - Return: {rollback: () => cleanup child scope}
  onSubagentEnded():
    - Child OV Scope aufräumen wenn reason = "deleted"|"swept"
    - Bei "completed" Memories mergen in Parent
  dispose():
    - Cleanup: pending requests abbrechen, caches leeren

FORBIDDEN:
  - openclaw.json NICHT direkt editieren — NUR openclaw config set
  - Kein execSync
  - Keine API Keys in Logs (mask in debug output)
  - Gateway NICHT starten ohne openclaw doctor --fix

DELIVERABLES:
  - src/context-engine.ts — alle Methoden komplett implementiert
  - dist/ — Compiled Plugin (npm run build)
  - /opt/openclaw/plugins/openviking-enhanced/ — Deployed

DoD:
  - [ ] npm run build → 0 errors, 0 warnings
  - [ ] grep -r "execSync" src/ → 0 Treffer
  - [ ] grep -r "console.log.*[Kk]ey" src/ → 0 Treffer
  - [ ] grep -r "apiKey" src/ | grep -v "header" | grep -v "config" → 0 (kein Key-Leak)
  - [ ] openclaw doctor --fix → clean
  - [ ] Gateway startet mit Plugin registered in Logs
  - [ ] Telegram-Nachricht → Ralph antwortet mit OV Memories im Kontext
  - [ ] Scope Hints in Gateway Debug-Log sichtbar
  - [ ] compact() delegiert korrekt an Runtime (kein eigener Summarizer)

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
