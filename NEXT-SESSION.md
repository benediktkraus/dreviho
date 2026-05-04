# Next Session Prompt

## OC Plugin aktivieren (Gateway Restart)
```
openclaw config set plugins.slots.contextEngine openviking-enhanced
openclaw config set plugins.entries.openviking.enabled false
sudo XDG_RUNTIME_DIR=/run/user/0 openclaw doctor --fix
sudo XDG_RUNTIME_DIR=/run/user/0 systemctl --user restart openclaw-gateway
journalctl --user -u openclaw-gateway -n 30 | grep -i viking
```

## Hooks Parität nachziehen
```
Projekt: openviking-hooks-fork — Hook Features nachziehen

CWD: /mnt/onedrive/Workspace/projects/openviking-hooks-fork

Status:
- OC Plugin "openviking-enhanced" ist gebaut und deployed nach /opt/openclaw/plugins/
- Alle 8+ ContextEngine Methoden implementiert
- OC hat jetzt 4 Features die die Hooks noch nicht haben:
  1. Subagent Scope Isolation (Hook bei Agent-Spawn → OV Scope erstellen)
  2. Subagent Cleanup (Hook bei Agent-Ende → Cleanup)
  3. Batch Ingest (Stop Hook könnte mehrere Turns batchen)
  4. Transcript Cleanup (Recall könnte alte Blöcke erkennen + nicht nochmal injizieren)

Aufgaben:
1. Claude Code Agent Tool: Subagent-Hooks in auto-recall/capture nachziehen
2. Codex: gleich
3. Gemini: gleich
4. OC Plugin testen: Gateway restart, Telegram-Test, Scope Hints prüfen
5. GitHub push

REGEL: openclaw config set für Config, NIEMALS JSON direkt.
```
