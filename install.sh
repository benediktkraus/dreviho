#!/usr/bin/env bash
# install.sh — Install OpenViking hooks for your CLI
# Usage: ./install.sh [claude-code|codex|gemini|openclaw|all]
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OV_HOME="${OPENVIKING_HOME:-$HOME/.openviking}"

info() { echo "[ov-hooks] $*"; }
fail() { echo "[ov-hooks] ERROR: $*" >&2; exit 1; }

install_shared() {
  mkdir -p "$OV_HOME"
  cp "$SCRIPT_DIR/shared/scope-resolver.mjs" "$OV_HOME/"
  cp "$SCRIPT_DIR/shared/compaction.mjs" "$OV_HOME/"
  cp "$SCRIPT_DIR/shared/ranking.mjs" "$OV_HOME/"
  cp "$SCRIPT_DIR/shared/decay-cache.mjs" "$OV_HOME/"
  [[ ! -f "$OV_HOME/scope-config.json" ]] && cp "$SCRIPT_DIR/shared/scope-config.json" "$OV_HOME/"
  info "shared modules → $OV_HOME/"
}

install_hook_scripts() {
  local dir="$1"
  mkdir -p "$dir"
  for f in \
    auto-recall \
    auto-capture \
    config \
    debug-log \
    pre-compact \
    subagent-scope \
    bootstrap-runtime \
    runtime-common
  do
    cp "$SCRIPT_DIR/scripts/${f}.mjs" "$dir/"
  done
}

install_plugin_shared() {
  local dir="$1/shared"
  mkdir -p "$dir"
  cp "$SCRIPT_DIR/shared/scope-resolver.mjs" "$dir/"
  cp "$SCRIPT_DIR/shared/compaction.mjs" "$dir/"
  cp "$SCRIPT_DIR/shared/ranking.mjs" "$dir/"
  cp "$SCRIPT_DIR/shared/decay-cache.mjs" "$dir/"
  cp "$SCRIPT_DIR/shared/scope-config.json" "$dir/"
}

update_codex_marketplace() {
  local mkt="$1"
  mkdir -p "$mkt/.agents/plugins"
  python3 - "$mkt/.agents/plugins/marketplace.json" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
if path.exists():
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError:
        data = {}
else:
    data = {}

if not isinstance(data, dict):
    data = {}

data.setdefault("name", "local-plugins")
data.setdefault("interface", {"displayName": "Local Plugins"})

plugins = data.get("plugins")
if isinstance(plugins, dict):
    converted = []
    for name, meta in plugins.items():
        converted.append({
            "name": name,
            "source": {"source": "local", "path": f"./plugins/{name}"},
            "policy": {"installation": meta.get("installStatus", "INSTALLED_BY_DEFAULT")},
            "category": meta.get("category", "Productivity"),
        })
    plugins = converted
elif not isinstance(plugins, list):
    plugins = []

entry = {
    "name": "openviking-memory",
    "source": {"source": "local", "path": "./plugins/openviking-memory"},
    "policy": {"installation": "INSTALLED_BY_DEFAULT", "authentication": "ON_INSTALL"},
    "category": "Productivity",
}
plugins = [p for p in plugins if not (isinstance(p, dict) and p.get("name") == "openviking-memory")]
plugins.insert(0, entry)
data["plugins"] = plugins

path.write_text(json.dumps(data, indent=2) + "\n")
PY
}

install_claude_code() {
  local dir="$OV_HOME/claude-code-memory-plugin"
  mkdir -p "$dir"
  [[ ! -f "$dir/config.json" ]] && cp "$SCRIPT_DIR/config/claude-code.json" "$dir/config.json" && info "config template → $dir/config.json (edit: set API key)"
  info "claude-code: hooks install via Claude Code plugin marketplace"
  info "  /plugin marketplace add <this-repo-url>"
  info "  /plugin install claude-code-memory-plugin@openviking-hooks"
}

install_codex() {
  local mkt="$HOME/local-marketplace"
  local dir="$mkt/plugins/openviking-memory"
  mkdir -p "$dir/scripts" "$dir/.codex-plugin"
  cp "$SCRIPT_DIR/hooks/codex-plugin.json" "$dir/.codex-plugin/plugin.json"
  cp "$SCRIPT_DIR/hooks/codex-cli.json" "$dir/hooks.json"
  install_hook_scripts "$dir/scripts"
  install_plugin_shared "$dir"
  update_codex_marketplace "$mkt"
  local cfg="$OV_HOME/codex-memory-plugin"
  mkdir -p "$cfg"
  [[ ! -f "$cfg/config.json" ]] && cp "$SCRIPT_DIR/config/codex.json" "$cfg/config.json" && info "config template → $cfg/config.json (edit: set API key)"
  info "codex: plugin → $dir"
  info "  run: codex plugin marketplace add $mkt"
}

install_gemini() {
  local dir="$HOME/.gemini/extensions/openviking-memory"
  mkdir -p "$dir/scripts" "$dir/hooks"
  cp "$SCRIPT_DIR/hooks/gemini-cli.json" "$dir/hooks/hooks.json"
  cp "$SCRIPT_DIR/hooks/gemini-extension.json" "$dir/gemini-extension.json"
  install_hook_scripts "$dir/scripts"
  install_plugin_shared "$dir"
  # Enable extension
  local enable="$HOME/.gemini/extensions/extension-enablement.json"
  if [[ -f "$enable" ]]; then
    python3 -c "
import json
d=json.load(open('$enable'))
d['openviking-memory']={'overrides':['~/*']}
json.dump(d,open('$enable','w'),indent=2)
" 2>/dev/null && info "gemini: extension enabled"
  fi
  local cfg="$OV_HOME/gemini-memory-plugin"
  mkdir -p "$cfg"
  [[ ! -f "$cfg/config.json" ]] && cp "$SCRIPT_DIR/config/gemini-cli.json" "$cfg/config.json" && info "config template → $cfg/config.json (edit: set API key)"
  info "gemini: extension → $dir"
}

install_openclaw() {
  if command -v openclaw &>/dev/null; then
    openclaw config set plugins.entries.openviking.enabled false 2>/dev/null
    openclaw config set plugins.entries.openviking-enhanced.enabled true 2>/dev/null
    openclaw config set plugins.entries.openviking-enhanced.config.agentId "${OV_AGENT_ID:-openclaw}" 2>/dev/null
    openclaw config set plugins.entries.openviking-enhanced.config.recallLimit 10 2>/dev/null
    openclaw config set plugins.entries.openviking-enhanced.config.scoreThreshold 0.1 2>/dev/null
    openclaw config set plugins.slots.contextEngine openviking-enhanced 2>/dev/null
    info "openclaw: openviking-enhanced contextEngine configured"
    info "  set OV_AGENT_ID env to customize agent tag (default: openclaw)"
    info "  env vars OPENVIKING_URL, OPENVIKING_API_KEY, OPENVIKING_ACCOUNT, OPENVIKING_USER must be configured for the gateway"
  else
    info "openclaw: not installed, skipping. Manual config in config/openclaw-plugin.json"
  fi
}

# --- Main ---
CLI="${1:-all}"

install_shared

case "$CLI" in
  claude-code|claude) install_claude_code ;;
  codex)              install_codex ;;
  gemini)             install_gemini ;;
  openclaw|oc)        install_openclaw ;;
  all)
    install_claude_code
    install_codex
    install_gemini
    install_openclaw
    ;;
  *) fail "Unknown CLI: $CLI. Use: claude-code, codex, gemini, openclaw, all" ;;
esac

info "done. Edit config files to set your API key, account, and user."
