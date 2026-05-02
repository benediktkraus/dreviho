/**
 * Memory Ranking — shared scoring logic for recall hooks + MCP server.
 * Single Source of Truth. Do NOT duplicate this logic elsewhere.
 */

const PREFERENCE_QUERY_RE = /prefer|preference|favorite|favourite|like/i;
const TEMPORAL_QUERY_RE = /when|what time|date|day|month|year|yesterday|today|tomorrow|last|next/i;
const QUERY_TOKEN_RE = /[a-z0-9\u4e00-\u9fa5]{2,}/gi;
const STOPWORDS = new Set([
  "what","when","where","which","who","whom","whose","why","how","did","does",
  "is","are","was","were","the","and","for","with","from","that","this","your","you",
]);

export function clampScore(v) {
  if (typeof v !== "number" || Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function buildQueryProfile(query) {
  const text = query.trim();
  const allTokens = text.toLowerCase().match(QUERY_TOKEN_RE) || [];
  const tokens = allTokens.filter(t => !STOPWORDS.has(t));
  return {
    tokens,
    wantsPreference: PREFERENCE_QUERY_RE.test(text),
    wantsTemporal: TEMPORAL_QUERY_RE.test(text),
  };
}

export function lexicalOverlapBoost(tokens, text) {
  if (tokens.length === 0 || !text) return 0;
  const haystack = ` ${text.toLowerCase()} `;
  let matched = 0;
  for (const token of tokens.slice(0, 8)) {
    if (haystack.includes(token)) matched += 1;
  }
  return Math.min(0.2, (matched / Math.min(tokens.length, 4)) * 0.2);
}

function safeStr(val) {
  return typeof val === "string" ? val : String(val || "");
}

export function getRankingBreakdown(item, profile, authorityMultiplier = 1.0) {
  const base = clampScore(item.score);
  const abstract = safeStr(item.abstract || item.overview).trim();
  const cat = (item.category || "").toLowerCase();
  const uri = (item.uri || "").toLowerCase();
  const leafBoost = (item.level === 2 || uri.endsWith(".md")) ? 0.12 : 0;
  const eventBoost = profile.wantsTemporal && (cat === "events" || uri.includes("/events/")) ? 0.1 : 0;
  const prefBoost = profile.wantsPreference && (cat === "preferences" || uri.includes("/preferences/")) ? 0.08 : 0;
  const overlapBoost = lexicalOverlapBoost(profile.tokens, `${item.uri} ${abstract}`);
  const authorityBoost = base * (authorityMultiplier - 1.0);
  return {
    baseScore: base,
    leafBoost, eventBoost, prefBoost, overlapBoost,
    authorityBoost, authorityMultiplier,
    finalScore: base + leafBoost + eventBoost + prefBoost + overlapBoost + authorityBoost,
  };
}

export function dedupeByAbstract(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = safeStr(item.abstract || item.overview).trim().toLowerCase() || item.uri;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function postProcess(items, limit, threshold) {
  const seen = new Set();
  const sorted = [...items].sort((a, b) => clampScore(b.score) - clampScore(a.score));
  const result = [];
  for (const item of sorted) {
    if (item.level !== 2) continue;
    if (clampScore(item.score) < threshold) continue;
    const cat = (item.category || "").toLowerCase() || "unknown";
    const abs = safeStr(item.abstract || item.overview).trim().toLowerCase();
    const key = abs ? `${cat}:${abs}` : `uri:${item.uri}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

export function pickMemories(items, limit, queryText, authorityFn = () => 1.0) {
  if (items.length === 0 || limit <= 0) return [];
  const profile = buildQueryProfile(queryText);
  const sorted = [...items].sort((a, b) => {
    const aScore = getRankingBreakdown(a, profile, authorityFn(a)).finalScore;
    const bScore = getRankingBreakdown(b, profile, authorityFn(b)).finalScore;
    return bScore - aScore;
  });
  const deduped = dedupeByAbstract(sorted);
  const leaves = deduped.filter(m => m.level === 2 || (m.uri || "").endsWith(".md"));
  if (leaves.length >= limit) return leaves.slice(0, limit);
  const picked = [...leaves];
  const used = new Set(picked.map(m => m.uri));
  for (const item of deduped) {
    if (picked.length >= limit) break;
    if (used.has(item.uri)) continue;
    picked.push(item);
  }
  return picked;
}
