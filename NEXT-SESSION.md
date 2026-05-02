# Next Session Prompt

Paste this into a new Claude Code session in the openviking-hooks-fork directory:

```
Projekt: openviking-enhanced — Custom OC ContextEngine Plugin

CWD: /mnt/onedrive/Workspace/projects/openviking-hooks-fork

Kontext:
- Wir haben ein OV Memory Hook System für 4 AI CLIs gebaut (GitHub: benediktkraus/openviking-hooks)
- Claude Code, Codex, Gemini haben externe Hooks (auto-recall + auto-capture) mit: 5-Scope System, Hybrid Search (semantic+grep+RRF), Content Merge, Record Used, Auto-Link, Caveman Compaction, Scope Hints
- OpenClaw hat ein eingebautes OV Plugin das NUR Basic-Retrieval kann — kein Scoping, kein Hybrid Search
- Wir wollen das eingebaute Plugin ersetzen durch ein eigenes das ALLE unsere Features hat
- TASK-GUIDE.md liegt im Repo (3 Tasks, 4-6h, 1 Titan Session)
- Basis-Code: https://github.com/Castor6/openviking-plugins openclaw-plugin/ Ordner
- OC Plugin SDK: definePluginEntry() + registerContextEngine() + ContextEngine Interface (8 Methoden)
- Shared Modules existieren unter shared/ (scope-resolver, compaction, ranking)
- Bestehende Hook-Logik in scripts/auto-recall.mjs + auto-capture.mjs — wird 1:1 portiert

Ablauf:
1. /shape — Specs bauen (CLAUDE.md, PRD.md, specs/) aus TASK-GUIDE.md + OC Plugin SDK Types
2. /decompose — Tasks verfeinern falls nötig (TASK-GUIDE.md existiert schon)
3. /titan — Factory Line bauen

Lies zuerst:
- TASK-GUIDE.md (3 Tasks mit Spawn-Prompts)
- CLAUDE.md (Projekt-Entscheidungen)
- shared/ (scope-resolver.mjs, compaction.mjs, ranking.mjs)
- scripts/auto-recall.mjs + auto-capture.mjs (die Logik die portiert wird)
- /usr/lib/node_modules/openclaw/dist/plugin-sdk/src/context-engine/types.d.ts (das Interface)
- /mnt/onedrive/Workspace/docs/OPENCLAW-OV-INTEGRATION.md (wie OC + OV zusammenspielen)

REGEL: openclaw config set für Config-Änderungen, NIEMALS JSON direkt editieren.

Starte mit /shape.
```
