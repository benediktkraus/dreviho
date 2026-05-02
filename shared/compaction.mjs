/**
 * Caveman Compaction — regex-based text compression for OV recall injection.
 *
 * Strips markdown formatting, collapses whitespace, removes boilerplate.
 * ~30% token reduction, $0 cost.
 *
 * Preserves: actual content, key facts, structure (via line breaks).
 * Strips: decoration, formatting, redundant whitespace, code blocks, tables.
 */

import { join } from "node:path";
import { homedir } from "node:os";
const SHARED = process.env.OPENVIKING_HOME || join(homedir(), ".openviking");
const { getCompactionConfig } = await import(join(SHARED, "scope-resolver.mjs"));

/**
 * Apply Caveman compaction to recalled memory text.
 *
 * @param {string} text - Raw memory content
 * @returns {string} Compacted text
 */
export function cavemanCompact(text) {
  const cfg = getCompactionConfig();
  if (!cfg.enabled || cfg.strategy !== "caveman") return text;

  let result = text;

  // Strip code blocks (``` ... ```) — often irrelevant for memory context
  if (cfg.strip_code_blocks !== false) {
    result = result.replace(/```[\s\S]*?```/g, "[code]");
  }

  // Strip table rows — keep as compressed info
  if (cfg.strip_tables !== false) {
    // Replace markdown tables with a compact representation
    result = result.replace(/^\|[-:\s|]+\|$/gm, ""); // separator rows
    result = result.replace(/^\|(.+)\|$/gm, (_, row) => {
      const cells = row.split("|").map(c => c.trim()).filter(Boolean);
      return cells.join(" | ");
    });
  }

  // Strip markdown headers (# → plain text)
  result = result.replace(/^#{1,6}\s+/gm, "");

  // Strip bold/italic markers (keep text)
  result = result.replace(/\*\*\*([^*]+)\*\*\*/g, "$1");
  result = result.replace(/\*\*([^*]+)\*\*/g, "$1");
  result = result.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1");
  result = result.replace(/__([^_]+)__/g, "$1");
  result = result.replace(/(?<!_)_([^_\n]+)_(?!_)/g, "$1");

  // Links → text only [text](url) → text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Strip inline code backticks (keep text)
  result = result.replace(/`([^`]+)`/g, "$1");

  // Strip blockquotes
  result = result.replace(/^>\s*/gm, "");

  // Strip horizontal rules
  result = result.replace(/^[-*_]{3,}\s*$/gm, "");

  // Normalize list markers
  result = result.replace(/^[-*+]\s+/gm, "- ");

  // Strip HTML comments (including MEMORY_FIELDS)
  result = result.replace(/<!--[\s\S]*?-->/g, "");

  // Collapse multiple blank lines → single
  result = result.replace(/\n{3,}/g, "\n\n");

  // Collapse whitespace (spaces/tabs) on each line
  if (cfg.collapse_whitespace !== false) {
    result = result.replace(/[ \t]+/g, " ");
    result = result.replace(/^ /gm, "");
  }

  return result.trim();
}

/**
 * Estimate token count reduction.
 * Returns { original, compacted, savings_pct }
 */
export function measureCompaction(original, compacted) {
  // Rough token estimate: 1 token ≈ 4 chars
  const origTokens = Math.ceil(original.length / 4);
  const compTokens = Math.ceil(compacted.length / 4);
  const savings = origTokens > 0 ? Math.round((1 - compTokens / origTokens) * 100) : 0;
  return { original: origTokens, compacted: compTokens, savings_pct: savings };
}
