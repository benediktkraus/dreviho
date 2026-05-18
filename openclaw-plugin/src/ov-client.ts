/**
 * OpenViking HTTP Client — native fetch with auth headers, timeout, abort controller.
 * Ported from scripts/auto-recall.mjs fetchJSON pattern.
 */

import { loadConfig, type OVConfig } from "./config.js";

export class OVClient {
  private cfg: OVConfig;

  constructor(cfg?: OVConfig) {
    this.cfg = cfg ?? loadConfig();
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.cfg.apiKey) headers["X-API-Key"] = this.cfg.apiKey;
    if (this.cfg.agentPrefix) headers["X-OpenViking-Agent"] = this.cfg.agentPrefix;
    if (this.cfg.account) headers["X-OpenViking-Account"] = this.cfg.account;
    if (this.cfg.user) headers["X-OpenViking-User"] = this.cfg.user;
    if (this.cfg.cfAccessClientId) headers["CF-Access-Client-Id"] = this.cfg.cfAccessClientId;
    if (this.cfg.cfAccessClientSecret) headers["CF-Access-Client-Secret"] = this.cfg.cfAccessClientSecret;
    return headers;
  }

  async fetchJSON<T = unknown>(path: string, init: RequestInit = {}, timeoutMs?: number, retries = 2): Promise<T | null> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.cfg.timeoutMs);
      try {
        const res = await fetch(`${this.cfg.baseUrl}${path}`, {
          ...init,
          headers: { ...this.buildHeaders(), ...(init.headers as Record<string, string> || {}) },
          signal: controller.signal,
        });
        if (res.status >= 500 && attempt < retries) {
          clearTimeout(timer);
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        const body = await res.json() as Record<string, unknown>;
        if (!res.ok || body.status === "error") return null;
        return (body.result ?? body) as T;
      } catch (err) {
        clearTimeout(timer);
        if (attempt < retries && ((err as Error)?.name === "AbortError" || (err as NodeJS.ErrnoException)?.code === "ECONNREFUSED")) {
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

  async health(): Promise<boolean> {
    const result = await this.fetchJSON("/health", {}, 3000);
    return result !== null;
  }

  async searchFind(query: string, targetUri: string, limit: number, since?: string): Promise<OVSearchResult[]> {
    const body: Record<string, unknown> = { query, target_uri: targetUri, limit, score_threshold: 0, include_provenance: true };
    if (since) { body.since = since; body.time_field = "created_at"; }
    const result = await this.fetchJSON<{ memories?: OVSearchResult[] }>("/api/v1/search/find", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return result?.memories ?? [];
  }

  async searchGrep(pattern: string, uri: string, limit: number): Promise<OVGrepResult[]> {
    const result = await this.fetchJSON<{ matches?: OVGrepResult[] }>("/api/v1/search/grep", {
      method: "POST",
      body: JSON.stringify({ pattern, uri, limit }),
    });
    return result?.matches ?? [];
  }

  async contentRead(uri: string): Promise<string | null> {
    const result = await this.fetchJSON<string>(`/api/v1/content/read?uri=${encodeURIComponent(uri)}`);
    if (result && typeof result === "string" && result.trim()) return result.trim();
    return null;
  }

  async contentWrite(uri: string, content: string, mode: "overwrite" | "append" = "overwrite"): Promise<boolean> {
    const result = await this.fetchJSON("/api/v1/content/write", {
      method: "POST",
      body: JSON.stringify({ uri, content, mode }),
    }, this.cfg.captureTimeoutMs);
    return result !== null;
  }

  async sessionCreate(): Promise<string | null> {
    const result = await this.fetchJSON<{ session_id?: string }>("/api/v1/sessions", {
      method: "POST",
      body: JSON.stringify({}),
    }, this.cfg.captureTimeoutMs);
    return result?.session_id ?? null;
  }

  async sessionAddMessage(sessionId: string, role: string, content: string): Promise<boolean> {
    const result = await this.fetchJSON(`/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ role, content }),
    }, this.cfg.captureTimeoutMs);
    return result !== null;
  }

  async sessionExtract(sessionId: string): Promise<unknown[]> {
    const result = await this.fetchJSON<unknown[]>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/extract`,
      { method: "POST", body: JSON.stringify({}) },
      this.cfg.captureTimeoutMs,
    );
    return Array.isArray(result) ? result : [];
  }

  async sessionDelete(sessionId: string): Promise<void> {
    await this.fetchJSON(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    }).catch(() => {});
  }

  async sessionReportUsed(sessionId: string, uris: string[]): Promise<void> {
    await this.fetchJSON(`/api/v1/sessions/${encodeURIComponent(sessionId)}/used`, {
      method: "POST",
      body: JSON.stringify({ uris }),
    }).catch(() => {});
  }

  async relationsLink(source: string, target: string, type: string, label: string): Promise<void> {
    await this.fetchJSON("/api/v1/relations/link", {
      method: "POST",
      body: JSON.stringify({ source, target, type, label }),
    }).catch(() => {});
  }

  async fsStat(uri: string): Promise<unknown | null> {
    return this.fetchJSON(`/api/v1/fs/stat?uri=${encodeURIComponent(uri)}`, {}, this.cfg.bootstrapTimeoutMs);
  }

  async systemStatus(): Promise<{ user?: string } | null> {
    return this.fetchJSON<{ user?: string }>("/api/v1/system/status");
  }

  getConfig(): OVConfig {
    return this.cfg;
  }
}

export interface OVSearchResult {
  uri: string;
  score: number;
  abstract?: string;
  overview?: string;
  category?: string;
  context_type?: string;
  level?: number;
  active_count?: number;
}

export interface OVGrepResult {
  uri?: string;
  path?: string;
  snippet?: string;
  line?: string;
  context_type?: string;
}
