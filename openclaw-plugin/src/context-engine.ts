/**
 * OpenViking Enhanced Context Engine — Full OC ContextEngine implementation.
 *
 * assemble() — Hybrid Search + Scoping + Ranking + Compaction + Scope Hints
 * ingest() — Content Merge + Record Used + Auto-Link
 * bootstrap() — Project content check + sync
 * afterTurn/compact/maintain/subagent/dispose — T-003 stubs
 */

import type {
  ContextEngine,
  ContextEngineInfo,
  AssembleResult,
  IngestResult,
  IngestBatchResult,
  BootstrapResult,
  CompactResult,
  ContextEngineMaintenanceResult,
  ContextEngineRuntimeContext,
  SubagentSpawnPreparation,
  SubagentEndReason,
} from "openclaw/plugin-sdk";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

type MemoryCitationsMode = "auto" | "on" | "off";

import { OVClient, type OVSearchResult } from "./ov-client.js";
import { loadConfig } from "./config.js";
import { searchScoped } from "./hybrid-search.js";
import { buildScopeHints, buildMemoryBlock } from "./scope-hints.js";
import { shouldCapture, extractMessageText } from "./text-utils.js";

// Shared modules loaded dynamically (ESM, from OPENVIKING_HOME)
const SHARED = process.env.OPENVIKING_HOME || `${process.env.HOME || "/root"}/.openviking`;

let _resolveScopes: ((cwd: string) => { scopes: string[]; targetUris: string[]; projectSlug: string | null }) | null = null;
let _cavemanCompact: ((text: string) => string) | null = null;
let _sourceAuthorityMultiplier: ((item: OVSearchResult) => number) | null = null;
let _pickMemories: ((items: OVSearchResult[], limit: number, queryText: string, authorityFn?: (item: OVSearchResult) => number) => OVSearchResult[]) | null = null;
let _postProcess: ((items: OVSearchResult[], limit: number, threshold: number) => OVSearchResult[]) | null = null;
let _getRankingBreakdown: ((item: OVSearchResult, profile: unknown, authorityMultiplier?: number) => { finalScore: number }) | null = null;
let _buildQueryProfile: ((query: string) => unknown) | null = null;

async function loadSharedModules(): Promise<void> {
  if (_resolveScopes) return; // already loaded
  try {
    const scopeResolver = await import(`${SHARED}/scope-resolver.mjs`);
    _resolveScopes = scopeResolver.resolveScopes;
    _sourceAuthorityMultiplier = scopeResolver.sourceAuthorityMultiplier;

    const compaction = await import(`${SHARED}/compaction.mjs`);
    _cavemanCompact = compaction.cavemanCompact;

    const ranking = await import(`${SHARED}/ranking.mjs`);
    _pickMemories = ranking.pickMemories;
    _postProcess = ranking.postProcess;
    _getRankingBreakdown = ranking.getRankingBreakdown;
    _buildQueryProfile = ranking.buildQueryProfile;
  } catch {
    // Graceful degradation — search without scoping/ranking
  }
}

export class OpenVikingContextEngine implements ContextEngine {
  readonly info: ContextEngineInfo = {
    id: "openviking-enhanced",
    name: "OpenViking Enhanced Context Engine",
    version: "1.0.0",
    ownsCompaction: false,
    turnMaintenanceMode: "background",
  };

  private client: OVClient;
  private recalledUris: string[] = [];
  private prevRecalledUris: string[] = [];
  private cfg = loadConfig();

  constructor() {
    this.client = new OVClient(this.cfg);
  }

  // =========================================================================
  // bootstrap() — Project content check
  // =========================================================================

  async bootstrap(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
  }): Promise<BootstrapResult> {
    await loadSharedModules();

    const healthy = await this.client.health();
    if (!healthy) return { bootstrapped: false, reason: "ov_unreachable" };

    if (!_resolveScopes) return { bootstrapped: true, reason: "no_scope_resolver" };

    const cwd = process.cwd();
    const { projectSlug } = _resolveScopes(cwd);
    if (!projectSlug) return { bootstrapped: true, reason: "no_project_detected" };

    // Check if project content exists in OV
    const stat = await this.client.fsStat(`viking://resources/projects/${projectSlug}/`);
    if (stat) return { bootstrapped: true, reason: `project_${projectSlug}_exists` };

    // Trigger project sync if ov-project-sync.sh exists
    try {
      const { execFileSync } = await import("node:child_process");
      const syncScript = `${SHARED}/scripts/ov-project-sync.sh`;
      const { existsSync } = await import("node:fs");
      if (existsSync(syncScript)) {
        execFileSync(syncScript, [projectSlug], { timeout: this.cfg.bootstrapTimeoutMs, stdio: "ignore" });
        return { bootstrapped: true, reason: `project_${projectSlug}_synced` };
      }
    } catch {
      // Sync failed — non-fatal
    }

    return { bootstrapped: true, reason: `project_${projectSlug}_sync_skipped` };
  }

  // =========================================================================
  // assemble() — Hybrid Search + Scoping + Ranking + Compaction + Scope Hints
  // =========================================================================

  async assemble(params: {
    sessionId: string;
    sessionKey?: string;
    messages: AgentMessage[];
    tokenBudget?: number;
    availableTools?: Set<string>;
    citationsMode?: MemoryCitationsMode;
    model?: string;
    prompt?: string;
  }): Promise<AssembleResult> {
    await loadSharedModules();

    const query = (params.prompt || "").trim();
    if (!query || query.length < this.cfg.minQueryLength) {
      return { messages: params.messages, estimatedTokens: 0 };
    }

    const healthy = await this.client.health();
    if (!healthy) return { messages: params.messages, estimatedTokens: 0 };

    // Resolve scopes
    const cwd = process.cwd();
    const scopeInfo = _resolveScopes
      ? _resolveScopes(cwd)
      : { scopes: ["system", "knowledge"], targetUris: ["viking://user/memories/", "viking://agent/memories/"], projectSlug: null };

    // Hybrid search
    const candidateLimit = Math.max(this.cfg.recallLimit * 4, 20);
    const allMemories = await searchScoped(this.client, query, scopeInfo.targetUris, candidateLimit);
    if (allMemories.length === 0) {
      return { messages: params.messages, estimatedTokens: 0 };
    }

    // Post-process & rank
    const processed = _postProcess
      ? _postProcess(allMemories, candidateLimit, this.cfg.scoreThreshold)
      : allMemories.slice(0, candidateLimit);

    const authorityFn = _sourceAuthorityMultiplier || (() => 1.0);
    const memories = _pickMemories
      ? _pickMemories(processed, this.cfg.recallLimit, query, authorityFn)
      : processed.slice(0, this.cfg.recallLimit);

    if (memories.length === 0) {
      return { messages: params.messages, estimatedTokens: 0 };
    }

    // Track recalled URIs for Record Used
    this.recalledUris = memories.map(m => m.uri);

    // Stale recall dedup: if >80% overlap with previous recall, short-circuit
    if (this.prevRecalledUris.length > 0) {
      const prevSet = new Set(this.prevRecalledUris);
      const overlap = this.recalledUris.filter(u => prevSet.has(u)).length;
      const ratio = overlap / Math.max(this.recalledUris.length, 1);
      if (ratio > 0.8 && this.recalledUris.length === this.prevRecalledUris.length) {
        this.prevRecalledUris = this.recalledUris;
        return {
          messages: params.messages,
          estimatedTokens: 50,
          systemPromptAddition: "<relevant-memories>\nPrevious memory context still active (same memories recalled). Active scopes unchanged.\n</relevant-memories>",
        };
      }
    }
    this.prevRecalledUris = this.recalledUris;

    // Read full content for leaf memories, apply Caveman compaction
    const compact = _cavemanCompact || ((t: string) => t);
    const lines = await Promise.all(
      memories.map(async (item) => {
        const label = item.category || item.context_type || "memory";
        if (item.level === 2) {
          const content = await this.client.contentRead(item.uri);
          if (content) return `- [${label}] ${compact(content)}`;
        }
        const fallback = (item.abstract || item.overview || item.uri || "").trim();
        return `- [${label}] ${compact(fallback)}`;
      }),
    );

    // Build scope hints
    const scopeHints = buildScopeHints(scopeInfo);
    const memoryBlock = buildMemoryBlock(lines, scopeHints);

    // Rough token estimate (1 token ≈ 4 chars)
    const estimatedTokens = Math.ceil(memoryBlock.length / 4);

    return {
      messages: params.messages, // NEVER mutate
      estimatedTokens,
      systemPromptAddition: memoryBlock || undefined,
    };
  }

  // =========================================================================
  // ingest() — Content Merge + Record Used + Auto-Link
  // =========================================================================

  async ingest(params: {
    sessionId: string;
    sessionKey?: string;
    message: AgentMessage;
    isHeartbeat?: boolean;
  }): Promise<IngestResult> {
    if (params.isHeartbeat) return { ingested: false };

    const role = params.message.role;
    if (role !== "user" && role !== "assistant") return { ingested: false };

    const text = extractMessageText(params.message);
    const decision = shouldCapture(text, this.cfg.captureMaxLength);
    if (!decision.capture) return { ingested: false };

    // Content Merge: check if similar memory exists
    let merged = false;
    try {
      const dupes = await this.client.searchFind(decision.text.slice(0, 500), "viking://user/memories/", 3);
      if (dupes.length > 0 && dupes[0].score >= 0.85) {
        const appendContent = `\n---\n[${new Date().toISOString().slice(0, 10)}] ${decision.text.slice(0, 1000)}`;
        const ok = await this.client.contentWrite(dupes[0].uri, appendContent, "append");
        if (ok) merged = true;
      }
    } catch {
      // Merge check failed — proceed with normal capture
    }

    if (!merged) {
      // Normal capture: session → message → extract → delete
      const sessionId = await this.client.sessionCreate();
      if (sessionId) {
        try {
          await this.client.sessionAddMessage(sessionId, "user", decision.text);
          await this.client.sessionExtract(sessionId);
        } finally {
          await this.client.sessionDelete(sessionId);
        }
      }
    }

    // Record Used: report which recalled memories were in context
    if (this.recalledUris.length > 0) {
      await this.client.sessionReportUsed(params.sessionId, this.recalledUris);
    }

    // Auto-Link: detect project slug and create relation
    await loadSharedModules();
    if (_resolveScopes) {
      const cwd = process.cwd();
      const { projectSlug } = _resolveScopes(cwd);
      if (projectSlug) {
        await this.client.relationsLink(
          "viking://user/memories/",
          `viking://resources/projects/${projectSlug}/`,
          "belongs_to",
          `captured in project ${projectSlug}`,
        );
      }
    }

    return { ingested: true };
  }

  // =========================================================================
  // ingestBatch() — Loop over ingest
  // =========================================================================

  async ingestBatch(params: {
    sessionId: string;
    sessionKey?: string;
    messages: AgentMessage[];
    isHeartbeat?: boolean;
  }): Promise<IngestBatchResult> {
    if (params.isHeartbeat) return { ingestedCount: 0 };
    let count = 0;
    for (const message of params.messages) {
      const result = await this.ingest({
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        message,
        isHeartbeat: false,
      });
      if (result.ingested) count++;
    }
    return { ingestedCount: count };
  }

  // =========================================================================
  // afterTurn() — Post-turn lifecycle: stats + record used reset
  // =========================================================================

  async afterTurn(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    messages: AgentMessage[];
    prePromptMessageCount: number;
    autoCompactionSummary?: string;
    isHeartbeat?: boolean;
    tokenBudget?: number;
    runtimeContext?: ContextEngineRuntimeContext;
  }): Promise<void> {
    if (params.isHeartbeat) return;
    // Clear recalled URIs after they've been reported via ingest()
    this.recalledUris = [];
  }

  // =========================================================================
  // compact() — Delegate to OC Runtime
  // =========================================================================

  async compact(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    tokenBudget?: number;
    force?: boolean;
    currentTokenCount?: number;
    compactionTarget?: "budget" | "threshold";
    customInstructions?: string;
    runtimeContext?: ContextEngineRuntimeContext;
  }): Promise<CompactResult> {
    // Delegate to OC runtime — we don't own compaction (ownsCompaction=false)
    try {
      const { delegateCompactionToRuntime } = await import("openclaw/plugin-sdk/core");
      return await delegateCompactionToRuntime(params);
    } catch {
      // If delegate not available (old OC version), return no-op
      return { ok: true, compacted: false, reason: "delegate_unavailable" };
    }
  }

  // =========================================================================
  // maintain() — Transcript hygiene: strip stale <relevant-memories> blocks
  // =========================================================================

  async maintain(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    runtimeContext?: ContextEngineRuntimeContext;
  }): Promise<ContextEngineMaintenanceResult> {
    const rewrite = params.runtimeContext?.rewriteTranscriptEntries;
    if (!rewrite) return { changed: false, bytesFreed: 0, rewrittenEntries: 0 };

    // Read session file to find transcript entries with stale memory blocks
    try {
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(params.sessionFile, "utf-8");
      const data = JSON.parse(content);

      // Find entries in the transcript that contain <relevant-memories> blocks
      // These are injected by assemble() each turn — old ones are stale
      const entries: Array<{ entryId: string; message: AgentMessage }> = [];
      const MEMORY_BLOCK_RE = /<relevant-memories>[\s\S]*?<\/relevant-memories>/g;

      const transcript = Array.isArray(data) ? data : data.transcript || data.messages || [];
      let totalBytesFreed = 0;

      for (const entry of transcript) {
        if (!entry?.id || !entry?.message) continue;
        const msg = entry.message;
        if (msg.role !== "system" && msg.role !== "assistant") continue;

        const text = typeof msg.content === "string" ? msg.content : "";
        if (!MEMORY_BLOCK_RE.test(text)) continue;

        // Strip the memory block
        const cleaned = text.replace(MEMORY_BLOCK_RE, "").trim();
        if (cleaned === text) continue;

        const bytesSaved = text.length - cleaned.length;
        totalBytesFreed += bytesSaved;

        entries.push({
          entryId: entry.id,
          message: { ...msg, content: cleaned || "[memory context removed by maintain]" },
        });
      }

      if (entries.length === 0) {
        return { changed: false, bytesFreed: 0, rewrittenEntries: 0 };
      }

      const result = await rewrite({ replacements: entries });
      return result;
    } catch {
      return { changed: false, bytesFreed: 0, rewrittenEntries: 0, reason: "maintain_error" };
    }
  }

  // =========================================================================
  // prepareSubagentSpawn() — Create OV scope for child agent
  // =========================================================================

  async prepareSubagentSpawn(params: {
    parentSessionKey: string;
    childSessionKey: string;
    contextMode?: "isolated" | "fork";
    parentSessionId?: string;
    parentSessionFile?: string;
    childSessionId?: string;
    childSessionFile?: string;
    ttlMs?: number;
  }): Promise<SubagentSpawnPreparation | undefined> {
    // Create a session scope marker for the child
    const childUri = `viking://agent/${params.childSessionKey}/`;
    await this.client.contentWrite(
      `${childUri}meta/spawn`,
      JSON.stringify({
        parent: params.parentSessionKey,
        mode: params.contextMode || "isolated",
        spawned: new Date().toISOString(),
        ttlMs: params.ttlMs,
      }),
      "overwrite",
    );

    return {
      rollback: async () => {
        // Cleanup child scope if spawn fails
        await this.client.contentWrite(`${childUri}meta/spawn`, "", "overwrite").catch(() => {});
      },
    };
  }

  // =========================================================================
  // onSubagentEnded() — Cleanup child OV scope
  // =========================================================================

  async onSubagentEnded(params: {
    childSessionKey: string;
    reason: SubagentEndReason;
  }): Promise<void> {
    // Cleanup: remove spawn metadata (memories stay in OV — shared access)
    const childUri = `viking://agent/${params.childSessionKey}/meta/spawn`;
    await this.client.contentWrite(childUri, "", "overwrite").catch(() => {});
  }

  // =========================================================================
  // dispose() — Cleanup resources
  // =========================================================================

  async dispose(): Promise<void> {
    this.recalledUris = [];
  }

  // --- Internal helpers ---

  getClient(): OVClient {
    return this.client;
  }

  getRecalledUris(): string[] {
    return this.recalledUris;
  }
}
