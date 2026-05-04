/**
 * Scope Hint Builder — generates systemPromptAddition with active scope info.
 * Ported from scripts/auto-recall.mjs scope hints section.
 */

export interface ScopeInfo {
  scopes: string[];
  projectSlug: string | null;
}

export function buildScopeHints(scopeInfo: ScopeInfo): string {
  const hints: string[] = [];

  if (scopeInfo.projectSlug) {
    hints.push(`Project scope active: ${scopeInfo.projectSlug} (CLAUDE.md, SESSION-STATE.md, ARCHITECTURE.md synced)`);
  }
  if (scopeInfo.scopes.includes("system")) {
    hints.push("System scope: Bootstrap docs, learnings, config snapshots");
  }
  if (scopeInfo.scopes.includes("infra")) {
    hints.push("Infra scope: Infrastructure config, monitoring, deployment");
  }
  if (scopeInfo.scopes.includes("knowledge")) {
    hints.push("Knowledge scope: API directories, research outputs, external docs. Use memory_search for targeted lookups.");
  }
  if (scopeInfo.scopes.includes("personal")) {
    hints.push("Personal scope: Personal projects and private data");
  }

  return hints.length > 0 ? "\nActive scopes: " + hints.join(" | ") : "";
}

/**
 * Build the full memory context block for systemPromptAddition.
 */
export function buildMemoryBlock(memoryLines: string[], scopeHints: string): string {
  if (memoryLines.length === 0) return "";
  return (
    "<relevant-memories>\n" +
    "The following long-term memories from OpenViking may be relevant to this conversation:\n" +
    memoryLines.join("\n") + scopeHints + "\n" +
    "</relevant-memories>"
  );
}
