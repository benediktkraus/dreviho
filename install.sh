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
  [[ ! -f "$OV_HOME/scope-config.json" ]] && cp "$SCRIPT_DIR/shared/scope-config.json" "$OV_HOME/"
  info "shared modules → $OV_HOME/"
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
  cp "$SCRIPT_DIR/scripts/auto-recall.mjs" "$dir/scripts/"
  cp "$SCRIPT_DIR/scripts/auto-capture.mjs" "$dir/scripts/"
  cp "$SCRIPT_DIR/scripts/config.mjs" "$dir/scripts/"
  cp "$SCRIPT_DIR/scripts/debug-log.mjs" "$dir/scripts/"
  # Marketplace manifest
  mkdir -p "$mkt/.agents/plugins"
  cat > "$mkt/.agents/plugins/marketplace.json" << 'MKT'
{"plugins":{"openviking-memory":{"installStatus":"INSTALLED_BY_DEFAULT","icon":"🧠"}}}
MKT
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
  cp "$SCRIPT_DIR/scripts/auto-recall.mjs" "$dir/scripts/"
  cp "$SCRIPT_DIR/scripts/auto-capture.mjs" "$dir/scripts/"
  cp "$SCRIPT_DIR/scripts/config.mjs" "$dir/scripts/"
  cp "$SCRIPT_DIR/scripts/debug-log.mjs" "$dir/scripts/"
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
    openclaw config set plugins.entries.openviking.enabled true 2>/dev/null
    openclaw config set plugins.entries.openviking.config.agentId "${OV_AGENT_ID:-openclaw}" 2>/dev/null
    openclaw config set plugins.entries.openviking.config.recallLimit 10 2>/dev/null
    openclaw config set plugins.entries.openviking.hooks.allowConversationAccess true 2>/dev/null
    openclaw config set plugins.slots.contextEngine openviking 2>/dev/null
    info "openclaw: plugin + contextEngine configured"
    info "  set OV_AGENT_ID env to customize agent tag (default: openclaw)"
    info "  env vars OPENVIKING_URL + OPENVIKING_API_KEY must be in gateway.service"
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
