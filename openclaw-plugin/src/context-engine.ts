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
import { logEvent, summarizeUris, type OVLogger } from "./logging.js";

// Shared modules loaded dynamically (ESM, from OPENVIKING_HOME)
import { homedir } from "node:os";
const SHARED = process.env.OPENVIKING_HOME || `${homedir()}/.openviking`;

let _resolveScopes: ((cwd: string) => { scopes: string[]; targetUris: string[]; projectSlug: string | null }) | null = null;
let _cavemanCompact: ((text: string) => string) | null = null;
let _sourceAuthorityMultiplier: ((item: OVSearchResult) => number) | null = null;
let _pickMemories: ((items: OVSearchResult[], limit: number, queryText: string, authorityFn?: (item: OVSearchResult) => number) => OVSearchResult[]) | null = null;
let _postProcess: ((items: OVSearchResult[], limit: number, threshold: number) => OVSearchResult[]) | null = null;
let _getRankingBreakdown: ((item: OVSearchResult, profile: unknown, authorityMultiplier?: number) => { finalScore: number }) | null = null;
let _buildQueryProfile: ((query: string) => unknown) | null = null;
let _formatCitation: ((item: OVSearchResult) => string) | null = null;

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
    _formatCitation = ranking.formatCitation;
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
  private logger?: OVLogger;
  private recalledUris: string[] = [];
  private prevRecalledUris: string[] = [];
  private cfg = loadConfig();

  constructor(logger?: OVLogger) {
    this.logger = logger;
    this.client = new OVClient(this.cfg, logger);
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
    this.log("recall_start", {
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      queryChars: query.length,
      messageCount: params.messages.length,
      tokenBudget: params.tokenBudget,
    });
    if (!query || query.length < this.cfg.minQueryLength) {
      this.log("recall_skip", {
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        reason: "query_too_short",
        queryChars: query.length,
      });
      return { messages: params.messages, estimatedTokens: 0 };
    }

    const healthy = await this.client.health();
    if (!healthy) {
      this.log("recall_skip", {
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        reason: "ov_unreachable",
      }, "warn");
      return { messages: params.messages, estimatedTokens: 0 };
    }

    // Resolve scopes
    const cwd = process.cwd();
    const scopeInfo = _resolveScopes
      ? _resolveScopes(cwd)
      : { scopes: ["system", "knowledge"], targetUris: ["viking://user/memories/", "viking://agent/memories/"], projectSlug: null };
    this.log("recall_scopes", {
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      scopes: scopeInfo.scopes,
      targetUriCount: scopeInfo.targetUris.length,
      targetUriSamples: scopeInfo.targetUris.slice(0, 10),
      projectSlug: scopeInfo.projectSlug,
    });

    // Hybrid search
    const candidateLimit = Math.max(this.cfg.recallLimit * 4, 20);
    const allMemories = await searchScoped(this.client, query, scopeInfo.targetUris, candidateLimit);
    this.log("recall_candidates", {
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      candidateLimit,
      candidateCount: allMemories.length,
      ...summarizeUris(allMemories.map((memory) => memory.uri), 8),
    });
    if (allMemories.length === 0) {
      this.log("recall_empty", {
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        reason: "no_candidates",
      });
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
      this.log("recall_empty", {
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        reason: "no_selected_memories",
        processedCount: processed.length,
        scoreThreshold: this.cfg.scoreThreshold,
      });
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
        const addition = "<relevant-memories>\nPrevious memory context still active (same memories recalled). Active scopes unchanged.\n</relevant-memories>";
        this.log("recall_injected", {
          sessionId: params.sessionId,
          sessionKey: params.sessionKey,
          selectedCount: memories.length,
          staleDedup: true,
          estimatedTokens: 50,
          systemPromptAdditionChars: addition.length,
          ...summarizeUris(this.recalledUris),
        });
        return {
          messages: params.messages,
          estimatedTokens: 50,
          systemPromptAddition: addition,
        };
      }
    }
    this.prevRecalledUris = this.recalledUris;

    // Read full content for leaf memories, apply Caveman compaction + citations
    const compact = _cavemanCompact || ((t: string) => t);
    const citationsOn = params.citationsMode !== "off";
    const cite = _formatCitation || ((item: OVSearchResult) => `[Source: ${item.uri}]`);
    const lines = await Promise.all(
      memories.map(async (item) => {
        const label = item.category || item.context_type || "memory";
        const suffix = citationsOn ? `\n  ${cite(item)}` : "";
        if (item.level === 2) {
          const content = await this.client.contentRead(item.uri);
          this.log("memory_content_read", {
            sessionId: params.sessionId,
            sessionKey: params.sessionKey,
            uri: item.uri,
            ok: Boolean(content),
          }, content ? "info" : "warn");
          if (content) return `- [${label}] ${compact(content)}${suffix}`;
        }
        const fallback = (item.abstract || item.overview || item.uri || "").trim();
        return `- [${label}] ${compact(fallback)}${suffix}`;
      }),
    );

    // Build scope hints
    const scopeHints = buildScopeHints(scopeInfo);
    const memoryBlock = buildMemoryBlock(lines, scopeHints);

    // Rough token estimate (1 token ≈ 4 chars)
    const estimatedTokens = Math.ceil(memoryBlock.length / 4);
    this.log("recall_injected", {
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      selectedCount: memories.length,
      estimatedTokens,
      systemPromptAdditionChars: memoryBlock.length,
      citationsOn,
      ...summarizeUris(this.recalledUris),
    });

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
    if (params.isHeartbeat) {
      this.log("capture_skip", {
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        reason: "heartbeat",
      });
      return { ingested: false };
    }

    const role = params.message.role;
    if (role !== "user" && role !== "assistant") {
      this.log("capture_skip", {
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        reason: "unsupported_role",
        role,
      });
      return { ingested: false };
    }

    const text = extractMessageText(params.message);
    const decision = shouldCapture(text, this.cfg.captureMaxLength);
    this.log("capture_start", {
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      role,
      textChars: text.length,
      capture: decision.capture,
    });
    if (!decision.capture) {
      this.log("capture_skip", {
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        reason: "capture_filter",
        role,
        textChars: text.length,
      });
      return { ingested: false };
    }

    // Content Merge: check if similar memory exists
    let merged = false;
    try {
      const dupes = await this.client.searchFind(decision.text.slice(0, 500), "viking://user/memories/", 3);
      this.log("capture_merge_check", {
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        dupeCount: dupes.length,
        topScore: dupes[0]?.score,
        topUri: dupes[0]?.uri,
      });
      if (dupes.length > 0 && dupes[0].score >= 0.85) {
        const appendContent = `\n---\n[${new Date().toISOString().slice(0, 10)}] ${decision.text.slice(0, 1000)}`;
        const ok = await this.client.contentWrite(dupes[0].uri, appendContent, "append");
        this.log("capture_write", {
          sessionId: params.sessionId,
          sessionKey: params.sessionKey,
          mode: "append_existing_memory",
          uri: dupes[0].uri,
          ok,
        }, ok ? "info" : "warn");
        if (ok) merged = true;
      }
    } catch (err) {
      this.log("capture_merge_check_failed", {
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        error: (err as Error)?.name || "Error",
      }, "warn");
      // Merge check failed — proceed with normal capture
    }

    if (!merged) {
      // Add project scope prefix if available
      let scopedText = decision.text;
      let projectSlug: string | null = null;
      await loadSharedModules();
      if (_resolveScopes) {
        const scopes = _resolveScopes(process.cwd());
        projectSlug = scopes.projectSlug;
        if (projectSlug) scopedText = `[project:${projectSlug}] ${decision.text}`;
      }
      // Normal capture: session → message → extract → delete
      const sessionId = await this.client.sessionCreate();
      if (sessionId) {
        try {
          await this.client.sessionAddMessage(sessionId, "user", scopedText);
          const extracted = await this.client.sessionExtract(sessionId);
          this.log("capture_extract", {
            sessionId: params.sessionId,
            sessionKey: params.sessionKey,
            ovSessionId: sessionId,
            extractedCount: extracted.length,
            projectSlug,
          });
          if (extracted.length === 0) {
            const date = new Date().toISOString().slice(0, 10);
            const fallbackRoot = projectSlug
              ? `viking://resources/projects/${projectSlug}/raw-captures`
              : "viking://resources/system/raw-captures";
            const fallbackUri = `${fallbackRoot}/${date}/${sessionId}.md`;
            const ok = await this.client.contentUpsert(
              fallbackUri,
              [
                "# OpenClaw Auto Capture Fallback",
                "",
                `Captured at: ${new Date().toISOString()}`,
                "",
                scopedText,
                "",
              ].join("\n"),
            );
            this.log("capture_write", {
              sessionId: params.sessionId,
              sessionKey: params.sessionKey,
              mode: "raw_fallback",
              uri: fallbackUri,
              ok,
            }, ok ? "info" : "warn");
          }
        } finally {
          await this.client.sessionDelete(sessionId);
        }
      } else {
        this.log("capture_write", {
          sessionId: params.sessionId,
          sessionKey: params.sessionKey,
          mode: "session_create",
          ok: false,
        }, "warn");
      }
    }

    // Record Used: report which recalled memories were in context
    await this.reportRecalledUris(params.sessionId, params.sessionKey);

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
        this.log("relation_link", {
          sessionId: params.sessionId,
          sessionKey: params.sessionKey,
          source: "viking://user/memories/",
          target: `viking://resources/projects/${projectSlug}/`,
          type: "belongs_to",
        });
      }
    }

    this.log("capture_done", {
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      role,
      merged,
    });
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
    this.log("capture_batch_done", {
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      messageCount: params.messages.length,
      ingestedCount: count,
    });
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
    const newMessages = params.messages.slice(Math.max(0, params.prePromptMessageCount));
    this.log("after_turn", {
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      messageCount: params.messages.length,
      prePromptMessageCount: params.prePromptMessageCount,
      newMessageCount: newMessages.length,
    });

    if (newMessages.length > 0) {
      await this.ingestBatch({
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        messages: newMessages,
        isHeartbeat: false,
      });
    }

    // Always record memory usage once per completed turn, even if capture skipped.
    await this.reportRecalledUris(params.sessionId, params.sessionKey);
  }

  private log(event: string, payload: Record<string, unknown> = {}, level: "info" | "warn" | "error" | "debug" = "info"): void {
    logEvent(this.logger, event, payload, level);
  }

  private async reportRecalledUris(sessionId: string, sessionKey?: string): Promise<void> {
    if (this.recalledUris.length === 0) return;
    const uris = this.recalledUris.slice();
    await this.client.sessionReportUsed(sessionId, uris);
    this.log("record_used", {
      sessionId,
      sessionKey,
      ...summarizeUris(uris),
    });
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
    await this.client.contentUpsert(
      `${childUri}meta/spawn`,
      JSON.stringify({
        parent: params.parentSessionKey,
        mode: params.contextMode || "isolated",
        spawned: new Date().toISOString(),
        ttlMs: params.ttlMs,
      }),
    );

    return {
      rollback: async () => {
        // Cleanup child scope if spawn fails
        await this.client.contentWrite(`${childUri}meta/spawn`, "", "replace").catch(() => {});
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
    await this.client.contentWrite(childUri, "", "replace").catch(() => {});
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
