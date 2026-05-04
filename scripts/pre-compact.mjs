#!/usr/bin/env node

/**
 * Pre-Compaction Hook — Claude Code PreCompact / Gemini PreCompress
 *
 * Before context compaction: save current session stats to OV
 * so memories about what happened in this session survive compaction.
 */

import { loadConfig } from "./config.mjs";
import { createLogger } from "./debug-log.mjs";

const cfg = loadConfig();
const { log, logError } = createLogger("pre-compact");

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

  log("pre_compact", {
    sessionId: input.session_id || input.sessionId,
    tokenCount: input.token_count || input.currentTokenCount,
    reason: input.reason || "budget_exceeded",
  });

  // Read last recalled URIs — save which memories were active before compaction
  try {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const trackFile = join(tmpdir(), "openviking-cc-recall-tracking", "last-recalled-uris.json");
    const uris = JSON.parse(readFileSync(trackFile, "utf-8"));
    if (Array.isArray(uris) && uris.length > 0) {
      log("active_memories_before_compact", { count: uris.length, uris });
    }
  } catch { /* no tracking file */ }

  output({});
}

main().catch((err) => { logError("uncaught", err); output({}); });
