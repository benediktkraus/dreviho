/**
 * Temporal Decay Cache — tracks when URIs were first seen for age-based scoring.
 * Single Source of Truth. Used by ranking.mjs for temporal decay calculations.
 *
 * Cache file: ~/.openviking/decay-cache.json
 * Format: { "viking://...": 1714838400000, ... }
 * Max entries: 10000 (LRU eviction)
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const CACHE_PATH = join(process.env.OPENVIKING_HOME || `${homedir()}/.openviking`, "decay-cache.json");
const MAX_ENTRIES = 10000;
let _cache = null;
let _dirty = false;

function loadCache() {
  if (_cache) return _cache;
  try {
    _cache = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
    if (typeof _cache !== "object" || _cache === null) _cache = {};
  } catch {
    _cache = {};
  }
  return _cache;
}

function saveCache() {
  if (!_dirty || !_cache) return;
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true });
    // LRU eviction: keep newest entries
    const entries = Object.entries(_cache);
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => b[1] - a[1]); // newest first
      _cache = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
    }
    writeFileSync(CACHE_PATH, JSON.stringify(_cache));
    _dirty = false;
  } catch { /* best effort */ }
}

/**
 * Record that a URI was seen. Only stores the FIRST time — does not overwrite.
 */
export function recordSeen(uri) {
  const cache = loadCache();
  if (!cache[uri]) {
    cache[uri] = Date.now();
    _dirty = true;
  }
}

/**
 * Record multiple URIs as seen in batch.
 */
export function recordSeenBatch(uris) {
  const cache = loadCache();
  const now = Date.now();
  for (const uri of uris) {
    if (!cache[uri]) {
      cache[uri] = now;
      _dirty = true;
    }
  }
}

/**
 * Get age in days since URI was first seen. Returns 0 for unknown URIs.
 */
export function getAgeDays(uri) {
  const cache = loadCache();
  const ts = cache[uri];
  if (!ts) return 0;
  return Math.max(0, (Date.now() - ts) / (1000 * 60 * 60 * 24));
}

/**
 * Temporal decay factor: exp(-age * ln2 / halfLife)
 * At halfLife days, factor = 0.5. At 2*halfLife, factor = 0.25.
 * Unknown URIs (age=0) get factor 1.0 (no decay).
 */
export function temporalDecayFactor(uri, halfLifeDays = 30) {
  const age = getAgeDays(uri);
  if (age <= 0) return 1.0;
  return Math.exp(-age * Math.LN2 / halfLifeDays);
}

/**
 * Check if a URI matches any evergreen pattern (no decay applied).
 */
export function isEvergreen(uri, evergreenPatterns = []) {
  for (const pattern of evergreenPatterns) {
    if (pattern.endsWith("/") || pattern.endsWith("*")) {
      const prefix = pattern.replace(/\*$/, "");
      if (uri.startsWith(prefix)) return true;
    } else if (uri === pattern) {
      return true;
    }
  }
  return false;
}

/**
 * Flush cache to disk. Call at end of recall/capture cycle.
 */
export function flushCache() {
  saveCache();
}
