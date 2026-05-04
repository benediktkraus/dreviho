# Temporal Flow — openviking-enhanced ContextEngine

## OC Runtime Lifecycle (wann wird was aufgerufen)
```
Gateway Start
  → Plugin loaded via definePluginEntry
  → registerContextEngine("openviking-enhanced", factory)
  → factory() → new OpenVikingContextEngine()

Session Start (User schreibt erste Nachricht)
  → bootstrap({sessionId, sessionKey, sessionFile})
    → CWD→Slug → OV /fs/stat → ov-project-sync.sh wenn leer
    → Return: {bootstrapped: true/false}

Jeder Turn (User Prompt kommt rein):
  → assemble({sessionId, messages, tokenBudget, prompt, model, availableTools, citationsMode})
    → resolveScopes(cwd) → targetUris
    → PARALLEL: semantic search (N scopes) + grep search (keywords)
    → RRF merge → postProcess → rank → pickMemories
    → readMemoryContent → cavemanCompact
    → buildMemorySystemPromptAddition (SDK Helper)
    → Return: {messages: UNVERÄNDERT, estimatedTokens, systemPromptAddition: memories + scopeHints}

  → [LLM Call mit assembletem Context]

  → ingest({sessionId, message, isHeartbeat})
    → isHeartbeat? → {ingested: false}
    → message.role != "user"|"assistant"? → {ingested: false}
    → shouldCapture(text) → keyword/semantic check
    → Content Merge: search OV (>0.85) → append | session/extract
    → Record Used: POST session/{id}/used
    → Auto-Link: POST relations/link
    → Return: {ingested: true/false}

  → afterTurn({sessionId, messages, prePromptMessageCount, isHeartbeat, tokenBudget})
    → isHeartbeat? → skip
    → Log turn stats (new message count)
    → Background: keine blocking I/O

  → maintain({sessionId, sessionFile, runtimeContext})
    → Scan messages für stale <relevant-memories> Blöcke
    → runtimeContext.rewriteTranscriptEntries() → strip alte Blöcke
    → Return: {changed, bytesFreed, rewrittenEntries}

Token Budget überschritten:
  → compact({sessionId, sessionFile, tokenBudget, force, currentTokenCount, runtimeContext})
    → delegateCompactionToRuntime(params)
    → Return: CompactResult von OC Runtime

Subagent Spawn:
  → prepareSubagentSpawn({parentSessionKey, childSessionKey, contextMode, ttlMs})
    → OV: neuen Agent-Scope für Child
    → Return: {rollback: () => cleanup child scope}

Subagent Ende:
  → onSubagentEnded({childSessionKey, reason})
    → OV: Child Session/Scope aufräumen
    → Cleanup unabhängig von reason

Gateway Stop:
  → dispose()
    → Pending fetch requests abbrechen
    → Caches leeren
```

## State Transitions
```
Plugin:    UNLOADED → REGISTERED → ACTIVE → DISPOSED
Session:   NONE → BOOTSTRAPPED → ACTIVE (turns) → COMPACTED → ACTIVE → ...
Subagent:  NONE → PREPARED → ACTIVE → ENDED (cleanup)
Memory:    RECALLED → INJECTED (systemPromptAddition) → STALE (maintain strips)
Ingest:    MESSAGE → CHECKED → MERGED|EXTRACTED → LINKED
```

## Timing
- assemble() timeout: 5s (OV search + processing, AbortController)
- ingest() timeout: 10s (session/extract pipeline)
- bootstrap() timeout: 30s (project sync kann langsam sein)
- maintain(): background, kein harter Timeout
- compact(): delegiert an Runtime, deren Timeout gilt
- Health check: 3s timeout, bei Failure → graceful degradation (leere Ergebnisse)
