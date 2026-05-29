/**
 * Hybrid Search — Semantic + Grep + RRF Merge
 * Ported from scripts/auto-recall.mjs
 */

import { OVClient, type OVSearchResult, type OVGrepResult } from "./ov-client.js";

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

export function extractKeywords(text: string): string[] {
  const tokens = text.toLowerCase().match(/[a-z0-9äöüß._-]{3,}/gi) || [];
  return [...new Set(tokens.filter(t => !KEYWORD_STOP.has(t)))].slice(0, 8);
}

export async function grepSearch(client: OVClient, keywords: string[], limit: number): Promise<OVSearchResult[]> {
  if (keywords.length === 0) return [];
  const pattern = keywords.slice(0, 4).join("|");
  const matches = await client.searchGrep(pattern, "viking://user/", limit);
  return matches.map((m, i) => ({
    uri: m.uri || m.path || `grep-${i}`,
    score: 1.0 / (i + 1),
    abstract: m.snippet || m.line || "",
    context_type: m.context_type || "grep",
    level: 2,
  }));
}

export function rrfMerge(semanticResults: OVSearchResult[], grepResults: OVSearchResult[], k = 60): OVSearchResult[] {
  const scoreMap = new Map<string, { item: OVSearchResult; rrfScore: number }>();

  semanticResults.forEach((item, rank) => {
    const key = item.uri;
    const prev = scoreMap.get(key) || { item, rrfScore: 0 };
    prev.rrfScore += 1 / (k + rank + 1);
    scoreMap.set(key, prev);
  });

  grepResults.forEach((item, rank) => {
    const key = item.uri || `grep-${rank}`;
    const prev = scoreMap.get(key) || { item, rrfScore: 0 };
    prev.rrfScore += 1 / (k + rank + 1);
    if (!prev.item.uri && item.uri) prev.item = item;
    scoreMap.set(key, prev);
  });

  return [...scoreMap.values()]
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map(e => ({ ...e.item, score: e.item.score }));
}

/**
 * Full scoped search: semantic across all target URIs + grep + RRF merge + URI dedup.
 * Memory URIs get a `since` time filter; resource URIs are evergreen (no filter).
 */
export async function searchScoped(
  client: OVClient,
  query: string,
  targetUris: string[],
  limit: number,
): Promise<OVSearchResult[]> {
  // Semantic search across all scoped target URIs
  // Apply time filter for memories, not resources
  const searchPromises = targetUris.map(uri => {
    const isMemory = uri.includes("/memories/") || uri.includes("/user/");
    return client.searchFind(query, uri, limit, isMemory ? "90d" : undefined);
  });

  // Grep search in parallel
  const keywords = extractKeywords(query);
  const grepPromise = keywords.length > 0
    ? grepSearch(client, keywords, limit)
    : Promise.resolve([]);

  const [resultSets, grepResults] = await Promise.all([
    Promise.all(searchPromises),
    grepPromise,
  ]);
  const semanticAll = resultSets.flat();

  // RRF merge if grep returned results
  const all = grepResults.length > 0
    ? rrfMerge(semanticAll, grepResults)
    : semanticAll;

  // Dedupe by URI
  const uriSet = new Set<string>();
  return all.filter(m => {
    if (!m.uri || uriSet.has(m.uri)) return false;
    uriSet.add(m.uri);
    return true;
  });
}
