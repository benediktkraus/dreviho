#!/usr/bin/env node

/**
 * Auto-Recall Hook Script for Claude Code
 *
 * Triggered by UserPromptSubmit hook.
 * Reads user_prompt from stdin → searches OpenViking → returns recalled
 * memories via systemMessage so Claude sees them transparently.
 *
 * MODIFIED: Scope-aware recall + Caveman compaction + Source-Authority ranking.
 * Changes: CWD→Scope mapping, scoped target_uri searches, text compaction.
 * Modules: ../shared/scope-resolver.mjs, ../shared/compaction.mjs
 * Shared modules are the Single Source of Truth for scoping + compaction.
 */

import { loadConfig } from "./config.mjs";
import { createLogger } from "./debug-log.mjs";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const SHARED = process.env.OPENVIKING_HOME || `${homedir()}/.openviking`;
const _imp = (f) => import(pathToFileURL(join(SHARED, f)).href);
const { resolveScopes, sourceAuthorityMultiplier } = await _imp("scope-resolver.mjs");
const { cavemanCompact } = await _imp("compaction.mjs");
const { temporalDecayFactor, isEvergreen, recordSeenBatch, flushCache } = await _imp("decay-cache.mjs");

// Load scope-config for MMR + Decay settings
let _scopeConfig = {};
try {
  _scopeConfig = JSON.parse(readFileSync(join(SHARED, "scope-config.json"), "utf-8"));
} catch { /* use defaults */ }
const _mmrLambda = _scopeConfig.mmr?.lambda ?? 0.7;
const _mmrEnabled = _scopeConfig.mmr?.enabled !== false;
const _decayEnabled = _scopeConfig.decay?.enabled !== false;
const _decayHalfLife = _scopeConfig.decay?.halfLifeDays ?? 30;
const _decayEvergreen = _scopeConfig.decay?.evergreen ?? ["viking://resources/"];

const cfg = loadConfig();
const { log, logError } = createLogger("auto-recall");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function output(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function approve(msg) {
  const out = { decision: "approve" };
  if (msg) out.hookSpecificOutput = { hookEventName: "UserPromptSubmit", additionalContext: msg };
  output(out);
}

async function fetchJSON(path, init = {}, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
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
// Ranking (ported from memory-ranking.ts)
// ---------------------------------------------------------------------------

function clampScore(v) {
  if (typeof v !== "number" || Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

const PREFERENCE_QUERY_RE = /prefer|preference|favorite|favourite|like|偏好|喜欢|爱好|更倾向/i;
const TEMPORAL_QUERY_RE = /when|what time|date|day|month|year|yesterday|today|tomorrow|last|next|什么时候|何时|哪天|几月|几年|昨天|今天|明天/i;
const QUERY_TOKEN_RE = /[a-z0-9\u4e00-\u9fa5]{2,}/gi;
const STOPWORDS = new Set([
  "what","when","where","which","who","whom","whose","why","how","did","does",
  "is","are","was","were","the","and","for","with","from","that","this","your","you",
]);

function buildQueryProfile(query) {
  const text = query.trim();
  const allTokens = text.toLowerCase().match(QUERY_TOKEN_RE) || [];
  const tokens = allTokens.filter(t => !STOPWORDS.has(t));
  return {
    tokens,
    wantsPreference: PREFERENCE_QUERY_RE.test(text),
    wantsTemporal: TEMPORAL_QUERY_RE.test(text),
  };
}

function lexicalOverlapBoost(tokens, text) {
  if (tokens.length === 0 || !text) return 0;
  const haystack = ` ${text.toLowerCase()} `;
  let matched = 0;
  for (const token of tokens.slice(0, 8)) {
    if (haystack.includes(token)) matched += 1;
  }
  return Math.min(0.2, (matched / Math.min(tokens.length, 4)) * 0.2);
}

function getRankingBreakdown(item, profile) {
  const base = clampScore(item.score);
  const rawAbstract = item.abstract || item.overview || "";
  const abstract = (typeof rawAbstract === "string" ? rawAbstract : String(rawAbstract)).trim();
  const cat = (item.category || "").toLowerCase();
  const uri = item.uri.toLowerCase();
  const leafBoost = (item.level === 2 || uri.endsWith(".md")) ? 0.12 : 0;
  const eventBoost = profile.wantsTemporal && (cat === "events" || uri.includes("/events/")) ? 0.1 : 0;
  const prefBoost = profile.wantsPreference && (cat === "preferences" || uri.includes("/preferences/")) ? 0.08 : 0;
  const overlapBoost = lexicalOverlapBoost(profile.tokens, `${item.uri} ${abstract}`);
  const authorityMul = sourceAuthorityMultiplier(item);
  const authorityBoost = base * (authorityMul - 1.0);
  // Temporal decay: reduce score for old memories, skip evergreen URIs
  let decayFactor = 1.0;
  if (_decayEnabled && item.uri && !isEvergreen(item.uri, _decayEvergreen)) {
    decayFactor = temporalDecayFactor(item.uri, _decayHalfLife);
  }
  const rawScore = base + leafBoost + eventBoost + prefBoost + overlapBoost + authorityBoost;
  return {
    baseScore: base,
    leafBoost, eventBoost, prefBoost, overlapBoost,
    authorityBoost, authorityMultiplier: authorityMul,
    decayFactor,
    finalScore: rawScore * decayFactor,
  };
}

function rankForInjection(item, profile) {
  return getRankingBreakdown(item, profile).finalScore;
}

function dedupeByAbstract(items) {
  const seen = new Set();
  return items.filter(item => {
    const rawKey = item.abstract || item.overview || "";
    const key = (typeof rawKey === "string" ? rawKey : String(rawKey)).trim().toLowerCase() || item.uri;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// MMR Diversity — reduces near-duplicate results
function tokenize(text) {
  if (!text) return new Set();
  return new Set(text.toLowerCase().match(/[a-z0-9\u4e00-\u9fa5]{2,}/gi) || []);
}
function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}
function mmrFilter(items, lambda = 0.7) {
  if (items.length <= 1) return items;
  const tokenSets = items.map(item =>
    tokenize((item.abstract || item.overview || "") + " " + (item.uri || ""))
  );
  const selected = [0];
  const remaining = new Set(items.map((_, i) => i));
  remaining.delete(0);
  while (selected.length < items.length && remaining.size > 0) {
    let bestIdx = -1;
    let bestMmr = -Infinity;
    for (const idx of remaining) {
      const relevance = clampScore(items[idx].score);
      let maxSim = 0;
      for (const selIdx of selected) {
        const sim = jaccardSimilarity(tokenSets[idx], tokenSets[selIdx]);
        if (sim > maxSim) maxSim = sim;
      }
      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
      if (mmrScore > bestMmr) { bestMmr = mmrScore; bestIdx = idx; }
    }
    if (bestIdx === -1) break;
    selected.push(bestIdx);
    remaining.delete(bestIdx);
  }
  return selected.map(i => items[i]);
}

// Citations
function formatCitation(item) {
  const uri = item.uri || "unknown";
  const type = item.context_type || item.category || "memory";
  const score = typeof item.score === "number" ? item.score.toFixed(2) : "?";
  return `[Source: ${uri} | ${type} | score:${score}]`;
}

function pickMemories(items, limit, queryText) {
  if (items.length === 0 || limit <= 0) return [];
  // Record all candidate URIs in decay cache
  if (_decayEnabled) recordSeenBatch(items.map(i => i.uri).filter(Boolean));
  const profile = buildQueryProfile(queryText);
  const sorted = [...items].sort((a, b) => rankForInjection(b, profile) - rankForInjection(a, profile));
  const deduped = dedupeByAbstract(sorted);
  // MMR diversity (config-driven lambda)
  const lambda = _mmrEnabled ? _mmrLambda : 1.0;
  const diversified = lambda < 1.0 ? mmrFilter(deduped, lambda) : deduped;
  const leaves = diversified.filter(m => m.level === 2 || m.uri.endsWith(".md"));
  if (leaves.length >= limit) { flushCache(); return leaves.slice(0, limit); }
  const picked = [...leaves];
  const used = new Set(picked.map(m => m.uri));
  for (const item of diversified) {
    if (picked.length >= limit) break;
    if (used.has(item.uri)) continue;
    picked.push(item);
  }
  flushCache();
  return picked;
}

function postProcess(items, limit, threshold) {
  const seen = new Set();
  const sorted = [...items].sort((a, b) => clampScore(b.score) - clampScore(a.score));
  const result = [];
  for (const item of sorted) {
    if (item.level !== 2) continue;
    if (clampScore(item.score) < threshold) continue;
    const cat = (item.category || "").toLowerCase() || "unknown";
    const rawAbs = item.abstract || item.overview || "";
    const abs = (typeof rawAbs === "string" ? rawAbs : String(rawAbs)).trim().toLowerCase();
    const key = abs ? `${cat}:${abs}` : `uri:${item.uri}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

// ---------------------------------------------------------------------------
// URI space resolution (mirrors MCP server's normalizeTargetUri logic)
// ---------------------------------------------------------------------------

const USER_RESERVED_DIRS = new Set(["memories"]);
const AGENT_RESERVED_DIRS = new Set(["memories", "skills", "instructions", "workspaces"]);
const _spaceCache = {};

async function resolveScopeSpace(scope) {
  if (_spaceCache[scope]) return _spaceCache[scope];

  let fallbackSpace = "default";
  try {
    const status = await fetchJSON("/api/v1/system/status");
    if (status && typeof status.user === "string" && status.user.trim()) {
      fallbackSpace = status.user.trim();
    }
  } catch { /* use fallback */ }

  const reservedDirs = scope === "user" ? USER_RESERVED_DIRS : AGENT_RESERVED_DIRS;
  try {
    const entries = await fetchJSON(`/api/v1/fs/ls?uri=${encodeURIComponent(`viking://${scope}`)}&output=original`);
    if (Array.isArray(entries)) {
      const spaces = entries
        .filter(e => e?.isDir)
        .map(e => (typeof e.name === "string" ? e.name.trim() : ""))
        .filter(n => n && !n.startsWith(".") && !reservedDirs.has(n));
      if (spaces.length > 0) {
        if (spaces.includes(fallbackSpace)) { _spaceCache[scope] = fallbackSpace; return fallbackSpace; }
        if (scope === "user" && spaces.includes("default")) { _spaceCache[scope] = "default"; return "default"; }
        if (spaces.length === 1) { _spaceCache[scope] = spaces[0]; return spaces[0]; }
      }
    }
  } catch { /* use fallback */ }

  _spaceCache[scope] = fallbackSpace;
  return fallbackSpace;
}

async function resolveTargetUri(targetUri) {
  const trimmed = targetUri.trim().replace(/\/+$/, "");
  const m = trimmed.match(/^viking:\/\/(user|agent)(?:\/(.*))?$/);
  if (!m) return trimmed;
  const scope = m[1];
  const rawRest = (m[2] ?? "").trim();
  if (!rawRest) return trimmed;
  const parts = rawRest.split("/").filter(Boolean);
  if (parts.length === 0) return trimmed;
  const reservedDirs = scope === "user" ? USER_RESERVED_DIRS : AGENT_RESERVED_DIRS;
  if (!reservedDirs.has(parts[0])) return trimmed;
  const space = await resolveScopeSpace(scope);
  return `viking://${scope}/${space}/${parts.join("/")}`;
}

// ---------------------------------------------------------------------------
// Search OpenViking
// ---------------------------------------------------------------------------

async function searchScope(query, targetUri, limit, since = null) {
  const resolvedUri = await resolveTargetUri(targetUri);
  const body = { query, target_uri: resolvedUri, limit, score_threshold: 0.30, include_provenance: true };
  if (since) { body.since = since; body.time_field = "created_at"; }
  const result = await fetchJSON("/api/v1/search/find", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return result?.memories || [];
}

// ---------------------------------------------------------------------------
// Hybrid Search: Semantic + Grep + RRF Merge (gbrain pattern)
// ---------------------------------------------------------------------------

const KEYWORD_STOP = new Set([
  "what","when","where","which","who","whom","whose","why","how","did","does",
  "is","are","was","were","the","and","for","with","from","that","this","your",
  "you","can","will","should","would","could","have","has","had","been","being",
  "nicht","und","oder","der","die","das","ein","eine","ist","sind","war","hat",
  "wie","was","wer","wo","wann","warum","bitte","mach","mal","noch","auch",
  "den","dem","du","ich","wir","sie","er","es","auf","mit","von","zu","für",
  "an","in","bei","ja","hast","denn","aber","dann","doch","nur","schon",
  "dass","wenn","weil","hier","da","so","sehr","mehr","kann","wird","haben",
]);

function extractKeywords(text) {
  const tokens = text.toLowerCase().match(/[a-z0-9äöüß._-]{3,}/gi) || [];
  return [...new Set(tokens.filter(t => !KEYWORD_STOP.has(t)))].slice(0, 8);
}

async function grepSearch(keywords, limit) {
  if (keywords.length === 0) return [];
  const pattern = keywords.slice(0, 4).join("|");
  try {
    // Grep needs a URI scope — search user memories (broadest useful scope)
    const result = await fetchJSON("/api/v1/search/grep", {
      method: "POST",
      body: JSON.stringify({ pattern, uri: "viking://user/", limit }),
    });
    const matches = result?.matches || [];
    // Normalize grep results to look like search/find results
    return matches.map((m, i) => ({
      uri: m.uri || m.path || `grep-${i}`,
      score: 1.0 / (i + 1), // rank-based pseudo-score
      abstract: m.snippet || m.line || "",
      context_type: m.context_type || "grep",
      level: 2,
    }));
  } catch { return []; }
}

function rrfMerge(semanticResults, grepResults, k = 60) {
  const scoreMap = new Map(); // uri → { item, score }

  semanticResults.forEach((item, rank) => {
    const key = item.uri;
    const prev = scoreMap.get(key) || { item, score: 0 };
    prev.score += 1 / (k + rank + 1);
    scoreMap.set(key, prev);
  });

  grepResults.forEach((item, rank) => {
    const key = item.uri || item.path || `grep-${rank}`;
    const prev = scoreMap.get(key) || { item, score: 0 };
    prev.score += 1 / (k + rank + 1);
    if (!prev.item.uri && item.uri) prev.item = item;
    scoreMap.set(key, prev);
  });

  return [...scoreMap.values()]
    .sort((a, b) => b.score - a.score)
    .map(e => ({ ...e.item, rrfScore: e.score }));
}

async function searchScoped(query, limit) {
  const cwd = process.cwd();
  const { scopes, targetUris, projectSlug } = resolveScopes(cwd);
  log("scope_resolved", { cwd, scopes, targetUris, projectSlug });

  // Semantic search across all scoped target URIs
  // Apply time filter for memories (not for resources — evergreen)
  const searchPromises = targetUris.map(uri => {
    const isMemory = uri.includes("/memories/") || uri.includes("/user/");
    const since = isMemory ? "90d" : null;
    return searchScope(query, uri, limit, since).then(results => {
      log("search_complete", { scope: uri, rawCount: results.length, since, topScores: results.slice(0, 3).map(m => m.score) });
      return results;
    });
  });

  // Grep search in parallel (keyword-based)
  const keywords = extractKeywords(query);
  const grepPromise = keywords.length > 0
    ? grepSearch(keywords, limit).then(results => {
        log("grep_complete", { keywords, resultCount: results.length });
        return results;
      })
    : Promise.resolve([]);

  const [resultSets, grepResults] = await Promise.all([
    Promise.all(searchPromises),
    grepPromise,
  ]);
  const semanticAll = resultSets.flat();

  // RRF merge if grep returned results
  let all;
  if (grepResults.length > 0) {
    all = rrfMerge(semanticAll, grepResults);
    log("rrf_merge", { semanticCount: semanticAll.length, grepCount: grepResults.length, mergedCount: all.length });
  } else {
    all = semanticAll;
  }

  // Dedupe by URI
  const uriSet = new Set();
  return all.filter(m => {
    if (!m.uri || uriSet.has(m.uri)) return false;
    uriSet.add(m.uri);
    return true;
  });
}

async function readMemoryContent(uri) {
  try {
    const result = await fetchJSON(`/api/v1/content/read?uri=${encodeURIComponent(uri)}`);
    if (result && typeof result === "string" && result.trim()) return result.trim();
  } catch { /* fallback */ }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!cfg.autoRecall) {
    log("skip", { stage: "init", reason: "autoRecall disabled" });
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

  const userPrompt = (input.prompt || "").trim();
  log("start", {
    query: userPrompt.slice(0, 200),
    queryLength: userPrompt.length,
    config: { recallLimit: cfg.recallLimit, scoreThreshold: cfg.scoreThreshold },
  });

  if (!userPrompt || userPrompt.length < cfg.minQueryLength) {
    log("skip", { stage: "query_check", reason: "query too short or empty" });
    approve();
    return;
  }

  // Quick health check
  const health = await fetchJSON("/health");
  if (!health) {
    logError("health_check", "server unreachable or unhealthy");
    approve();
    return;
  }

  // Search
  const candidateLimit = Math.max(cfg.recallLimit * 4, 20);
  const allMemories = await searchScoped(userPrompt, candidateLimit);
  if (allMemories.length === 0) {
    log("skip", { stage: "search", reason: "no results from either scope" });
    approve();
    return;
  }

  // Post-process & rank
  const processed = postProcess(allMemories, candidateLimit, cfg.scoreThreshold);
  log("post_process", { beforeCount: allMemories.length, afterCount: processed.length });

  const profile = buildQueryProfile(userPrompt);
  const ranked = [...processed]
    .map(item => ({ item, breakdown: getRankingBreakdown(item, profile) }))
    .sort((a, b) => b.breakdown.finalScore - a.breakdown.finalScore);

  if (cfg.logRankingDetails) {
    for (const entry of ranked) {
      log("ranking_detail", {
        uri: entry.item.uri,
        ...entry.breakdown,
      });
    }
  } else {
    log("ranking_summary", {
      candidateCount: processed.length,
      topCandidates: ranked.slice(0, 5).map(entry => ({
        uri: entry.item.uri,
        finalScore: entry.breakdown.finalScore,
      })),
    });
  }

  const memories = pickMemories(processed, cfg.recallLimit, userPrompt);
  if (memories.length === 0) {
    log("skip", { stage: "pick", reason: "no memories survived ranking" });
    approve();
    return;
  }

  log("picked", { pickedCount: memories.length, uris: memories.map(m => m.uri) });

  // Write recalled URIs to temp file for Record Used tracking (auto-capture reads this)
  const currentUris = memories.map(m => m.uri);
  try {
    const { writeFileSync, readFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const trackDir = join(tmpdir(), "openviking-cc-recall-tracking");
    mkdirSync(trackDir, { recursive: true });

    // Stale recall dedup: if >80% of URIs are same as last recall, inject short block
    const urisFile = join(trackDir, "last-recalled-uris.json");
    try {
      const prevUris = JSON.parse(readFileSync(urisFile, "utf-8"));
      if (Array.isArray(prevUris) && prevUris.length > 0) {
        const prevSet = new Set(prevUris);
        const overlap = currentUris.filter(u => prevSet.has(u)).length;
        const overlapRatio = overlap / Math.max(currentUris.length, 1);
        if (overlapRatio > 0.95 && currentUris.length === prevUris.length) {
          log("stale_dedup", { overlapRatio, skipped: true });
          writeFileSync(urisFile, JSON.stringify(currentUris));
          approve("<relevant-memories>\nPrevious memory context still active (same memories recalled). Active scopes unchanged.\n</relevant-memories>");
          return;
        }
        log("stale_dedup", { overlapRatio, skipped: false });
      }
    } catch { /* no previous URIs — first recall */ }

    writeFileSync(urisFile, JSON.stringify(currentUris));
  } catch { /* best effort */ }

  // Read full content for leaf memories, apply Caveman compaction + citations
  const lines = await Promise.all(
    memories.map(async (item) => {
      const label = item.category || item.context_type || "memory";
      const citation = formatCitation(item);
      if (item.level === 2) {
        const content = await readMemoryContent(item.uri);
        if (content) return `- [${label}] ${cavemanCompact(content)}\n  ${citation}`;
      }
      const fallback = (item.abstract || item.overview || item.uri).trim();
      return `- [${label}] ${cavemanCompact(fallback)}\n  ${citation}`;
    })
  );

  // Build scope hints for context — tell the agent what's available
  const cwd = process.cwd();
  const { scopes: activeScopes, projectSlug: activeProject } = resolveScopes(cwd);
  const hints = [];
  if (activeProject) hints.push(`Project scope active: ${activeProject} (CLAUDE.md, SESSION-STATE.md, ARCHITECTURE.md synced)`);
  if (activeScopes.includes("system")) hints.push("System scope: Bootstrap docs, learnings, config snapshots");
  if (activeScopes.includes("infra")) hints.push("Infra scope: Infrastructure config, monitoring, deployment");
  if (activeScopes.includes("knowledge")) hints.push("Knowledge scope: API directories, research outputs, external docs. Use memory_search for targeted lookups.");
  if (activeScopes.includes("personal")) hints.push("Personal scope: Personal projects and private data");
  const scopeHints = hints.length > 0 ? "\nActive scopes: " + hints.join(" | ") : "";

  const memoryContext =
    "<relevant-memories>\n" +
    "The following long-term memories from OpenViking may be relevant to this conversation:\n" +
    lines.join("\n") + scopeHints + "\n" +
    "</relevant-memories>";

  approve(memoryContext);
}

main().catch((err) => { logError("uncaught", err); approve(); });
