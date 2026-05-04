# ADR-002: Compaction an OC Runtime delegieren

## Context
ContextEngine.compact() muss implementiert werden. Eigene Compaction braucht einen LLM-Summarizer — teuer, komplex, fehleranfällig. OC bietet `delegateCompactionToRuntime()` als Helper für Third-Party-Engines.

## Decision
`ownsCompaction = false` setzen. compact() ruft `delegateCompactionToRuntime(params)` auf. OC Runtime macht die Zusammenfassung mit ihrem eingebauten Summarizer.

## Alternatives Considered
- **Eigener Summarizer:** LLM-Call für Zusammenfassung. Kosten pro Compaction, Latenz, Fehlerrisiko. Kein Mehrwert gegenüber OC Runtime.
- **Caveman Compaction:** Regex-basiert wie bei Recall. Aber Transcript-Compaction braucht Verständnis, nicht nur Formatierung.
- **ownsCompaction=true ohne eigene Logik:** Würde OC Runtime blockieren und zu Token-Overflow führen.

## Consequences
- Kein eigener Summarizer nötig — $0 Compaction-Kosten
- OC Runtime hat volle Kontrolle über Compaction-Timing
- Wenn OC Runtime-Compaction schlecht wird → wir können jederzeit auf eigene umsteigen
