#!/usr/bin/env node

/**
 * Auto-Capture Hook Script for Claude Code
 *
 * Triggered by Stop hook.
 * Reads transcript_path from stdin → extracts INCREMENTAL conversation
 * (only new turns since last capture) → keeps user turns by default →
 * sends to OpenViking session/extract pipeline → memories stored automatically.
 *
 * Incremental tracking: uses a state file per session_id to record how many
 * turns have been captured. Only new turns are processed on each invocation.
 *
 * Ported from openclaw-plugin/ auto-capture logic in context-engine.ts + text-utils.ts.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { loadConfig } from "./config.mjs";
import { createLogger } from "./debug-log.mjs";

const cfg = loadConfig();
const { log, logError } = createLogger("auto-capture");

// State directory for incremental tracking
const STATE_DIR = join(tmpdir(), "openviking-cc-capture-state");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function output(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function approve(msg) {
  const out = { decision: "approve" };
  if (msg) out.systemMessage = msg;
  output(out);
}

async function fetchJSON(path, init = {}, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.captureTimeoutMs);
    try {
      const headers = { "Content-Type": "application/json" };
      if (cfg.apiKey) headers["X-API-Key"] = cfg.apiKey;
      if (cfg.agentId) headers["X-OpenViking-Agent"] = cfg.agentId;
      if (cfg.account) headers["X-OpenViking-Account"] = cfg.account;
      if (cfg.user) headers["X-OpenViking-User"] = cfg.user;
      if (cfg.cfAccessClientId) headers["CF-Access-Client-Id"] = cfg.cfAccessClientId;
      if (cfg.cfAccessClientSecret) headers["CF-Access-Client-Secret"] = cfg.cfAccessClientSecret;
      const res = await fetch(`${cfg.baseUrl}${path}`, { ...init, headers, signal: controller.signal });
      if (res.status >= 500 && attempt < retries) {
        clearTimeout(timer);
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      const body = await res.json();
      if (!res.ok || body.status === "error") return null;
      return body.result ?? body;
    } catch (err) {
      clearTimeout(timer);
      if (attempt < retries && (err?.name === "AbortError" || err?.code === "ECONNREFUSED")) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Incremental state tracking
// ---------------------------------------------------------------------------

function stateFilePath(sessionId) {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(STATE_DIR, `${safe}.json`);
}

async function loadState(sessionId) {
  try {
    const data = await readFile(stateFilePath(sessionId), "utf-8");
    return JSON.parse(data);
  } catch {
    return { capturedTurnCount: 0 };
  }
}

async function saveState(sessionId, state) {
  try {
    await mkdir(STATE_DIR, { recursive: true });
    await writeFile(stateFilePath(sessionId), JSON.stringify(state));
  } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Text processing (ported from text-utils.ts)
// ---------------------------------------------------------------------------

const MEMORY_TRIGGERS = [
  /remember|preference|prefer|important|decision|decided|always|never/i,
  /记住|偏好|喜欢|喜爱|崇拜|讨厌|害怕|重要|决定|总是|永远|优先|习惯|爱好|擅长|最爱|不喜欢/i,
  /[\w.-]+@[\w.-]+\.\w+/,
  /\+\d{10,}/,
  /(?:我|my)\s*(?:是|叫|名字|name|住在|live|来自|from|生日|birthday|电话|phone|邮箱|email)/i,
  /(?:我|i)\s*(?:喜欢|崇拜|讨厌|害怕|擅长|不会|爱|恨|想要|需要|希望|觉得|认为|相信)/i,
  /(?:favorite|favourite|love|hate|enjoy|dislike|admire|idol|fan of)/i,
];

const SKIP_PATTERNS = [
  /^\s*(ja|ok|okay|yes|no|nein|nope|yep|sure|klar|mach|go|weiter|next|done|fertig|danke|thanks|hi|hey|hallo|hello|bye|ciao|gut|nice|cool|alright|understood|verstanden)\s*[.!?]*\s*$/i,
  /^\s*(git (status|log|diff|show)|ls |cd |cat |pwd|npm |docker |curl )/i,
  /^\s*\[?(user|assistant)\]?:\s*(ja|ok|mach|weiter|go)\s*$/i,
  /^\[assistant\]:\s*```[\s\S]{0,200}```\s*$/,
  /^(reading|checking|running|looking|searching|fetching|analyzing)\b/i,
  /^\[assistant\]:\s*(I'll|Let me|Checking|Reading|Looking|Running|Here's the)\b/i,
];

const SUBSTANCE_SIGNALS = [
  /\b(weil|because|reason|grund|entscheidung|decision|problem|issue|bug|fix|feature|deploy|config|install|setup|migration|refactor)\b/i,
  /\b(soll|should|must|muss|will|want|brauche|need|plan|strateg|approach|l\u00f6sung|solution)\b/i,
  /\b(fehler|error|crash|broken|kaputt|fail|timeout|refused|denied|missing|wrong)\b/i,
  /\b(user|admin|kunde|client|api|endpoint|database|server|container|service)\b/i,
  /\b(ich (will|mach|hab|bin)|i (want|need|have|am|did|found|noticed))\b/i,
  /\b(nicht so|genau so|exactly|lieber|stattdessen|instead|richtig so|falsch|wrong approach)\b/i,
  /\b(statt|instead of|rather than|architektur|architecture|chosen|selected|pattern|convention)\b/i,
  /\b(requires|needs|limitation|constraint|braucht|workaround|incompatible)\b/i,
  /\b(phase|release|sprint|milestone|status|roadmap|priorit.t|priority|deadline)\b/i,
  /\b(gelernt|learned|learning|erkenntnis|insight|discovery|herausgefunden|figured out)\b/i,
];

const RELEVANT_MEMORIES_BLOCK_RE = /<relevant-memories>[\s\S]*?<\/relevant-memories>/gi;
const COMMAND_TEXT_RE = /^\/[a-z0-9_-]{1,64}\b/i;
const NON_CONTENT_TEXT_RE = /^[\p{P}\p{S}\s]+$/u;
const CJK_CHAR_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

function sanitize(text) {
  return text
    .replace(RELEVANT_MEMORIES_BLOCK_RE, " ")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldCapture(text) {
  const normalized = sanitize(text);
  if (!normalized) return { capture: false, reason: "empty", text: "" };

  const compact = normalized.replace(/\s+/g, "");
  const minLen = CJK_CHAR_RE.test(compact) ? 4 : 10;
  if (compact.length < minLen || normalized.length > cfg.captureMaxLength) {
    return { capture: false, reason: "length_out_of_range", text: normalized };
  }

  if (COMMAND_TEXT_RE.test(normalized)) {
    return { capture: false, reason: "command", text: normalized };
  }

  if (NON_CONTENT_TEXT_RE.test(normalized)) {
    return { capture: false, reason: "non_content", text: normalized };
  }

  for (const skip of SKIP_PATTERNS) {
    if (skip.test(normalized)) {
      return { capture: false, reason: "skip_pattern", text: normalized };
    }
  }

  if (cfg.captureMode === "keyword") {
    for (const trigger of MEMORY_TRIGGERS) {
      if (trigger.test(normalized)) {
        return { capture: true, reason: `trigger:${trigger}`, text: normalized };
      }
    }
    return { capture: false, reason: "no_trigger", text: normalized };
  }

  const words = normalized.split(/\s+/).length;
  const DECISION_SHORT_RE = /\b(entscheidung|decision|prefer|bevorzug|statt|instead|nie wieder|never again|immer|always|lieber)\b/i;
  const minWords = DECISION_SHORT_RE.test(normalized) ? 5 : 8;
  if (words < minWords) return { capture: false, reason: "too_short_semantic", text: normalized };

  const CODE_BLOCK_RE = /```[\s\S]*?```/g;
  const textWithoutCode = normalized.replace(CODE_BLOCK_RE, " ");
  const codeRatio = 1 - (textWithoutCode.length / Math.max(normalized.length, 1));
  if (codeRatio > 0.8) return { capture: false, reason: "mostly_code", text: normalized };

  const hasSubstance = SUBSTANCE_SIGNALS.some(sig => sig.test(textWithoutCode));
  if (!hasSubstance && words < 25) {
    return { capture: false, reason: "low_substance", text: normalized };
  }

  return { capture: true, reason: "semantic", text: normalized };
}

// ---------------------------------------------------------------------------
// Transcript parsing
// ---------------------------------------------------------------------------

function parseTranscript(content) {
  try {
    const data = JSON.parse(content);
    if (Array.isArray(data)) return data;
  } catch { /* not a JSON array */ }

  const lines = content.split("\n").filter(l => l.trim());
  const messages = [];
  for (const line of lines) {
    try { messages.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return messages;
}

function extractAllTurns(messages) {
  const turns = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;

    let role = msg.role;
    let text = "";

    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      const textParts = msg.content
        .filter(b => b && b.type === "text" && typeof b.text === "string")
        .map(b => b.text);
      text = textParts.join("\n");
    } else if (typeof msg.message === "object" && msg.message) {
      const inner = msg.message;
      role = inner.role || role;
      if (typeof inner.content === "string") {
        text = inner.content;
      } else if (Array.isArray(inner.content)) {
        const textParts = inner.content
          .filter(b => b && b.type === "text" && typeof b.text === "string")
          .map(b => b.text);
        text = textParts.join("\n");
      }
    }

    if (role !== "user" && role !== "assistant") continue;
    if (text.trim()) {
      turns.push({ role, text: text.trim() });
    }
  }
  return turns;
}

function rawCaptureUri(sessionId) {
  const date = new Date().toISOString().slice(0, 10);
  const safeSessionId = String(sessionId || Date.now()).replace(/[^a-zA-Z0-9_-]/g, "_");
  const projectMatch = process.cwd().match(/\/projects\/([^/]+)/);
  if (projectMatch) {
    return `viking://resources/projects/${projectMatch[1]}/raw-captures/${date}/${safeSessionId}.md`;
  }
  return `viking://resources/system/raw-captures/${date}/${safeSessionId}.md`;
}

function rawCaptureContent(text) {
  return [
    "# Auto Capture Fallback",
    "",
    `Captured at: ${new Date().toISOString()}`,
    "",
    text,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// OpenViking session capture
// ---------------------------------------------------------------------------

async function captureToOpenViking(text) {
  const sessionResult = await fetchJSON("/api/v1/sessions", {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!sessionResult?.session_id) return { ok: false, reason: "session_create_failed" };

  const sessionId = sessionResult.session_id;
  try {
    await fetchJSON(`/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ role: "user", content: text }),
    });

    const extracted = await fetchJSON(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/extract`,
      { method: "POST", body: JSON.stringify({}) },
      0
    );

    const count = Array.isArray(extracted) ? extracted.length : 0;
    if (count > 0) return { ok: true, count, fallbackWritten: false };

    const fallbackWritten = await writeMemoryFile(
      rawCaptureUri(sessionId),
      rawCaptureContent(text),
    );
    return { ok: true, count, fallbackWritten };
  } finally {
    await fetchJSON(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    }).catch(() => {});
  }
}

async function writeMemoryFile(uri, content) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const replaceResult = await fetchJSON("/api/v1/content/write", {
      method: "POST",
      body: JSON.stringify({ uri, content, mode: "replace" }),
    }, 0);
    if (replaceResult) return true;

    const createResult = await fetchJSON("/api/v1/content/write", {
      method: "POST",
      body: JSON.stringify({ uri, content, mode: "create" }),
    }, 0);
    if (createResult) return true;

    await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!cfg.autoCapture) {
    log("skip", { stage: "init", reason: "autoCapture disabled" });
    approve();
    return;
  }

  let input;
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    input = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    log("skip", { stage: "stdin_parse", reason: "invalid input" });
    approve();
    return;
  }

  const transcriptPath = input.transcript_path;
  const sessionId = input.session_id || "unknown";
  log("start", { sessionId, transcriptPath });

  // Quick health check
  const health = await fetchJSON("/health");
  if (!health) {
    logError("health_check", "server unreachable or unhealthy");
    approve();
    return;
  }

  if (!transcriptPath) {
    log("skip", { stage: "input_check", reason: "no transcript_path" });
    approve();
    return;
  }

  let transcriptContent;
  try {
    transcriptContent = await readFile(transcriptPath, "utf-8");
  } catch (err) {
    logError("transcript_read", err);
    approve();
    return;
  }

  if (!transcriptContent.trim()) {
    log("skip", { stage: "transcript_read", reason: "empty transcript" });
    approve();
    return;
  }

  // Parse transcript and extract all turns
  const messages = parseTranscript(transcriptContent);
  const allTurns = extractAllTurns(messages);
  if (allTurns.length === 0) {
    log("skip", { stage: "transcript_parse", reason: "no user/assistant turns found" });
    approve();
    return;
  }

  // Load incremental state — skip already-captured turns
  const state = await loadState(sessionId);
  const newTurns = allTurns.slice(state.capturedTurnCount);
  const captureTurns = cfg.captureAssistantTurns
    ? newTurns
    : newTurns.filter(turn => turn.role === "user");
  log("transcript_parse", {
    totalTurns: allTurns.length,
    previouslyCaptured: state.capturedTurnCount,
    newTurns: newTurns.length,
    captureTurns: captureTurns.length,
    assistantTurnsSkipped: newTurns.length - captureTurns.length,
  });

  if (newTurns.length === 0) {
    log("skip", { stage: "incremental_check", reason: "no new turns" });
    approve();
    return;
  }

  if (captureTurns.length === 0) {
    await saveState(sessionId, { capturedTurnCount: allTurns.length });
    log("state_update", { newCapturedTurnCount: allTurns.length, reason: "assistant_only_increment" });
    approve();
    return;
  }

  // Pre-process: strip code blocks, tool outputs, and system noise before capture
  const CODE_BLOCK_STRIP = /```[\s\S]*?```/g;
  const TOOL_OUTPUT_STRIP = /<tool_result>[\s\S]*?<\/tool_result>/gi;
  const SYSTEM_TAG_STRIP = /<system-reminder>[\s\S]*?<\/system-reminder>/gi;
  const capturableText = captureTurns.map(t => {
    let text = t.text;
    if (t.role === "assistant") {
      text = text.replace(CODE_BLOCK_STRIP, "[code]");
      text = text.replace(TOOL_OUTPUT_STRIP, "");
      text = text.replace(SYSTEM_TAG_STRIP, "");
    }
    return `[${t.role}]: ${text}`;
  }).join("\n");

  // Check capture decision
  const decision = shouldCapture(capturableText);
  log("should_capture", {
    capture: decision.capture,
    reason: decision.reason,
    textPreview: decision.text.slice(0, 100),
  });

  if (!decision.capture) {
    await saveState(sessionId, { capturedTurnCount: allTurns.length });
    approve();
    return;
  }

  // Content Merge: check if similar memory already exists
  let merged = false;
  try {
    const dupeCheck = await fetchJSON("/api/v1/search/find", {
      method: "POST",
      body: JSON.stringify({ query: decision.text.slice(0, 500), limit: 3, score_threshold: 0.85 }),
    });
    const dupes = dupeCheck?.memories || [];
    if (dupes.length > 0 && dupes[0].score >= 0.85) {
      const existingUri = dupes[0].uri;
      const appendResult = await fetchJSON("/api/v1/content/write", {
        method: "POST",
        body: JSON.stringify({
          uri: existingUri,
          content: `\n---\n[${new Date().toISOString().slice(0,10)}] ${decision.text.slice(0, 1000)}`,
          mode: "append",
        }),
      });
      if (appendResult) {
        merged = true;
        log("content_merge", { mergedInto: existingUri, score: dupes[0].score });
      }
    }
  } catch { /* merge check failed, proceed with normal capture */ }

  // Add project scope prefix if in a project directory
  let scopedText = decision.text;
  const cwdForScope = process.cwd();
  const projectScopeMatch = cwdForScope.match(/\/projects\/([^/]+)/);
  if (projectScopeMatch) {
    scopedText = `[project:${projectScopeMatch[1]}] ${decision.text}`;
  }

  // Send to OpenViking (skip if merged into existing memory)
  const result = merged
    ? { ok: true, count: 0, merged: true }
    : await captureToOpenViking(scopedText);
  log("openviking_capture", {
    sessionCreated: result.ok,
    extractedCount: result.count || 0,
    fallbackWritten: Boolean(result.fallbackWritten),
    merged,
  });

  // Record Used: report which recalled memories were in context this session
  try {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const trackFile = join(tmpdir(), "openviking-cc-recall-tracking", "last-recalled-uris.json");
    const uris = JSON.parse(readFileSync(trackFile, "utf-8"));
    if (Array.isArray(uris) && uris.length > 0) {
      await fetchJSON(`/api/v1/sessions/${encodeURIComponent(sessionId)}/used`, {
        method: "POST",
        body: JSON.stringify({ uris }),
      });
      log("record_used", { count: uris.length });
    }
  } catch { /* best effort — no tracking file means no recall happened */ }

  // Auto-Link: project + tool + error relations
  try {
    const cwd = process.cwd();
    const projectMatch = cwd.match(/\/projects\/([^/]+)/);
    if (projectMatch) {
      const slug = projectMatch[1];
      const projectUri = `viking://resources/projects/${slug}/`;
      await fetchJSON("/api/v1/relations/link", {
        method: "POST",
        body: JSON.stringify({ source: `viking://user/memories/`, target: projectUri, type: "belongs_to", label: `captured in project ${slug}` }),
      });
      log("auto_link", { project: slug, type: "belongs_to" });
    }
    // Detect tool mentions (docker, n8n, openclaw, etc.) and link to tool entities
    const toolPatterns = [
      { re: /\b(docker|container|compose)\b/i, tool: "docker" },
      { re: /\b(n8n|workflow|webhook)\b/i, tool: "n8n" },
      { re: /\b(openclaw|gateway)\b/i, tool: "openclaw" },
      { re: /\b(cloudflare|wrangler|tunnel|cf)\b/i, tool: "cloudflare" },
      { re: /\b(openviking|ov|memory)\b/i, tool: "openviking" },
      { re: /\b(langfuse|traces?|observability)\b/i, tool: "langfuse" },
    ];
    const mentionedTools = toolPatterns.filter(p => p.re.test(decision.text)).map(p => p.tool);
    for (const tool of mentionedTools.slice(0, 3)) {
      await fetchJSON("/api/v1/relations/link", {
        method: "POST",
        body: JSON.stringify({ source: `viking://user/memories/`, target: `viking://resources/tools/${tool}/`, type: "mentions_tool", label: tool }),
      });
    }
    if (mentionedTools.length > 0) log("auto_link_tools", { tools: mentionedTools });
    // Detect error/incident patterns and tag
    if (/\b(error|crash|broken|kaputt|fail|bug|fix)\b/i.test(decision.text)) {
      await fetchJSON("/api/v1/relations/link", {
        method: "POST",
        body: JSON.stringify({ source: `viking://user/memories/`, target: `viking://resources/incidents/`, type: "incident_report", label: new Date().toISOString().slice(0, 10) }),
      });
      log("auto_link_incident", { date: new Date().toISOString().slice(0, 10) });
    }
  } catch { /* best effort */ }

  // Update state
  await saveState(sessionId, { capturedTurnCount: allTurns.length });
  log("state_update", { newCapturedTurnCount: allTurns.length });

  // Sync local memory files to OpenViking (CC, Codex, Gemini all write local .md files)
  let syncCount = 0;
  try {
    syncCount = await syncLocalMemories(sessionId);
  } catch (err) {
    logError("memory_sync", err);
  }

  if (result.ok && (result.count > 0 || result.fallbackWritten || syncCount > 0)) {
    log("done", { captureTurns: captureTurns.length, extractedCount: result.count, syncedFiles: syncCount });
    approve(`captured ${captureTurns.length} turns, extracted ${result.count} memories, fallback ${result.fallbackWritten ? 1 : 0}, synced ${syncCount} local files`);
  } else {
    approve();
  }
}

// ---------------------------------------------------------------------------
// Local Memory File Sync → OpenViking
// ---------------------------------------------------------------------------

const MEMORY_SYNC_STATE_DIR = join(tmpdir(), "openviking-cc-memory-sync");

function resolveMemoryDir() {
  const agentId = (process.env.OPENVIKING_AGENT_ID || "").trim();
  const cwd = process.cwd();
  if (agentId === "codex") {
    return join(homedir(), ".codex", "memory");
  }
  if (agentId === "gemini-cli") {
    return join(homedir(), ".gemini", "memory");
  }
  const sanitizedCwd = cwd.replace(/\//g, "-").replace(/^-/, "");
  return join(homedir(), ".claude", "projects", sanitizedCwd, "memory");
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: match[2] };
}

function memoryUri(filename, type, projectSlug) {
  const name = filename.replace(/\.md$/, "");
  if (type === "project" && projectSlug) {
    return `viking://user/benedikt/memories/projects/${projectSlug}/${name}.md`;
  }
  if (type === "feedback" || type === "user" || type === "reference") {
    return `viking://user/benedikt/memories/${type}/${name}.md`;
  }
  if (projectSlug) {
    return `viking://user/benedikt/memories/projects/${projectSlug}/${name}.md`;
  }
  return `viking://user/benedikt/memories/global/${name}.md`;
}

async function syncLocalMemories(sessionId) {
  const memDir = resolveMemoryDir();
  let files;
  try {
    const { readdirSync, statSync } = await import("node:fs");
    files = readdirSync(memDir).filter(f => f.endsWith(".md") && f !== "MEMORY.md");
  } catch {
    return 0;
  }
  if (files.length === 0) return 0;

  const { readFileSync, writeFileSync, mkdirSync, statSync } = await import("node:fs");
  mkdirSync(MEMORY_SYNC_STATE_DIR, { recursive: true });
  const stateFile = join(MEMORY_SYNC_STATE_DIR, `${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  let syncState = {};
  try { syncState = JSON.parse(readFileSync(stateFile, "utf-8")); } catch { /* first sync */ }

  const cwd = process.cwd();
  const projectSlug = cwd.match(/\/projects\/([^/]+)/)?.[1] || null;
  let synced = 0;

  for (const file of files) {
    const filePath = join(memDir, file);
    let mtime;
    try { mtime = statSync(filePath).mtimeMs; } catch { continue; }
    if (syncState[file] && syncState[file] >= mtime) continue;

    try {
      const content = readFileSync(filePath, "utf-8");
      const { meta } = parseFrontmatter(content);
      const uri = memoryUri(file, meta.type || "", projectSlug);
      if (await writeMemoryFile(uri, content)) {
        syncState[file] = mtime;
        synced++;
        log("memory_sync_file", { file, uri, type: meta.type || "unknown" });
      }
    } catch { /* best effort per file */ }
  }

  if (synced > 0) {
    try { writeFileSync(stateFile, JSON.stringify(syncState)); } catch { /* best effort */ }
    log("memory_sync_done", { synced, total: files.length, projectSlug });
  }
  return synced;
}

main().catch((err) => { logError("uncaught", err); approve(); });
