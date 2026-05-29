#!/usr/bin/env bash
# install-mac.sh — Setup OpenViking hooks on macOS (remote mode, connects to VPS)
# Usage: ./install-mac.sh [claude|codex|gemini|all]
# Requires: Node.js 18+
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OV_HOME="${OPENVIKING_HOME:-$HOME/.openviking}"
OV_URL="${OPENVIKING_URL:-https://your-ov-server.example.com}"

info()  { printf "[ov-mac] %s\n" "$*"; }
warn()  { printf "[ov-mac] WARN: %s\n" "$*" >&2; }
fail()  { printf "[ov-mac] ERROR: %s\n" "$*" >&2; exit 1; }

check_deps() {
  command -v node &>/dev/null || fail "Node.js not found. Install: brew install node"
  local v
  v=$(node -e "process.exit(parseInt(process.versions.node) < 18 ? 1 : 0)" 2>/dev/null)
  [[ $? -eq 0 ]] || fail "Node.js 18+ required (found: $(node --version))"
}

install_shared() {
  mkdir -p "$OV_HOME"
  cp "$SCRIPT_DIR/shared/scope-resolver.mjs" "$OV_HOME/"
  cp "$SCRIPT_DIR/shared/compaction.mjs" "$OV_HOME/"
  cp "$SCRIPT_DIR/shared/ranking.mjs" "$OV_HOME/"
  cp "$SCRIPT_DIR/shared/decay-cache.mjs" "$OV_HOME/"
  if [[ ! -f "$OV_HOME/scope-config.json" ]]; then
    cp "$SCRIPT_DIR/shared/scope-config.json" "$OV_HOME/"
  fi
  info "shared modules → $OV_HOME/"
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
  python3 - "$mkt/.agents/plugins/marketplace.json" <<'PYEOF'
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
PYEOF
}

write_remote_config() {
  # All Mac CLIs share one config (claude-code-memory-plugin/ is the fallback for all)
  # agentId in the config file distinguishes per-CLI writes in OV
  local dir="$OV_HOME/claude-code-memory-plugin"
  mkdir -p "$dir"
  if [[ -f "$dir/config.json" ]]; then
    info "config exists at $dir/config.json — skipping (delete to reset)"
    return
  fi
  cat > "$dir/config.json" << EOF
{
  "mode": "remote",
  "baseUrl": "${OV_URL}",
  "apiKey": "REPLACE_WITH_YOUR_OV_API_KEY",
  "agentId": "mac",
  "account": "YOUR_ACCOUNT",
  "user": "YOUR_USER",
  "recallLimit": 10,
  "scoreThreshold": 0.1,
  "autoRecall": true,
  "autoCapture": true,
  "captureAssistantTurns": true
}
EOF
  info "remote config → $dir/config.json"
  warn "IMPORTANT: edit $dir/config.json — set apiKey to your OV root_api_key"
}

install_scripts() {
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

install_claude() {
  local scripts_dir="$HOME/.claude/plugins/openviking-remote/scripts"

  install_scripts "$scripts_dir"
  write_remote_config
  info "scripts → $scripts_dir"

  # Add hooks to ~/.claude/settings.json
  local settings="$HOME/.claude/settings.json"
  if [[ ! -f "$settings" ]]; then
    echo '{}' > "$settings"
    info "created ~/.claude/settings.json"
  fi

  # Check if hooks already exist
  if python3 -c "import json; d=json.load(open('$settings')); exit(0 if 'UserPromptSubmit' in d.get('hooks',{}) else 1)" 2>/dev/null; then
    warn "hooks already in $settings — check UserPromptSubmit + Stop manually"
    return
  fi

  python3 - "$settings" "$scripts_dir" << 'PYEOF'
import json, sys
settings_path, scripts_dir = sys.argv[1], sys.argv[2]
d = json.load(open(settings_path))
if 'hooks' not in d:
    d['hooks'] = {}
h = d['hooks']
# UserPromptSubmit
h.setdefault('UserPromptSubmit', []).append({
    "matcher": "",
    "hooks": [{"type": "command", "command": f"node {scripts_dir}/auto-recall.mjs", "timeout": 15000}]
})
# Stop (auto-capture)
h.setdefault('Stop', []).append({
    "matcher": "",
    "hooks": [{"type": "command", "command": f"node {scripts_dir}/auto-capture.mjs", "timeout": 30000}]
})
json.dump(d, open(settings_path, 'w'), indent=2)
print(f"hooks added to {settings_path}")
PYEOF
  info "claude hooks configured in $settings"
}

install_codex() {
  local mkt="$HOME/local-marketplace"
  local dir="$mkt/plugins/openviking-memory"

  mkdir -p "$dir/scripts" "$dir/.codex-plugin"
  cp "$SCRIPT_DIR/hooks/codex-plugin.json" "$dir/.codex-plugin/plugin.json"
  cp "$SCRIPT_DIR/hooks/codex-cli.json" "$dir/hooks.json"
  install_scripts "$dir/scripts"
  install_plugin_shared "$dir"
  write_remote_config
  update_codex_marketplace "$mkt"
  info "codex plugin → $dir"
  info "  run: codex plugin marketplace add $mkt"
}

install_gemini() {
  local dir="$HOME/.gemini/extensions/openviking-memory"

  mkdir -p "$dir/scripts" "$dir/hooks"
  cp "$SCRIPT_DIR/hooks/gemini-cli.json" "$dir/hooks/hooks.json"
  cp "$SCRIPT_DIR/hooks/gemini-extension.json" "$dir/gemini-extension.json"
  install_scripts "$dir/scripts"
  install_plugin_shared "$dir"
  write_remote_config

  local enable="$HOME/.gemini/extensions/extension-enablement.json"
  if [[ -f "$enable" ]]; then
    python3 -c "
import json
d=json.load(open('$enable'))
d['openviking-memory']={'overrides':['~/*']}
json.dump(d,open('$enable','w'),indent=2)
" 2>/dev/null && info "gemini: extension enabled"
  else
    warn "gemini: extension-enablement.json not found — enable openviking-memory manually"
  fi
  info "gemini extension → $dir"
}

# --- Main ---
check_deps
install_shared

CLI="${1:-all}"
case "$CLI" in
  claude)        install_claude ;;
  codex)         install_codex ;;
  gemini)        install_gemini ;;
  all)
    install_claude
    install_codex
    install_gemini
    ;;
  *) fail "Unknown CLI: $CLI. Use: claude, codex, gemini, all" ;;
esac

echo ""
info "=== Next steps ==="
info "1. Set your OV API key (one shared config for all CLIs):"
info "   $OV_HOME/claude-code-memory-plugin/config.json"
info "   → set apiKey to the root_api_key from your OV server's ov.conf"
info "2. Restart your CLI apps"
info "3. Test: ask your AI something it should remember from previous sessions"
