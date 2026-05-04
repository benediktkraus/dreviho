# ADR-003: maintain() für Transcript-Hygiene

## Context
Jeder assemble() Call injiziert `<relevant-memories>` Blöcke als systemPromptAddition. Nach mehreren Turns enthält das Transcript veraltete Memory-Blöcke die Tokens verschwenden. maintain() wird nach jedem Turn aufgerufen und kann Transcript-Einträge umschreiben.

## Decision
maintain() scannt Transcript-Messages nach `<relevant-memories>` Blöcken in älteren Turns (nicht der aktuelle). Findet es welche, nutzt es `runtimeContext.rewriteTranscriptEntries()` um sie zu strippen. Das spart Tokens und hält den Kontext sauber.

## Alternatives Considered
- **Nichts tun:** Memory-Blöcke akkumulieren. Bei langen Sessions 5-10 stale Blöcke × 500 Tokens = 5K verschwendete Tokens.
- **Nur bei Compaction aufräumen:** Zu spät — Compaction wird erst bei Token-Overflow getriggert.
- **Memory-Blöcke nicht ins Transcript schreiben:** Nicht möglich — systemPromptAddition wird von OC Runtime in den Kontext eingefügt.

## Consequences
- Token-Einsparung: ~500 Tokens pro gestriptem Block
- Minimal: maintain() ist background, kein Performance-Impact
- Risiko: Wenn ein Memory-Block noch relevant ist → wird beim nächsten assemble() frisch geholt
