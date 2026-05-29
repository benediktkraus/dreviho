#!/usr/bin/env node

/**
 * Subagent Scope Hook — Claude Code SubagentStart/SubagentStop
 *
 * SubagentStart: Creates OV scope marker for child agent
 * SubagentStop: Cleans up child scope metadata (memories stay in OV)
 *
 * Triggered by SubagentStart and SubagentStop hook events.
 */

import { loadConfig } from "./config.mjs";
import { createLogger } from "./debug-log.mjs";

const cfg = loadConfig();
const { log, logError } = createLogger("subagent-scope");

function output(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function fetchJSON(path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const headers = { "Content-Type": "application/json" };
    if (cfg.apiKey) headers["X-API-Key"] = cfg.apiKey;
    if (cfg.agentId) headers["X-OpenViking-Agent"] = cfg.agentId;
    if (cfg.account) headers["X-OpenViking-Account"] = cfg.account;
    if (cfg.user) headers["X-OpenViking-User"] = cfg.user;
    const res = await fetch(`${cfg.baseUrl}${path}`, { ...init, headers, signal: controller.signal });
    const body = await res.json();
    if (!res.ok || body.status === "error") return null;
    return body.result ?? body;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function writeContent(uri, content, preferredMode = "replace") {
  const result = await fetchJSON("/api/v1/content/write", {
    method: "POST",
    body: JSON.stringify({ uri, content, mode: preferredMode }),
  });
  if (result) return result;

  const fallbackMode = preferredMode === "create" ? "replace" : "create";
  return fetchJSON("/api/v1/content/write", {
    method: "POST",
    body: JSON.stringify({ uri, content, mode: fallbackMode }),
  });
}

async function main() {
  let input;
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    input = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    output({});
    return;
  }

  const hookEvent = input.hook_event || input.hookEvent || "";
  const sessionId = input.session_id || input.sessionId || "";
  const agentId = input.agent_id || input.agentId || "";

  if (hookEvent === "SubagentStart" || hookEvent === "subagent_start") {
    log("subagent_start", { sessionId, agentId });
    // Create scope marker for child agent
    const childUri = `viking://agent/${agentId || sessionId}/meta/spawn`;
    await writeContent(childUri, JSON.stringify({
      parent: cfg.agentId,
      spawned: new Date().toISOString(),
      hook: "SubagentStart",
    }), "create");
    log("scope_created", { childUri });
  }

  if (hookEvent === "SubagentStop" || hookEvent === "subagent_stop") {
    log("subagent_stop", { sessionId, agentId });
    // Cleanup spawn metadata (memories stay accessible via shared OV)
    const childUri = `viking://agent/${agentId || sessionId}/meta/spawn`;
    await writeContent(childUri, "", "replace");
    log("scope_cleaned", { childUri });
  }

  output({});
}

main().catch((err) => { logError("uncaught", err); output({}); });
