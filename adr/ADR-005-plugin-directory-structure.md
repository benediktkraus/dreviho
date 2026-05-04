# ADR-005: Plugin-Verzeichnis nach OC Convention

## Context
OC Plugins leben unter /opt/openclaw/plugins/{name}/. Referenz: oc-langfuse-bridge Plugin. Unser Source lebt im Repo unter openclaw-plugin/. Frage: Wo wird entwickelt, wo deployed?

## Decision
Source: `openclaw-plugin/` im Repo (openviking-hooks-fork). Deploy: `/opt/openclaw/plugins/openviking-enhanced/`. Build erzeugt dist/, das nach /opt/ kopiert wird (mit package.json, openclaw.plugin.json, node_modules).

Struktur nach OC Convention:
- openclaw.plugin.json — Plugin-Metadata (id, name, description, configSchema)
- package.json — NPM mit `openclaw.extensions: ["dist/index.js"]`
- dist/index.js — Compiled entry
- node_modules/ — Dependencies

## Alternatives Considered
- **Separates Repo:** Overhead, shared/ Module müssten kopiert oder als npm Package veröffentlicht werden.
- **Direkt in /opt/ entwickeln:** Kein Git, keine CI, kein Review.

## Consequences
- Source im Repo = versioniert, reviewable, CI-fähig
- Deploy = npm run build + copy to /opt/openclaw/plugins/
- shared/ Modules via relativen Import (../shared/) im Source, im Deploy via OPENVIKING_HOME
