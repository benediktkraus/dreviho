# ADR-001: Custom ContextEngine statt eingebautem OV Plugin

## Context
OpenClaw hat ein eingebautes OV Plugin das nur Basic-Retrieval kann — kein Scoping, kein Hybrid Search, kein Content Merge, kein Record Used. Die externen Hooks (Claude Code, Codex, Gemini) haben alle diese Features. OC ist der einzige Client ohne Feature-Parität.

## Decision
Eigenes OC ContextEngine Plugin "openviking-enhanced" bauen. Das eingebaute Plugin deaktivieren (`plugins.entries.openviking.enabled = false`) und unser Plugin als `plugins.slots.contextEngine = "openviking-enhanced"` setzen.

## Alternatives Considered
- **Eingebautes Plugin patchen:** Nicht möglich — es ist Teil von OC Core, Updates überschreiben Patches.
- **Nur Hooks nutzen (wie bei den anderen CLIs):** OC Hooks haben weniger Lifecycle-Zugriff als ContextEngine (kein compact, maintain, subagent). Ausserdem: OC hat KEIN Hook-System wie Claude Code — es nutzt ContextEngine nativ.
- **PR an OC Upstream:** Zu viele Custom-Features (Scoping, Hybrid Search), passt nicht in ein Generic-Plugin.

## Consequences
- Volle Kontrolle über alle 8 ContextEngine Methoden
- Muss bei OC Updates auf SDK-Kompatibilität prüfen
- Shared Modules (scope-resolver, compaction, ranking) werden von Hooks UND Plugin genutzt
- Deploy-Pfad: /opt/openclaw/plugins/openviking-enhanced/
