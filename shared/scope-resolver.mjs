/**
 * OV Scope Resolver — CWD → active scopes → target URIs
 *
 * Shared module for all CLI hooks (Claude Code, Codex, Gemini, OpenClaw).
 * Config lives in $OPENVIKING_HOME/scope-config.json (default: ~/.openviking/).
 *
 * 5 Scopes: project:<slug>, system, infra, knowledge, personal
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_PATH = join(homedir(), ".openviking", "scope-config.json");

let _config = null;

function loadScopeConfig() {
  if (_config) return _config;
  try {
    _config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    _config = {
      personal_projects: [],
      infra_patterns: [],
      project_base_paths: [],
      scopes: {},
      source_authority: { user_verified: 2.0, user_input: 1.5, agent_verified: 1.2, auto_captured: 1.0, verified_recall_threshold: 5 },
      compaction: { enabled: true, strategy: "caveman" },
    };
  }
  return _config;
}

/**
 * Resolve CWD to active scopes and target URIs for OV recall.
 *
 * @param {string} cwd - Current working directory
 * @returns {{ scopes: string[], targetUris: string[], projectSlug: string|null }}
 */
export function resolveScopes(cwd) {
  const cfg = loadScopeConfig();
  const scopes = ["system"];
  const targetUris = [
    "viking://resources/system/",
    "viking://user/memories/",
    "viking://agent/memories/",
    "viking://agent/skills/",
  ];
  let projectSlug = null;

  // Detect project from CWD
  for (const basePath of cfg.project_base_paths) {
    if (cwd.startsWith(basePath)) {
      const rest = cwd.slice(basePath.length);
      const slug = rest.split("/")[0];
      if (slug) {
        projectSlug = slug;
        scopes.push(`project:${slug}`);
        targetUris.push(`viking://resources/projects/${slug}/`);
        break;
      }
    }
  }

  // Infra scope — active when no project, or when project matches infra patterns
  const infraActive = !projectSlug ||
    cfg.infra_patterns.some(p => cwd.toLowerCase().includes(p.toLowerCase()));
  if (infraActive) {
    scopes.push("infra");
    targetUris.push("viking://resources/infra/");
  }

  // Personal scope — only for life projects
  if (projectSlug && cfg.personal_projects.includes(projectSlug)) {
    scopes.push("personal");
    targetUris.push("viking://user/memories/personal/");
  }

  // Knowledge scope — always active, low priority
  scopes.push("knowledge");
  targetUris.push("viking://resources/knowledge/");

  return { scopes, targetUris, projectSlug };
}

/**
 * Source-authority score multiplier based on URI and context_type.
 * Higher = more trusted.
 *
 * @param {{ uri: string, context_type: string, active_count?: number }} item
 * @returns {number} Multiplier (1.0 = baseline)
 */
export function sourceAuthorityMultiplier(item) {
  const cfg = loadScopeConfig();
  const sa = cfg.source_authority;
  const uri = (item.uri || "").toLowerCase();

  // Verified memories (explicit /verify or high recall count)
  if (uri.includes("/verified/")) return sa.user_verified;
  if (typeof item.active_count === "number" && item.active_count >= sa.verified_recall_threshold) {
    return sa.agent_verified;
  }

  // User memories = user-input tier
  if (item.context_type === "memory") return sa.user_input;

  // Agent skills
  if (item.context_type === "skill") return sa.agent_verified;

  // Resources = baseline
  return sa.auto_captured;
}

/**
 * Get compaction config.
 */
export function getCompactionConfig() {
  return loadScopeConfig().compaction;
}

/**
 * Get the scope config object.
 */
export function getScopeConfig() {
  return loadScopeConfig();
}
