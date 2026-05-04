# OpenViking Hooks + OC Plugin — PRD

## Vision
Jeder AI Client im Ecosystem (Claude Code, Codex, Gemini CLI, OpenClaw) bekommt automatisch relevanten Kontext aus OpenViking injiziert und speichert neues Wissen zurück. Transparent, scope-aware, ohne manuelles Bookmarken. OpenClaw bekommt via Custom ContextEngine Plugin Feature-Parität mit den externen Hooks PLUS native OC-Features (Subagent-Mgmt, Runtime-Compaction, Transcript-Maintenance).

## Target Users / Personas

### DER OPERATOR — Benedikt
- Owner des gesamten AI-Ecosystems (VPS, 4 CLIs, OV Server)
- Pain: OC hat nur Basic-Retrieval, keine Scopes, kein Hybrid Search — schlechter als die anderen CLIs
- Goal: Feature-Parität + OC-native Extras ohne manuelles Konfigurieren
- Tech: Marketing-Background, konfiguriert über CLI-Commands, nicht über Code

### DER AGENT — Ralph (OpenClaw)
- AI Agent der via Telegram, CLI und Cron arbeitet
- Pain: Bekommt weniger Kontext als Claude Code/Codex/Gemini weil OV Plugin primitiv
- Goal: Relevante Memories in jedem Turn, automatisches Lernen, Subagent-Awareness
- Tech: Läuft als OC Gateway Service, nutzt ContextEngine Interface

### DIE FLEET — Subagents
- Von Ralph gespawnte Worker (Research, Code Review, Monitoring)
- Pain: Kein eigener OV-Scope, kein Memory-Isolation, kein Cleanup nach Ende
- Goal: Isolierter OV-Scope während Laufzeit, Cleanup danach, Parent findet ihre Ergebnisse

## Features (MoSCoW)

| Feature | Priority | Description |
|---------|----------|-------------|
| Hybrid Search in assemble() | Must | Semantic + Grep + RRF Merge — wie auto-recall.mjs |
| 5-Scope System | Must | CWD→Scope Mapping in OC Context |
| Content Merge in ingest() | Must | Dupe-Check >0.85 → append statt neu |
| Record Used Tracking | Must | Welche Memories wurden genutzt |
| Auto-Link to Project | Must | CWD→Project→Relation in OV |
| Scope Hints in systemPromptAddition | Must | Agent weiss welche Scopes aktiv sind |
| Caveman Compaction | Must | Regex-basierte Token-Reduktion bei Recall |
| bootstrap() Project Check | Must | Prüft ob Projekt-Content in OV existiert |
| delegated compact() | Should | Delegiert an OC Runtime, kein eigener Summarizer |
| maintain() Transcript Cleanup | Should | Stale memory blocks aus Transcript strippen |
| afterTurn() Stats + Record Used | Should | Post-Turn Lifecycle mit Tracking |
| ingestBatch() | Should | Batch-Ingest als Loop über ingest() |
| prepareSubagentSpawn() | Should | OV Scope für Child-Agent erstellen |
| onSubagentEnded() Cleanup | Should | Child OV Session/Scope aufräumen |
| dispose() Cleanup | Could | Pending Requests + Caches aufräumen |

### Must-Have Features (Expanded)

#### F-001: Hybrid Search in assemble()
**User Story:** "Als Ralph will ich bei jedem Turn die relevantesten Memories aus OV bekommen, gefunden durch semantische UND keyword-basierte Suche."
**Acceptance Criteria:**
- [ ] Semantic Search über alle aktiven Scope-URIs (parallel)
- [ ] Grep Search mit extrahierten Keywords (parallel zum Semantic Search)
- [ ] RRF Merge wenn Grep Ergebnisse liefert
- [ ] Ranking mit Query Profile (leaf/event/pref/overlap/authority Boosts)
- [ ] Top-K Memories nach pickMemories + postProcess
- [ ] Ergebnis als systemPromptAddition mit `<relevant-memories>` Block
**Dependencies:** OV Client, Scope Resolver, Ranking Module
**Effort:** M (Kern-Port aus auto-recall.mjs)

#### F-002: 5-Scope System
**User Story:** "Als Ralph will ich automatisch die richtigen Scopes basierend auf meinem Arbeitskontext durchsuchen."
**Acceptance Criteria:**
- [ ] resolveScopes(cwd) bestimmt aktive Scopes + Target URIs
- [ ] System + Knowledge Scopes immer aktiv
- [ ] Project Scope wenn CWD unter project_base_paths
- [ ] Infra Scope wenn kein Project oder CWD matched infra_patterns
- [ ] Personal Scope nur für personal_projects
**Dependencies:** Shared scope-resolver.mjs
**Effort:** S (Import aus shared/)

#### F-003: Content Merge in ingest()
**User Story:** "Als Ralph will ich nicht 50 Duplikate der gleichen Info speichern, sondern bestehende Memories erweitern."
**Acceptance Criteria:**
- [ ] Vor Capture: OV Search mit Content-Preview, Score >0.85 = Duplikat
- [ ] Duplikat gefunden → content/write append statt neuer Session/Extract
- [ ] Kein Duplikat → normale Session→Message→Extract Pipeline
- [ ] isHeartbeat=true → sofort {ingested: false}
- [ ] system Messages ignorieren (nur user/assistant)
**Dependencies:** OV Client
**Effort:** M (Port aus auto-capture.mjs)

#### F-004: bootstrap() Project Check
**User Story:** "Als Ralph will ich beim Session-Start wissen ob mein Projekt-Content in OV existiert und ihn sonst syncen."
**Acceptance Criteria:**
- [ ] CWD→Project Slug ermitteln
- [ ] OV /fs/stat auf viking://resources/projects/{slug}/
- [ ] Wenn leer: ov-project-sync.sh triggern (execFileSync mit Array)
- [ ] Return: {bootstrapped: true/false, reason}
**Dependencies:** OV Client, Scope Resolver
**Effort:** S (Port aus bootstrap-runtime.mjs)

## Constraints
- Budget: $0 (Open Source, eigene Infra)
- Timeline: 1 Titan Session (4-6h)
- Team: Solo (Claude Code + Titan Factory Line)
- Tech: TypeScript, OC Plugin SDK, native fetch only
- Deploy: /opt/openclaw/plugins/openviking-enhanced/
- Config: NUR via `openclaw config set`, NIEMALS JSON direkt

## Security Requirements
- API Keys nur in Env Vars (OPENVIKING_API_KEY), nie in Code/Logs
- Auth Headers: X-API-Key, X-OpenViking-Agent, X-OpenViking-Account, X-OpenViking-User
- Kein execSync — nur execFileSync mit Array-Args (Command Injection Prevention)
- Keine hardcoded Pfade (OPENVIKING_HOME env)
- grep -r "console.log.*[Kk]ey" src/ → 0 Treffer als DoD
- OV läuft lokal (localhost:1933) — kein TLS nötig für Plugin↔OV

## Risks
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| OC Plugin SDK Breaking Changes | Low | High | Pin OC Version, types.d.ts als Referenz |
| OV Busy Locks bei Rapid Writes | Medium | Medium | Retry-Logic in OV Client, merge failure = non-fatal |
| Shared Module Changes brechen andere CLIs | Medium | High | Tests vor Deploy, shared/ ist SSoT |
| Gateway startet nicht mit neuem Plugin | Low | High | openclaw doctor --fix, Logs prüfen |

## Non-Functional Requirements
- assemble() Latenz: <2s (OV Search + Ranking + Compaction)
- ingest() non-blocking: Capture darf Turn nicht verzögern
- Memory Footprint: Plugin soll <50MB RAM nutzen
- Graceful Degradation: OV down → Plugin gibt leere Ergebnisse, kein Crash

## Open Questions
- Soll maintain() auch in afterTurn() getriggert werden oder nur vom OC Runtime?
  → Default: Nur vom Runtime (maintain() ist separat)
- Soll ingestBatch() atomisch sein (alle oder keine) oder best-effort?
  → Default: Best-effort (loop über ingest, count successes)
- Maximale Anzahl Subagent-Scopes bevor Cleanup erzwungen wird?
  → Default: Kein Limit, onSubagentEnded() räumt auf
