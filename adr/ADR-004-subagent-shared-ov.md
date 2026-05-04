# ADR-004: Subagent Memory über Shared OV statt explizitem Merge

## Context
OC spawnt Subagents (Research, Code Review). Jeder bekommt prepareSubagentSpawn() und onSubagentEnded(). Frage: Sollen Subagent-Memories explizit in den Parent gemergt werden?

## Decision
Nein. Parent und Subagent arbeiten gegen denselben OV Server. Was der Subagent via ingest() speichert, findet der Parent beim nächsten assemble() automatisch via Suche. Kein explizites Mergen nötig.

onSubagentEnded() macht in allen Fällen (completed, deleted, swept, released) dasselbe: Cleanup der Child OV Session und temporärer Scopes.

## Alternatives Considered
- **Expliziter Merge:** Nach Subagent-Ende alle Child-Memories lesen und in Parent-Scope kopieren. Overhead, Duplikate, unnötig wenn OV ohnehin shared ist.
- **Scope-Isolation ohne Merge:** Subagent schreibt in isolierten Scope, wird nach Ende gelöscht. Verliert wertvolle Ergebnisse.

## Consequences
- Einfache Implementation: Cleanup only
- Subagent-Ergebnisse sind sofort für Parent suchbar
- Kein Risiko von Duplikaten durch Merge
