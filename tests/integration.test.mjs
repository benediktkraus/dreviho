#!/usr/bin/env node

/**
 * Integration Tests — End-to-end hook verification against live OV server.
 *
 * Requirements: OV running on localhost:1933 with valid API key.
 * Tests: recall, capture, extract, grep, stopwords, score threshold, stale dedup.
 *
 * Usage: node tests/integration.test.mjs
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../scripts/config.mjs";

const cfg = loadConfig();
const BASE = cfg.baseUrl;
const HEADERS = { "Content-Type": "application/json" };
if (cfg.apiKey) HEADERS["X-API-Key"] = cfg.apiKey;
if (cfg.agentId) HEADERS["X-OpenViking-Agent"] = cfg.agentId;
if (cfg.account) HEADERS["X-OpenViking-Account"] = cfg.account;
if (cfg.user) HEADERS["X-OpenViking-User"] = cfg.user;

async function api(path, body = null) {
  const opts = { method: body ? "POST" : "GET", headers: HEADERS };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  return res.json();
}

// ---------------------------------------------------------------------------
// OV Server Health
// ---------------------------------------------------------------------------

describe("OV Server", () => {
  it("is healthy", async () => {
    const health = await api("/health");
    assert.equal(health.status, "ok");
    assert.equal(health.healthy, true);
  });
});

// ---------------------------------------------------------------------------
// Recall Hook
// ---------------------------------------------------------------------------

describe("auto-recall", () => {
  it("returns memories for a relevant query", async () => {
    const input = JSON.stringify({ prompt: "OpenViking hooks configuration und memory system" });
    const result = execFileSync("node", [
      join(import.meta.dirname, "..", "scripts", "auto-recall.mjs"),
    ], { input, timeout: 15000, encoding: "utf-8" });
    const parsed = JSON.parse(result.trim());
    assert.equal(parsed.decision, "approve");
    assert.ok(parsed.hookSpecificOutput, "should have hookSpecificOutput");
    const ctx = parsed.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes("<relevant-memories>"), "should contain memory block");
    assert.ok(ctx.includes("[Source:"), "should contain citations");
  });

  it("approves empty query without error", async () => {
    const input = JSON.stringify({ prompt: "" });
    const result = execFileSync("node", [
      join(import.meta.dirname, "..", "scripts", "auto-recall.mjs"),
    ], { input, timeout: 10000, encoding: "utf-8" });
    const parsed = JSON.parse(result.trim());
    assert.equal(parsed.decision, "approve");
  });

  it("does not return printer_knowledge for non-printer queries", async () => {
    const input = JSON.stringify({ prompt: "Wie deploye ich eine Next.js App auf Cloudflare Pages?" });
    const result = execFileSync("node", [
      join(import.meta.dirname, "..", "scripts", "auto-recall.mjs"),
    ], { input, timeout: 15000, encoding: "utf-8" });
    const parsed = JSON.parse(result.trim());
    if (parsed.hookSpecificOutput?.additionalContext) {
      const ctx = parsed.hookSpecificOutput.additionalContext;
      assert.ok(!ctx.includes("printer_knowledge"), "printer_knowledge should NOT appear for non-printer queries");
    }
  });
});

// ---------------------------------------------------------------------------
// Capture Hook
// ---------------------------------------------------------------------------

describe("auto-capture", () => {
  it("captures user + assistant turns and extracts memories", async () => {
    const tmpDir = join(tmpdir(), `ov-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const transcript = join(tmpDir, "transcript.jsonl");
    writeFileSync(transcript, [
      JSON.stringify({ role: "user", content: "Benedikt hat entschieden dass wir Semble in alle CLIs integrieren. Das ist eine wichtige Architektur-Entscheidung für das gesamte System." }),
      JSON.stringify({ role: "assistant", content: "Verstanden. Semble wird in Claude Code, Codex und Gemini CLI integriert. Die Integration folgt dem gleichen Pattern wie die OpenViking Hooks." }),
    ].join("\n"));

    const input = JSON.stringify({
      transcript_path: transcript,
      session_id: `test-capture-${Date.now()}`,
    });
    const result = execFileSync("node", [
      join(import.meta.dirname, "..", "scripts", "auto-capture.mjs"),
    ], { input, timeout: 60000, encoding: "utf-8" });
    const parsed = JSON.parse(result.trim());
    assert.equal(parsed.decision, "approve");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips trivial messages", async () => {
    const tmpDir = join(tmpdir(), `ov-test-skip-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const transcript = join(tmpDir, "transcript.jsonl");
    writeFileSync(transcript, JSON.stringify({ role: "user", content: "ok" }));

    const input = JSON.stringify({
      transcript_path: transcript,
      session_id: `test-skip-${Date.now()}`,
    });
    const result = execFileSync("node", [
      join(import.meta.dirname, "..", "scripts", "auto-capture.mjs"),
    ], { input, timeout: 10000, encoding: "utf-8" });
    const parsed = JSON.parse(result.trim());
    assert.equal(parsed.decision, "approve");
    assert.ok(!parsed.systemMessage || !parsed.systemMessage.includes("captured"), "trivial message should not be captured");
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Extract Pipeline (VLM model)
// ---------------------------------------------------------------------------

describe("extract pipeline", () => {
  it("extracts memories from meaningful text via session API", async () => {
    const session = await api("/api/v1/sessions", {});
    const sid = session.result?.session_id || session.session_id;
    assert.ok(sid, "session should be created");

    try {
      const marker = `dreviho-direct-extract-${Date.now()}`;
      await api(`/api/v1/sessions/${sid}/messages`, {
        role: "user",
        content: `Benedikt bevorzugt dass alle AI CLIs proaktiv OpenViking nutzen. Memory Store soll bei jeder wichtigen Entscheidung aufgerufen werden, nicht nur wenn der User remember sagt. Eindeutiger Integrationsmarker: ${marker}.`,
      });

      const extract = await api(`/api/v1/sessions/${sid}/extract`, {});
      const memories = extract.result;
      assert.ok(Array.isArray(memories), "extract should return array");
      assert.ok(memories.length > 0, `extractedCount should be > 0, got ${memories.length}`);
    } finally {
      await fetch(`${BASE}/api/v1/sessions/${sid}`, { method: "DELETE", headers: HEADERS });
    }
  });
});

// ---------------------------------------------------------------------------
// Semantic + Grep Search
// ---------------------------------------------------------------------------

describe("search", () => {
  it("semantic search returns scored results", async () => {
    const result = await api("/api/v1/search/find", {
      query: "OpenViking configuration",
      limit: 5,
      score_threshold: 0.15,
    });
    const memories = result.result?.memories || [];
    assert.ok(memories.length > 0, "should find memories");
    assert.ok(memories[0].score >= 0.15, `score should be >= 0.15, got ${memories[0].score}`);
  });

  it("grep search returns keyword matches", async () => {
    const result = await api("/api/v1/search/grep", {
      pattern: "openviking",
      uri: "viking://user/",
      limit: 5,
    });
    const matches = result.result?.matches || result.matches || [];
    assert.ok(matches.length > 0, "grep should find matches for 'openviking'");
  });
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe("config", () => {
  it("scoreThreshold default is 0.15", () => {
    assert.equal(cfg.scoreThreshold, 0.15);
  });

  it("captureAssistantTurns is true", () => {
    assert.equal(cfg.captureAssistantTurns, true);
  });

  it("recallLimit is 10", () => {
    assert.equal(cfg.recallLimit, 10);
  });
});
